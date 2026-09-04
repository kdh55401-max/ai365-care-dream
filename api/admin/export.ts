import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, getQuery, requireMethod, withHandler } from '../_lib/http.js'
import { requireAdminSession } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { logAudit } from '../_lib/audit.js'
import { toCsv } from '../../shared/csv.js'

const SUMMARY_HEADERS = [
  '보고ID', '참여자코드', '수급자코드', '보고유형', '보고일자', '제출일시', '완료소요초', '입력방식',
  '원문_즉시판단가능', '원문_추가질문필요', '원문_완성도점수',
  'AI_즉시판단가능', 'AI_추가질문필요', 'AI_완성도점수', '실제추가확인방식', 'AI_업무유용성',
  'AI_사실오류여부', '처리상태',
]

const FULL_EXTRA_HEADERS = [
  '최초원문', 'AI추가질문_답변', 'AI생성보고_관찰변화', 'AI생성보고_현장조치', 'AI생성보고_현재상태',
  'AI생성보고_센터확인', '최종보고_관찰변화', '최종보고_현장조치', '최종보고_현재상태', '최종보고_센터확인',
  '원문평가메모', 'AI평가메모',
]

function boolLabel(v: unknown): string {
  if (v === true) return '예'
  if (v === false) return '아니오'
  return ''
}

const FOLLOWUP_LABEL: Record<string, string> = { none: '필요없음', sms: '문자확인', call: '전화확인' }

interface Report {
  id: string
  participant_code: string
  recipient_code: string
  report_type: string
  report_date: string
  submitted_at: string | null
  completion_seconds: number | null
  input_method: string | null
  raw_immediately_actionable: boolean | null
  raw_followup_needed: boolean | null
  raw_completeness_score: number | null
  ai_immediately_actionable: boolean | null
  ai_followup_needed: boolean | null
  ai_completeness_score: number | null
  actual_followup_type: string | null
  ai_usefulness_score: number | null
  ai_inaccuracy_detected: boolean | null
  manager_status: string | null
  raw_input: string
  followup_answers: Array<{ question: string; answer: string }> | null
  ai_generated_report: { change: string; action: string; result: string; escalation: string } | null
  caregiver_final_report: { change: string; action: string; result: string; escalation: string } | null
  raw_eval_note: string | null
  ai_eval_note: string | null
}

function summaryRow(r: Report): unknown[] {
  return [
    r.id, r.participant_code, r.recipient_code, r.report_type === 'daily' ? '기본' : '추가', r.report_date,
    r.submitted_at ?? '', r.completion_seconds ?? '', r.input_method === 'voice' ? '음성' : '텍스트',
    boolLabel(r.raw_immediately_actionable), boolLabel(r.raw_followup_needed), r.raw_completeness_score ?? '',
    boolLabel(r.ai_immediately_actionable), boolLabel(r.ai_followup_needed), r.ai_completeness_score ?? '',
    r.actual_followup_type ? FOLLOWUP_LABEL[r.actual_followup_type] : '', r.ai_usefulness_score ?? '',
    boolLabel(r.ai_inaccuracy_detected), r.manager_status ?? '',
  ]
}

function fullExtraRow(r: Report): unknown[] {
  const qa = (r.followup_answers ?? []).map((a) => `${a.question} -> ${a.answer}`).join(' | ')
  const ai = r.ai_generated_report
  const final = r.caregiver_final_report
  return [
    r.raw_input, qa,
    ai?.change ?? '', ai?.action ?? '', ai?.result ?? '', ai?.escalation ?? '',
    final?.change ?? '', final?.action ?? '', final?.result ?? '', final?.escalation ?? '',
    r.raw_eval_note ?? '', r.ai_eval_note ?? '',
  ]
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET')
    await requireAdminSession(req)

    const type = getQuery(req).get('type') === 'full' ? 'full' : 'summary'

    const { data, error } = await getSupabaseAdmin()
      .from('reports')
      .select('*')
      .eq('status', 'submitted')
      .eq('deleted', false)
      .order('submitted_at', { ascending: true })
    if (error) throw new ApiError(500, 'CSV를 생성하지 못했습니다.')

    const rows = (data ?? []) as unknown as Report[]
    const headers = type === 'full' ? [...SUMMARY_HEADERS, ...FULL_EXTRA_HEADERS] : SUMMARY_HEADERS
    const body = rows.map((r) => (type === 'full' ? [...summaryRow(r), ...fullExtraRow(r)] : summaryRow(r)))
    const csv = toCsv(headers, body)

    await logAudit('export_csv', undefined, { type, count: rows.length })

    const filename = `care-report-${type}-${new Date().toISOString().slice(0, 10)}.csv`
    res.statusCode = 200
    res.setHeader('content-type', 'text/csv; charset=utf-8')
    res.setHeader('content-disposition', `attachment; filename="${filename}"`)
    res.setHeader('cache-control', 'no-store')
    res.end(csv)
  })
}
