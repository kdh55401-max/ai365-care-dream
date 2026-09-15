import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError, getQuery, readJsonBody, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { requireAdminOrganization } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { logAudit } from '../_lib/audit.js'
import { todayKstDateString } from '../_lib/date.js'
import { callWorkflowRpc, fetchAll, loadActionState, loadWorkflowRows, workflowReady, type RpcResult } from '../_lib/workflowStore.js'
import { fieldRequestsReady, loadAssigneesByRecipient, loadFieldRows } from '../_lib/fieldRequestsStore.js'
import type { CareReportRecord } from '../../shared/careTypes.js'
import type { Organization } from '../../shared/organization.js'
import {
  buildRecipientTimeline,
  buildReviewQueue,
  parseTimelinePeriod,
  periodSince,
  summarizeRecipients,
  type AssignmentRow,
  type RecipientRow,
} from '../../shared/recipientHub.js'
import { buildWorkBoard } from '../../shared/workBoard.js'
import {
  FIELD_REQUEST_OPS,
  latestBy,
  planActionMutation,
  planCreateAction,
  planDecision,
  planSafetyReview,
  WorkflowError,
  type ActionMutationInput,
  type AdminDecision,
  type CareAction,
  type CreateActionInput,
  type DecisionInput,
  type SafetyReview,
  type SafetyReviewInput,
  type WorkflowContext,
} from '../../shared/workflow.js'
import {
  buildRecipientWorkflow,
  filterActions,
  parseActionFilter,
  summarizeAction,
  summarizeRequest,
  type ActionDetailView,
  type ReportWorkflowView,
  type RequestContext,
} from '../../shared/workflowViews.js'

const RECIPIENT_CODE_PATTERN = /^[A-Z0-9]{1,10}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 관리자 업무 API — 1단계 수급자 허브(조회), 2단계 판단·조치·안전 검토, 3단계 현장 요청 게시·결과 확인을 한 곳에서.
 * (Vercel 무료 요금제의 배포당 함수 12개 한도 때문에 파일을 늘리지 않고 이 한 함수로 묶었다.)
 *
 * 모든 요청은 관리자 세션 + 세션 기관 확인(requireAdminOrganization). 요청의 org가 다르면 403.
 * 2단계 테이블(db/migrations/2026-09-15-admin-workflow.sql)이 없으면 조회는 workflowReady:false로
 * 알려 화면이 "준비 중"을 보이게 하고, 저장은 503으로 거부한다(가짜 0건을 만들지 않는다).
 * 3단계 테이블(db/migrations/2026-09-16-field-requests.sql)이 없으면 fieldRequestsReady:false,
 * 게시·철회·대상 변경·결과 확인(mutate_action의 publish|withdraw|retarget|verify)은 503.
 * 현장 응답 자체는 요양보호사 보고 제출(api/care/reports.ts)에서 들어온다.
 *
 * GET  ?org=&view=recipients                      수급자 목록 + 검토 대기(1단계)
 * GET  ?org=&view=recipient&code=A01&period=30    수급자 타임라인 + 보고별 판단·안전 검토·조치
 * GET  ?org=&view=board                           업무 카드 7개 + 전체 목록 + 통합 목록
 * GET  ?org=&view=report&reportId=                보고 한 건의 이벤트·판단·안전 검토·조치
 * GET  ?org=&view=actions&filter=&recipient=      조치 목록
 * GET  ?org=&view=action&id=                      조치 상세(의무·이력·현장 요청·응답·결과 확인·현재 배정)
 * POST ?org=  {op:'decide'|'safety_review'|'create_action'|'mutate_action', ...} */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST')
    const { organization } = await requireAdminOrganization(req)
    const supabase = getSupabaseAdmin()
    if (req.method === 'POST') {
      await handlePost(supabase, organization, await readJsonBody(req), res)
      return
    }
    const q = getQuery(req)
    switch (q.get('view')) {
      case 'recipients':
        return sendJson(res, 200, await recipientsView(supabase, organization))
      case 'recipient':
        return sendJson(res, 200, await recipientView(supabase, organization, q.get('code') ?? '', q.get('period')))
      case 'board':
        return sendJson(res, 200, await boardView(supabase, organization))
      case 'report':
        return sendJson(res, 200, await reportView(supabase, organization, q.get('reportId') ?? ''))
      case 'actions':
        return sendJson(res, 200, await actionsView(supabase, organization, q.get('filter'), q.get('recipient')))
      case 'action':
        return sendJson(res, 200, await actionView(supabase, organization, q.get('id') ?? ''))
      default:
        throw new ApiError(400, '알 수 없는 조회입니다.')
    }
  })
}

// ── 조회 ─────────────────────────────────────────────────────────────

async function liveReports(supabase: SupabaseClient, recipientCode?: string): Promise<CareReportRecord[]> {
  // '*'를 쓰는 이유: 수동 마이그레이션 컬럼(ai_fallback_used 등)이 없는 배포 시점에도 조회가 깨지지 않게.
  return fetchAll<CareReportRecord>(() => {
    let query = supabase.from('reports').select('*').eq('deleted', false).eq('report_source', 'live')
    if (recipientCode) query = query.eq('recipient_code', recipientCode)
    return query.order('created_at', { ascending: true }).order('id', { ascending: true })
  }, '보고')
}

async function recipientsView(supabase: SupabaseClient, organization: Organization) {
  const [recipients, assignments, reports] = await Promise.all([
    fetchAll<RecipientRow>(() => supabase.from('recipients').select('code, active').order('code', { ascending: true }), '수급자'),
    fetchAll<AssignmentRow>(() => supabase.from('caregiver_assignments').select('caregiver_code, recipient_code, active').order('recipient_code', { ascending: true }).order('caregiver_code', { ascending: true }), '배정'),
    liveReports(supabase),
  ])
  return {
    organization,
    generatedAt: new Date().toISOString(),
    recipients: summarizeRecipients(recipients, assignments, reports),
    reviewQueue: buildReviewQueue(reports),
  }
}

async function recipientView(supabase: SupabaseClient, organization: Organization, rawCode: string, rawPeriod: string | null) {
  const code = rawCode.trim().toUpperCase()
  if (!RECIPIENT_CODE_PATTERN.test(code)) throw new ApiError(400, '수급자 코드가 올바르지 않습니다.')
  const { data: recipient, error } = await supabase.from('recipients').select('code, active').eq('code', code).maybeSingle()
  if (error) throw new ApiError(500, '수급자 정보를 불러오지 못했습니다.')
  // 이 기관 범위에 없는 수급자는 존재 여부도 알려주지 않는다(404로 통일).
  if (!recipient) throw new ApiError(404, '이 기관에서 해당 수급자를 찾을 수 없습니다.')

  const period = parseTimelinePeriod(rawPeriod)
  const today = todayKstDateString()
  const since = periodSince(period, today)
  const [all, assignments, ready] = await Promise.all([
    liveReports(supabase, code),
    fetchAll<AssignmentRow>(() => supabase.from('caregiver_assignments').select('caregiver_code, recipient_code, active').eq('recipient_code', code).order('caregiver_code', { ascending: true }), '배정'),
    workflowReady(supabase),
  ])
  // 상단 요약(검토 대기·최근 제출)은 기간과 무관하게 전체 이력 기준, 타임라인은 선택 기간.
  const [summary] = summarizeRecipients([recipient as RecipientRow], assignments, all)
  const timeline = buildRecipientTimeline(since ? all.filter((r) => r.report_date >= since) : all, period, today)
  const reportIds = timeline.entries.map((e) => e.reportId)
  let workflow: { workflowReady: boolean } & ReturnType<typeof buildRecipientWorkflow> = { workflowReady: false, byReport: {}, actions: [] }
  if (ready) {
    const rows = await loadWorkflowRows(supabase, organization.id, { reportIds, recipientCode: code })
    const rc = await requestContext(supabase, organization.id, rows.actions, all)
    workflow = { workflowReady: true, ...buildRecipientWorkflow(reportIds, rows, new Date(), rc) }
  }
  await logAudit('view_recipient_timeline', code, { period })
  return { organization, recipient: summary, timeline, workflow }
}

/** 3단계 요약 정보(현재 요청·대기 상태·재배정 필요)를 붙이기 위한 입력. 3단계 저장소가 없으면 undefined. */
async function requestContext(supabase: SupabaseClient, organizationId: string, actions: CareAction[], reports: CareReportRecord[]): Promise<RequestContext | undefined> {
  if (!(await fieldRequestsReady(supabase))) return undefined
  const [field, assigneesByRecipient] = await Promise.all([loadFieldRows(supabase, organizationId, actions.map((a) => a.id)), loadAssigneesByRecipient(supabase)])
  return { requests: field.requests, responses: field.responses, reports, assigneesByRecipient }
}

async function boardView(supabase: SupabaseClient, organization: Organization) {
  const [reports, ready, frReady, assigneesByRecipient] = await Promise.all([
    liveReports(supabase),
    workflowReady(supabase),
    fieldRequestsReady(supabase),
    loadAssigneesByRecipient(supabase),
  ])
  const rows = ready ? await loadWorkflowRows(supabase, organization.id) : { decisions: [], safetyReviews: [], actions: [], obligations: [], reportEvents: [] }
  const field = ready && frReady ? await loadFieldRows(supabase, organization.id) : { requests: [], responses: [], verifications: [] }
  return {
    organization,
    board: buildWorkBoard({
      reports,
      ...rows,
      workflowReady: ready,
      fieldRequestsReady: frReady,
      requests: field.requests,
      responses: field.responses,
      assigneesByRecipient,
      now: new Date(),
    }),
  }
}

async function loadReportForWorkflow(supabase: SupabaseClient, reportId: string): Promise<CareReportRecord> {
  if (!UUID_PATTERN.test(reportId)) throw new ApiError(400, '보고 id가 올바르지 않습니다.')
  const { data, error } = await supabase.from('reports').select('*').eq('id', reportId).eq('deleted', false).maybeSingle()
  if (error) throw new ApiError(500, '보고를 불러오지 못했습니다.')
  if (!data) throw new ApiError(404, '보고를 찾을 수 없습니다.')
  return data as CareReportRecord
}

async function reportView(supabase: SupabaseClient, organization: Organization, reportId: string): Promise<ReportWorkflowView> {
  const report = await loadReportForWorkflow(supabase, reportId)
  const base: ReportWorkflowView = {
    workflowReady: false,
    report: {
      id: report.id,
      recipientCode: report.recipient_code,
      status: report.status,
      reviewStatus: report.review_status ?? 'pending',
      emergencyFlagged: Boolean(report.emergency_flagged),
      updatedAt: report.updated_at,
      submittedAt: report.submitted_at,
    },
    events: [],
    decisions: [],
    safetyReviews: [],
    actions: [],
    recipientOpenActions: [],
  }
  if (!(await workflowReady(supabase))) return base
  const [rows, recipientReports] = await Promise.all([
    loadWorkflowRows(supabase, organization.id, { reportIds: [report.id], recipientCode: report.recipient_code }),
    liveReports(supabase, report.recipient_code),
  ])
  const now = new Date()
  const rc = await requestContext(supabase, organization.id, rows.actions, recipientReports)
  const summaries = rows.actions.map((a) => summarizeAction(a, rows.obligations, now, rc))
  return {
    ...base,
    workflowReady: true,
    events: rows.reportEvents,
    decisions: rows.decisions,
    safetyReviews: rows.safetyReviews,
    actions: summaries.filter((s) => s.sourceReportId === report.id),
    recipientOpenActions: summaries.filter((s) => s.status === 'open' || s.status === 'draft'),
  }
}

async function actionsView(supabase: SupabaseClient, organization: Organization, rawFilter: string | null, rawRecipient: string | null) {
  const filter = parseActionFilter(rawFilter)
  const recipientCode = rawRecipient?.trim().toUpperCase() || undefined
  if (recipientCode && !RECIPIENT_CODE_PATTERN.test(recipientCode)) throw new ApiError(400, '수급자 코드가 올바르지 않습니다.')
  if (!(await workflowReady(supabase))) return { organization, workflowReady: false, filter, asOf: new Date().toISOString(), actions: [] }
  const [rows, reports] = await Promise.all([loadWorkflowRows(supabase, organization.id, { reportIds: [], recipientCode }), liveReports(supabase, recipientCode)])
  const now = new Date()
  const rc = await requestContext(supabase, organization.id, rows.actions, reports)
  return {
    organization,
    workflowReady: true,
    filter,
    asOf: now.toISOString(),
    actions: filterActions(rows.actions.map((a) => summarizeAction(a, rows.obligations, now, rc)), filter),
  }
}

/** 조치 한 건의 상태 + 3단계 요청·응답 + 현재 배정(게시·대상 변경 검증용). */
async function loadFullActionState(supabase: SupabaseClient, organizationId: string, id: string) {
  const state = await loadActionState(supabase, organizationId, id)
  const frReady = await fieldRequestsReady(supabase)
  const [field, assigneesByRecipient] = frReady
    ? await Promise.all([loadFieldRows(supabase, organizationId, [id]), loadAssigneesByRecipient(supabase, state.action.recipient_code)])
    : [{ requests: [], responses: [], verifications: [] }, {} as Record<string, string[]>]
  return { ...state, frReady, field, assignees: assigneesByRecipient[state.action.recipient_code] ?? [] }
}

async function actionView(supabase: SupabaseClient, organization: Organization, id: string): Promise<ActionDetailView> {
  if (!UUID_PATTERN.test(id)) throw new ApiError(400, '조치 id가 올바르지 않습니다.')
  if (!(await workflowReady(supabase))) throw new ApiError(503, '업무 기록 저장소가 아직 준비되지 않았습니다(DB 마이그레이션 적용 필요).')
  const s = await loadFullActionState(supabase, organization.id, id)
  const [{ data: linked }, reports] = await Promise.all([
    supabase.from('safety_reviews').select('id, report_id, outcome, reviewed_at').eq('related_action_id', id),
    s.frReady ? liveReports(supabase, s.action.recipient_code) : Promise.resolve([] as CareReportRecord[]),
  ])
  const now = new Date()
  const rc: RequestContext | undefined = s.frReady
    ? { requests: s.field.requests, responses: s.field.responses, reports, assigneesByRecipient: { [s.action.recipient_code]: s.assignees } }
    : undefined
  return {
    workflowReady: true,
    fieldRequestsReady: s.frReady,
    action: s.action,
    summary: summarizeAction(s.action, s.obligations, now, rc),
    events: s.events,
    linkedSafetyReviews: (linked ?? []) as ActionDetailView['linkedSafetyReviews'],
    requests: rc
      ? [...s.field.requests]
          .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
          .map((request) => ({
            request,
            summary: summarizeRequest(request, s.obligations, rc, now.toISOString()),
            responses: s.field.responses.filter((r) => r.field_request_id === request.id),
          }))
      : [],
    verifications: s.field.verifications,
    assignees: s.assignees,
  }
}

// ── 저장 ─────────────────────────────────────────────────────────────

function context(organization: Organization): WorkflowContext {
  return { now: new Date().toISOString(), organizationId: organization.id, newId: () => crypto.randomUUID() }
}

function rpcOutcome(result: RpcResult, conflictMessage: string) {
  if (result.status === 'conflict') throw new ApiError(409, conflictMessage)
  if (result.status === 'not_found') throw new ApiError(404, '대상을 찾을 수 없습니다.')
  if (result.status === 'invalid') throw new ApiError(400, result.message ?? '요청을 처리할 수 없습니다.')
}

async function handlePost(supabase: SupabaseClient, organization: Organization, body: Record<string, unknown>, res: ServerResponse) {
  if (!(await workflowReady(supabase))) throw new ApiError(503, '업무 기록 저장소가 아직 준비되지 않았습니다(DB 마이그레이션 적용 필요).')
  try {
    switch (body.op) {
      case 'decide': {
        const input = body as unknown as DecisionInput
        const report = await loadReportForWorkflow(supabase, String(input.reportId ?? ''))
        const { data: rows, error } = await supabase.from('admin_decisions').select('*').eq('report_id', report.id).eq('organization_id', organization.id)
        if (error) throw new ApiError(500, '관리자 판단을 불러오지 못했습니다.')
        const latest = latestBy((rows ?? []) as AdminDecision[], (d) => d.decided_at)
        // 같은 요청 재전송이면 새로 계산하지 않고 이미 저장된 결과를 돌려준다.
        if (!((rows ?? []) as AdminDecision[]).some((d) => d.request_id === input.requestId)) {
          const plan = planDecision(report, latest, input, context(organization))
          rpcOutcome(await callWorkflowRpc(supabase, 'workflow_append_decision', plan), '다른 곳에서 이 보고의 판단이 먼저 저장됐습니다. 최신 내용을 확인해 주세요.')
          await logAudit('record_decision', report.id, { decision: plan.decision })
        }
        return sendJson(res, 200, await reportView(supabase, organization, report.id))
      }
      case 'safety_review': {
        const input = body as unknown as SafetyReviewInput
        const report = await loadReportForWorkflow(supabase, String(input.reportId ?? ''))
        const { data: rows, error } = await supabase.from('safety_reviews').select('*').eq('report_id', report.id).eq('organization_id', organization.id)
        if (error) throw new ApiError(500, '안전 검토를 불러오지 못했습니다.')
        if (!((rows ?? []) as SafetyReview[]).some((r) => r.request_id === input.requestId)) {
          let related: CareAction | null = null
          if (input.relatedActionId) {
            if (!UUID_PATTERN.test(String(input.relatedActionId))) throw new ApiError(400, '연결할 조치 id가 올바르지 않습니다.')
            related = (await loadActionState(supabase, organization.id, String(input.relatedActionId))).action
          }
          const latest = latestBy((rows ?? []) as SafetyReview[], (r) => r.reviewed_at)
          const plan = planSafetyReview(report, latest, related, input, context(organization))
          rpcOutcome(await callWorkflowRpc(supabase, 'workflow_append_safety_review', plan), '다른 곳에서 이 신호의 검토가 먼저 저장됐습니다. 최신 내용을 확인해 주세요.')
          await logAudit('record_safety_review', report.id, { outcome: plan.outcome })
        }
        return sendJson(res, 200, await reportView(supabase, organization, report.id))
      }
      case 'create_action': {
        const input = body as unknown as CreateActionInput
        const recipientCode = String(input.recipientCode ?? '').trim().toUpperCase()
        if (!RECIPIENT_CODE_PATTERN.test(recipientCode)) throw new ApiError(400, '수급자 코드가 올바르지 않습니다.')
        const { data: recipient } = await supabase.from('recipients').select('code').eq('code', recipientCode).maybeSingle()
        if (!recipient) throw new ApiError(404, '이 기관에서 해당 수급자를 찾을 수 없습니다.')
        if (input.sourceReportId && !UUID_PATTERN.test(String(input.sourceReportId))) throw new ApiError(400, '근거 보고 id가 올바르지 않습니다.')
        if (input.decisionId && !UUID_PATTERN.test(String(input.decisionId))) throw new ApiError(400, '판단 id가 올바르지 않습니다.')
        const plan = planCreateAction({ ...input, recipientCode }, context(organization))
        const result = await callWorkflowRpc(supabase, 'workflow_create_action', { action: plan.action, obligations: plan.obligationInserts, event: plan.event })
        rpcOutcome(result, '같은 요청이 동시에 처리됐습니다. 목록을 새로 불러와 주세요.')
        const actionId = result.action_id ?? plan.action.id
        if (result.status === 'ok') await logAudit('create_action', actionId, { kind: plan.action.kind, status: plan.action.status })
        return sendJson(res, 200, await actionView(supabase, organization, actionId))
      }
      case 'mutate_action': {
        // 요청 종류(op)와 조치 변경 종류가 겹치지 않게, 변경 종류는 body.mutation으로 받는다.
        const input = { ...body, op: body.mutation } as unknown as ActionMutationInput
        const actionId = String(input.actionId ?? '')
        if (!UUID_PATTERN.test(actionId)) throw new ApiError(400, '조치 id가 올바르지 않습니다.')
        const s = await loadFullActionState(supabase, organization.id, actionId)
        if (s.events.some((e) => e.request_id === input.requestId)) return sendJson(res, 200, await actionView(supabase, organization, actionId))
        if (FIELD_REQUEST_OPS.includes(input.op) && !s.frReady) {
          throw new ApiError(503, '현장 요청 저장소가 아직 준비되지 않았습니다(3단계 DB 마이그레이션 적용 필요).')
        }
        const plan = planActionMutation(
          { action: s.action, obligations: s.obligations, requests: s.field.requests, responses: s.field.responses, assignees: s.assignees },
          input,
          context(organization),
        )
        const result = await callWorkflowRpc(supabase, 'workflow_apply_action_change', {
          action_id: actionId,
          expected_version: input.expectedVersion,
          request_id: plan.event.request_id,
          action: plan.action,
          obligation_updates: plan.obligationUpdates,
          obligation_inserts: plan.obligationInserts,
          // 3단계 입력 — 2단계 DB 함수는 이 키를 모르므로, 3단계 저장소가 없으면 보내지 않는다(위에서 3단계 변경은 막음).
          ...(s.frReady ? { request_inserts: plan.requestInserts, request_updates: plan.requestUpdates, verification_inserts: plan.verificationInserts } : {}),
          event: plan.event,
        })
        rpcOutcome(result, '다른 곳에서 이 조치가 먼저 수정됐습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.')
        if (result.status === 'ok') await logAudit('mutate_action', actionId, { op: input.op })
        return sendJson(res, 200, await actionView(supabase, organization, actionId))
      }
      default:
        throw new ApiError(400, '알 수 없는 요청입니다.')
    }
  } catch (e) {
    if (e instanceof WorkflowError) throw new ApiError(e.status, e.message)
    throw e
  }
}
