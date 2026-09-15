import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError, getQuery, readJsonBody, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { requireAdminOrganization } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { logAudit } from '../_lib/audit.js'
import { todayKstDateString } from '../_lib/date.js'
import { callWorkflowRpc, fetchAll, loadActionState, loadWorkflowRows, workflowReady, type RpcResult } from '../_lib/workflowStore.js'
import { fieldRequestsReady, loadAssigneesByRecipient, loadFieldRows } from '../_lib/fieldRequestsStore.js'
import {
  baselineReady,
  callBaselineRpc,
  findDocumentByRequest,
  getOriginal,
  loadActionLinks,
  loadDocument,
  loadEntry,
  loadLineage,
  loadRecipientBaselineRows,
  putOriginal,
  readRawBody,
  removeOriginal,
  sha256Hex,
  storageReady,
} from '../_lib/baselineStore.js'
import {
  buildActionBaseline,
  buildRecipientBaseline,
  detectDocumentMime,
  emptyBaselineView,
  planChooseReference,
  planLinkAction,
  planRegisterDocument,
  planSaveEntry,
  planSetEntryStatus,
  planUnlinkAction,
  planWithdrawDocument,
  type ChooseReferenceInput,
  type LinkActionInput,
  type RecipientBaselineView,
  type RegisterDocumentInput,
  type SaveEntryInput,
  type SetEntryStatusInput,
  type SourceDocument,
  type WithdrawDocumentInput,
} from '../../shared/baseline.js'
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
  ADMIN_ACTOR_SCOPE,
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

/** 관리자 업무 API — 1단계 수급자 허브(조회), 2단계 판단·조치·안전 검토, 3단계 현장 요청 게시·결과 확인,
 * 4단계 기준문서·기준정보를 한 곳에서.
 * (Vercel 무료 요금제의 배포당 함수 12개 한도 때문에 파일을 늘리지 않고 이 한 함수로 묶었다.)
 *
 * 모든 요청은 관리자 세션 + 세션 기관 확인(requireAdminOrganization). 요청의 org가 다르면 403.
 * 2단계 테이블(db/migrations/2026-09-15-admin-workflow.sql)이 없으면 조회는 workflowReady:false로
 * 알려 화면이 "준비 중"을 보이게 하고, 저장은 503으로 거부한다(가짜 0건을 만들지 않는다).
 * 3단계 테이블(db/migrations/2026-09-16-field-requests.sql)이 없으면 fieldRequestsReady:false,
 * 게시·철회·대상 변경·결과 확인(mutate_action의 publish|withdraw|retarget|verify)은 503.
 * 현장 응답 자체는 요양보호사 보고 제출(api/care/reports.ts)에서 들어온다.
 * 4단계 테이블·비공개 버킷(db/migrations/2026-09-17-source-documents.sql)이 없으면 기준정보 조회는 ready:false,
 * 올리기·입력은 503. 기준정보가 없어도 조치·현장 요청은 그대로 쓴다(필수 관문이 아님).
 *
 * GET  ?org=&view=recipients                      수급자 목록 + 검토 대기(1단계)
 * GET  ?org=&view=recipient&code=A01&period=30    수급자 타임라인 + 보고별 판단·안전 검토·조치
 * GET  ?org=&view=board                           업무 카드 7개 + 전체 목록 + 통합 목록
 * GET  ?org=&view=report&reportId=                보고 한 건의 이벤트·판단·안전 검토·조치
 * GET  ?org=&view=actions&filter=&recipient=      조치 목록
 * GET  ?org=&view=action&id=                      조치 상세(의무·이력·현장 요청·응답·결과 확인·현재 배정)
 * GET  ?org=&view=baseline&code=A01               수급자 기준문서·기준정보(버전·상충·참고값)
 * GET  ?org=&view=document_file&id=               원본 파일(관리자만, 캐시 금지)
 * POST ?org=&op=upload_document  (본문 = 파일 바이트, 헤더 x-document-meta = base64 JSON)
 * POST ?org=  {op:'decide'|'safety_review'|'create_action'|'mutate_action'|'baseline'|'link_baseline'|'unlink_baseline', ...} */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST')
    const { organization } = await requireAdminOrganization(req)
    const supabase = getSupabaseAdmin()
    const q = getQuery(req)
    if (req.method === 'POST' && q.get('op') === 'upload_document') {
      await handleUpload(req, supabase, organization, res)
      return
    }
    if (req.method === 'POST') {
      await handlePost(supabase, organization, await readJsonBody(req), res)
      return
    }
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
      case 'baseline':
        return sendJson(res, 200, await baselineView(supabase, organization, q.get('code') ?? ''))
      case 'document_file':
        return sendDocumentFile(supabase, organization, q.get('id') ?? '', res)
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
    ...(await actionBaselineView(supabase, organization, s.action)),
  }
}

/** 조치의 근거 기준정보(연결 당시 버전)와 연결할 수 있는 확인된 값. 4단계 저장소가 없으면 비어 있다. */
async function actionBaselineView(
  supabase: SupabaseClient,
  organization: Organization,
  action: CareAction,
): Promise<Pick<ActionDetailView, 'baselineReady' | 'baselineLinks' | 'baselineOptions'>> {
  if (!(await baselineReady(supabase))) return { baselineReady: false, baselineLinks: [], baselineOptions: [] }
  const [links, rows] = await Promise.all([loadActionLinks(supabase, action.id), loadRecipientBaselineRows(supabase, organization.id, action.recipient_code)])
  const built = buildActionBaseline(action.id, links, rows.entries, rows.documents)
  return { baselineReady: true, baselineLinks: built.links, baselineOptions: built.options }
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
      case 'baseline':
        return sendJson(res, 200, await handleBaselineOp(supabase, organization, body))
      case 'link_baseline':
      case 'unlink_baseline':
        return sendJson(res, 200, await handleBaselineLink(supabase, organization, body))
      default:
        throw new ApiError(400, '알 수 없는 요청입니다.')
    }
  } catch (e) {
    if (e instanceof WorkflowError) throw new ApiError(e.status, e.message)
    throw e
  }
}

// ── 4단계: 기준문서 · 기준정보 ─────────────────────────────────────────

function recipientCodeOf(raw: string): string {
  const code = raw.trim().toUpperCase()
  if (!RECIPIENT_CODE_PATTERN.test(code)) throw new ApiError(400, '수급자 코드가 올바르지 않습니다.')
  return code
}

async function requireRecipient(supabase: SupabaseClient, code: string) {
  const { data, error } = await supabase.from('recipients').select('code').eq('code', code).maybeSingle()
  if (error) throw new ApiError(500, '수급자 정보를 불러오지 못했습니다.')
  if (!data) throw new ApiError(404, '이 기관에서 해당 수급자를 찾을 수 없습니다.')
}

function baselineError(e: unknown): never {
  if (e instanceof WorkflowError) throw new ApiError(e.status, e.message)
  throw e
}

async function baselineView(supabase: SupabaseClient, organization: Organization, rawCode: string): Promise<RecipientBaselineView> {
  const code = recipientCodeOf(rawCode)
  await requireRecipient(supabase, code)
  if (!(await baselineReady(supabase))) return emptyBaselineView(code, false)
  const [rows, stored] = await Promise.all([loadRecipientBaselineRows(supabase, organization.id, code), storageReady(supabase)])
  return buildRecipientBaseline(code, rows.documents, rows.entries, rows.choices, { storageReady: stored })
}

async function sendDocumentFile(supabase: SupabaseClient, organization: Organization, id: string, res: ServerResponse) {
  if (!UUID_PATTERN.test(id)) throw new ApiError(400, '문서 id가 올바르지 않습니다.')
  if (!(await baselineReady(supabase))) throw new ApiError(503, '기준정보 저장소가 아직 준비되지 않았습니다(4단계 DB 마이그레이션 적용 필요).')
  const doc = await loadDocument(supabase, organization.id, id)
  const bytes = await getOriginal(supabase, doc.storage_path)
  await logAudit('view_source_document', doc.id, { recipient: doc.recipient_code })
  res.statusCode = 200
  res.setHeader('content-type', doc.mime_type)
  res.setHeader('content-length', String(bytes.length))
  res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.original_filename)}`)
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(bytes)
}

function parseDocumentMeta(header: string | string[] | undefined): RegisterDocumentInput & { sha256?: string } {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw || raw.length > 8000) throw new ApiError(400, '문서 정보가 없습니다.')
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object')
    return parsed
  } catch {
    throw new ApiError(400, '문서 정보가 올바르지 않습니다.')
  }
}

/** 원본 올리기: 형식·크기·전송 무결성 확인 → 비공개 버킷 저장 → 기록 저장(한 요청 식별자당 한 벌).
 * 기록 저장이 실패하면 방금 올린 파일을 지운다(기록이 실제로 없을 때만) — 기록이 없는 파일을 가리키는 일은 없다. */
async function handleUpload(req: IncomingMessage, supabase: SupabaseClient, organization: Organization, res: ServerResponse) {
  if (!(await workflowReady(supabase)) || !(await baselineReady(supabase))) throw new ApiError(503, '기준정보 저장소가 아직 준비되지 않았습니다(4단계 DB 마이그레이션 적용 필요).')
  if (!(await storageReady(supabase))) throw new ApiError(503, '원본 파일 저장소(비공개 버킷)가 아직 준비되지 않았습니다(4단계 DB 마이그레이션 적용 필요).')
  const meta = parseDocumentMeta(req.headers['x-document-meta'])
  const bytes = await readRawBody(req)
  const code = recipientCodeOf(String(meta.recipientCode ?? ''))
  await requireRecipient(supabase, code)
  const requestId = String(meta.requestId ?? '')
  const existing = /^[A-Za-z0-9-]{8,80}$/.test(requestId) ? await findDocumentByRequest(supabase, organization.id, requestId) : null
  if (existing) return sendJson(res, 200, { document: existing, baseline: await baselineView(supabase, organization, existing.recipient_code) })
  const sha256 = sha256Hex(bytes)
  if (meta.sha256 && meta.sha256 !== sha256) throw new ApiError(400, '전송 중 파일이 달라졌습니다. 다시 시도해 주세요(아무것도 저장하지 않았습니다).')
  let replaced: SourceDocument | null = null
  if (meta.replacesDocumentId) {
    if (!UUID_PATTERN.test(String(meta.replacesDocumentId))) throw new ApiError(400, '교체할 문서 id가 올바르지 않습니다.')
    replaced = await loadDocument(supabase, organization.id, String(meta.replacesDocumentId))
  }
  let plan: SourceDocument
  try {
    plan = planRegisterDocument({ ...meta, recipientCode: code }, { sizeBytes: bytes.length, sha256, detectedMime: detectDocumentMime(bytes) }, replaced, context(organization))
  } catch (e) {
    baselineError(e)
  }
  await putOriginal(supabase, plan.storage_path, bytes, plan.mime_type)
  let result
  try {
    result = await callBaselineRpc(supabase, { op: 'register_document', document: plan })
  } catch (e) {
    // 기록이 실제로 저장되지 않았을 때만 파일을 지운다(응답만 끊긴 경우 파일을 지우면 기록이 없는 파일을 가리키게 된다).
    const saved = await findDocumentByRequest(supabase, organization.id, plan.request_id).catch(() => undefined)
    if (saved === null) await removeOriginal(supabase, plan.storage_path)
    throw e
  }
  if (result.status !== 'ok' && result.status !== 'duplicate') {
    await removeOriginal(supabase, plan.storage_path)
    rpcOutcome(result, '다른 곳에서 이 문서가 먼저 바뀌었습니다. 최신 내용을 확인해 주세요.')
  }
  if (result.status === 'ok') await logAudit('upload_source_document', plan.id, { recipient: code, type: plan.doc_type, size: plan.size_bytes })
  const doc = await findDocumentByRequest(supabase, organization.id, plan.request_id)
  return sendJson(res, 200, { document: doc, baseline: await baselineView(supabase, organization, code) })
}

function uuidOf(v: unknown, what: string): string {
  const id = String(v ?? '')
  if (!UUID_PATTERN.test(id)) throw new ApiError(400, `${what} id가 올바르지 않습니다.`)
  return id
}

async function handleBaselineOp(supabase: SupabaseClient, organization: Organization, body: Record<string, unknown>): Promise<RecipientBaselineView> {
  if (!(await baselineReady(supabase))) throw new ApiError(503, '기준정보 저장소가 아직 준비되지 않았습니다(4단계 DB 마이그레이션 적용 필요).')
  const ctx = context(organization)
  try {
    switch (body.baselineOp) {
      case 'withdraw_document': {
        const input = body as unknown as WithdrawDocumentInput
        const doc = await loadDocument(supabase, organization.id, uuidOf(input.documentId, '문서'))
        if (doc.withdraw_request_id !== input.requestId) {
          const next = planWithdrawDocument(doc, input, ctx)
          rpcOutcome(
            await callBaselineRpc(supabase, {
              op: 'withdraw_document',
              organization_id: organization.id,
              document_id: doc.id,
              expected_version: input.expectedVersion,
              reason: next.withdrawn_reason,
              request_id: next.withdraw_request_id,
              at: next.withdrawn_at,
            }),
            '다른 곳에서 이 문서가 먼저 바뀌었습니다. 최신 내용을 확인해 주세요.',
          )
          await logAudit('withdraw_source_document', doc.id, { recipient: doc.recipient_code })
        }
        return baselineView(supabase, organization, doc.recipient_code)
      }
      case 'save_entry': {
        const input = body as unknown as SaveEntryInput
        const code = recipientCodeOf(String(input.recipientCode ?? ''))
        await requireRecipient(supabase, code)
        const document = input.sourceType === 'document' && input.documentId ? await loadDocument(supabase, organization.id, uuidOf(input.documentId, '문서')) : null
        const lineage = input.lineageId ? await loadLineage(supabase, organization.id, uuidOf(input.lineageId, '기준정보')) : []
        const entry = planSaveEntry({ ...input, recipientCode: code }, { document, lineage }, ctx)
        const r = await callBaselineRpc(supabase, { op: 'save_entry', entry })
        rpcOutcome(r, '다른 곳에서 이 기준정보가 먼저 수정됐습니다. 최신 내용을 확인해 주세요.')
        if (r.status === 'ok') await logAudit('save_baseline_entry', entry.id, { recipient: code, kind: entry.kind, version: entry.version })
        return baselineView(supabase, organization, code)
      }
      case 'set_entry_status': {
        const input = body as unknown as SetEntryStatusInput
        const entry = await loadEntry(supabase, organization.id, uuidOf(input.entryId, '기준정보'))
        if (entry.status_request_id !== input.requestId) {
          const lineage = await loadLineage(supabase, organization.id, entry.lineage_id)
          const [updated] = planSetEntryStatus(entry, lineage, input, ctx)
          rpcOutcome(
            await callBaselineRpc(supabase, {
              op: 'set_entry_status',
              organization_id: organization.id,
              entry_id: entry.id,
              status: updated.status,
              expected_row_version: input.expectedRowVersion,
              reason: updated.retract_reason,
              entered_by_label: updated.confirmed_by_label,
              request_id: updated.status_request_id,
              at: ctx.now,
            }),
            '다른 곳에서 이 기준정보가 먼저 바뀌었습니다. 최신 내용을 확인해 주세요.',
          )
          await logAudit('set_baseline_status', entry.id, { status: updated.status })
        }
        return baselineView(supabase, organization, entry.recipient_code)
      }
      case 'choose_reference': {
        const input = body as unknown as ChooseReferenceInput
        const entry = await loadEntry(supabase, organization.id, uuidOf(input.entryId, '기준정보'))
        const choice = planChooseReference(entry, input, ctx)
        rpcOutcome(await callBaselineRpc(supabase, { op: 'choose_reference', choice }), '그 사이 이 값이 바뀌었습니다. 최신 내용을 확인해 주세요.')
        await logAudit('choose_baseline_reference', entry.id, { group: choice.group_key })
        return baselineView(supabase, organization, entry.recipient_code)
      }
      default:
        throw new ApiError(400, '알 수 없는 기준정보 요청입니다.')
    }
  } catch (e) {
    baselineError(e)
  }
}

async function handleBaselineLink(supabase: SupabaseClient, organization: Organization, body: Record<string, unknown>): Promise<ActionDetailView> {
  if (!(await baselineReady(supabase))) throw new ApiError(503, '기준정보 저장소가 아직 준비되지 않았습니다(4단계 DB 마이그레이션 적용 필요).')
  const actionId = uuidOf(body.actionId, '조치')
  const { action } = await loadActionState(supabase, organization.id, actionId)
  const links = await loadActionLinks(supabase, actionId)
  const ctx = context(organization)
  const enteredBy = typeof body.enteredByLabel === 'string' ? body.enteredByLabel.trim().slice(0, 100) || null : null
  const event = (type: 'baseline_linked' | 'baseline_unlinked', requestId: string, detail: Record<string, unknown>, reason: string | null) => ({
    id: ctx.newId(),
    action_id: action.id,
    obligation_id: null,
    event_type: type,
    reason,
    detail,
    actor_scope: ADMIN_ACTOR_SCOPE,
    entered_by_label: enteredBy,
    owner_label_at_event: action.owner_label,
    request_id: requestId,
    occurred_at: ctx.now,
  })
  try {
    if (body.op === 'link_baseline') {
      const input = body as unknown as LinkActionInput
      if (!links.some((l) => l.request_id === input.requestId)) {
        const entry = await loadEntry(supabase, organization.id, uuidOf(input.entryId, '기준정보'))
        const link = planLinkAction(action, entry, links, input, ctx)
        rpcOutcome(
          await callBaselineRpc(supabase, {
            op: 'link_action',
            organization_id: organization.id,
            link,
            event: event('baseline_linked', link.request_id, { link_id: link.id, entry_id: entry.id, entry_version: entry.version, lineage_id: entry.lineage_id, document_id: entry.document_id }, link.note),
          }),
          '이미 연결됐거나 그 사이 기준정보가 바뀌었습니다. 최신 내용을 확인해 주세요.',
        )
        await logAudit('link_action_baseline', action.id, { entry: entry.id })
      }
    } else {
      const linkId = uuidOf(body.linkId, '연결')
      const link = links.find((l) => l.id === linkId)
      if (!link) throw new ApiError(404, '연결을 찾을 수 없습니다.')
      if (link.removed_request_id !== body.requestId) {
        const next = planUnlinkAction(action, link, { reason: String(body.reason ?? ''), requestId: String(body.requestId ?? '') }, ctx)
        rpcOutcome(
          await callBaselineRpc(supabase, {
            op: 'unlink_action',
            organization_id: organization.id,
            link_id: link.id,
            reason: next.removed_reason,
            request_id: next.removed_request_id,
            at: next.removed_at,
            event: event('baseline_unlinked', next.removed_request_id as string, { link_id: link.id, entry_id: link.entry_id }, next.removed_reason),
          }),
          '그 사이 연결이 바뀌었습니다. 최신 내용을 확인해 주세요.',
        )
        await logAudit('unlink_action_baseline', action.id, { link: link.id })
      }
    }
  } catch (e) {
    baselineError(e)
  }
  return actionView(supabase, organization, action.id)
}
