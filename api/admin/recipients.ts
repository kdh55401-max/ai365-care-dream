import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, getQuery, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { requireAdminOrganization } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { logAudit } from '../_lib/audit.js'
import { todayKstDateString } from '../_lib/date.js'
import type { CareReportRecord } from '../../shared/careTypes.js'
import {
  buildRecipientTimeline,
  buildReviewQueue,
  parseTimelinePeriod,
  periodSince,
  summarizeRecipients,
  type AssignmentRow,
  type RecipientRow,
} from '../../shared/recipientHub.js'

const RECIPIENT_CODE_PATTERN = /^[A-Z0-9]{1,10}$/

/** 관리자 수급자 허브 — 기관 → 수급자 목록 → 수급자 상세(보고 타임라인).
 *
 * GET ?org=<기관ID>                       수급자 목록 + 기관 첫 화면의 검토 대기 목록
 * GET ?org=<기관ID>&code=A01&period=30    수급자 한 명의 보고 타임라인(7 | 30 | all)
 *
 * 기관 범위: 세션 기관과 다른 org는 403(requireAdminOrganization). 이 배포는 기관 한
 * 곳의 데이터만 담으므로(shared/organization.ts) 세션 기관이 확인되면 이 배포의
 * 수급자 전체가 그 기관 범위다. 표준상황 연습(report_source='scenario')과 삭제된 보고는
 * 실제 돌봄 이력이 아니므로 넣지 않는다. 읽기 전용 — 이 API는 아무것도 쓰지 않는다
 * (감사 로그 제외). 보고 승인/반려는 기존 /api/admin/reports PATCH를 그대로 쓴다. */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET')
    const { organization } = await requireAdminOrganization(req)
    const supabase = getSupabaseAdmin()
    const query = getQuery(req)
    const code = query.get('code')?.trim().toUpperCase() ?? ''

    if (!code) {
      const [recipientsRes, assignmentsRes, reportsRes] = await Promise.all([
        supabase.from('recipients').select('code, active').order('code', { ascending: true }),
        supabase.from('caregiver_assignments').select('caregiver_code, recipient_code, active'),
        // 컬럼 이름을 나열하지 않고 '*'를 쓰는 이유: ai_fallback_used 등 수동 마이그레이션
        // 컬럼이 아직 없는 배포 시점에도 이 조회가 깨지지 않게 하기 위함(stats와 동일).
        supabase.from('reports').select('*').eq('deleted', false).eq('report_source', 'live').limit(5000),
      ])
      if (recipientsRes.error || assignmentsRes.error || reportsRes.error) {
        throw new ApiError(500, '수급자 목록을 불러오지 못했습니다.')
      }
      const reports = (reportsRes.data ?? []) as unknown as CareReportRecord[]
      sendJson(res, 200, {
        organization,
        generatedAt: new Date().toISOString(),
        recipients: summarizeRecipients(
          (recipientsRes.data ?? []) as RecipientRow[],
          (assignmentsRes.data ?? []) as AssignmentRow[],
          reports,
        ),
        reviewQueue: buildReviewQueue(reports),
      })
      return
    }

    if (!RECIPIENT_CODE_PATTERN.test(code)) throw new ApiError(400, '수급자 코드가 올바르지 않습니다.')
    const { data: recipient, error: recipientError } = await supabase
      .from('recipients')
      .select('code, active')
      .eq('code', code)
      .maybeSingle()
    if (recipientError) throw new ApiError(500, '수급자 정보를 불러오지 못했습니다.')
    // 이 기관 범위에 없는 수급자는 존재 여부도 알려주지 않는다(404로 통일).
    if (!recipient) throw new ApiError(404, '이 기관에서 해당 수급자를 찾을 수 없습니다.')

    const period = parseTimelinePeriod(query.get('period'))
    const today = todayKstDateString()
    const since = periodSince(period, today)
    let reportsQuery = supabase
      .from('reports')
      .select('*')
      .eq('recipient_code', code)
      .eq('deleted', false)
      .eq('report_source', 'live')
    if (since) reportsQuery = reportsQuery.gte('report_date', since)
    const [reportsRes, allStatusRes, assignmentsRes] = await Promise.all([
      reportsQuery.order('created_at', { ascending: false }).limit(1000),
      // 상단 요약(검토 대기 수·최근 제출)은 기간 선택과 무관하게 전체 이력 기준이다 —
      // 기간을 7일로 좁혔다고 그 전의 검토 대기 보고가 사라져 보이면 안 된다.
      supabase
        .from('reports')
        .select('id, recipient_code, participant_code, status, review_status, emergency_flagged, submitted_at, report_date, report_source, deleted')
        .eq('recipient_code', code)
        .eq('deleted', false)
        .eq('report_source', 'live')
        .limit(5000),
      supabase.from('caregiver_assignments').select('caregiver_code, recipient_code, active').eq('recipient_code', code),
    ])
    if (reportsRes.error || allStatusRes.error || assignmentsRes.error) throw new ApiError(500, '보고 이력을 불러오지 못했습니다.')

    await logAudit('view_recipient_timeline', code, { period })
    const [summary] = summarizeRecipients(
      [recipient as RecipientRow],
      (assignmentsRes.data ?? []) as AssignmentRow[],
      (allStatusRes.data ?? []) as unknown as CareReportRecord[],
    )
    sendJson(res, 200, {
      organization,
      recipient: summary,
      timeline: buildRecipientTimeline((reportsRes.data ?? []) as unknown as CareReportRecord[], period, today),
    })
  })
}
