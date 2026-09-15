import type { ActionListResponse, CreateActionRequest, DecisionRequest, MutateActionRequest, SafetyReviewRequest } from '../shared/adminRepo'
import { WorkflowRequestError } from '../shared/adminRepo'
import { buildWorkBoard, type WorkBoard } from '../../../shared/workBoard'
import {
  FIELD_REQUEST_OPS,
  isRequestVisibleTo,
  latestBy,
  planActionMutation,
  planCreateAction,
  planDecision,
  planFieldResponse,
  planSafetyReview,
  WorkflowError,
  type FieldResponseInput,
  type WorkflowContext,
} from '../../../shared/workflow'
import {
  buildRecipientWorkflow,
  filterActions,
  summarizeAction,
  summarizeRequest,
  type ActionDetailView,
  type ActionFilter,
  type RecipientWorkflowView,
  type ReportWorkflowView,
  type RequestContext,
} from '../../../shared/workflowViews'
import { toCenterRequestView, type CenterRequestView, type CenterResponseResult } from '../../../shared/fieldRequests'
import { DEPLOYMENT_ORGANIZATION } from '../../../shared/organization'
import { demoAllReports, demoAssignmentMap, demoGetReport, demoReadWorkflow, demoWriteWorkflow, newDemoId } from './demoStore'

/** 데모 모드의 관리자 업무(2·3단계). 실서버와 같은 규칙(shared/workflow.ts)을 쓰고, 실DB 함수가
 * 하는 확인(중복 요청·버전 충돌·근거 보고/판단의 수급자 일치·응답 권한·늦은 응답)을 같은 계약으로
 * 흉내 낸다. localStorage라 탭 사이의 진짜 원자성은 없다.
 *
 * 데모 전용 스위치: `?demo=1&demo_workflow=off` = DB 마이그레이션 전체 미적용,
 * `?demo=1&demo_workflow=stage2` = 2단계만 적용(현장 요청 저장소 없음) 상태를 흉내 낸다 —
 * 화면이 가짜 0 대신 "준비 중"을 보이는지 확인하기 위한 것이다. */

function flag(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('demo_workflow')
  } catch {
    return null
  }
}

export function demoWorkflowReady(): boolean {
  return flag() !== 'off'
}

export function demoFieldRequestsReady(): boolean {
  return demoWorkflowReady() && flag() !== 'stage2'
}

function orgId(): string {
  return DEPLOYMENT_ORGANIZATION.id
}

function ctx(): WorkflowContext {
  return { now: new Date().toISOString(), organizationId: orgId(), newId: newDemoId }
}

function fail(status: number, message: string): never {
  throw new WorkflowRequestError(status, message)
}

function run<T>(fn: () => T): T {
  if (!demoWorkflowReady()) fail(503, '업무 기록 저장소가 아직 준비되지 않았습니다(DB 마이그레이션 적용 필요).')
  try {
    return fn()
  } catch (e) {
    if (e instanceof WorkflowError) fail(e.status, e.message)
    throw e
  }
}

/** 수급자 → 지금 배정된 요양보호사. */
function assigneesByRecipient(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [caregiver, recipients] of Object.entries(demoAssignmentMap())) {
    for (const r of recipients) (out[r] ??= []).push(caregiver)
  }
  for (const list of Object.values(out)) list.sort()
  return out
}

function requestContext(): RequestContext | undefined {
  if (!demoFieldRequestsReady()) return undefined
  const wf = demoReadWorkflow()
  return { requests: wf.fieldRequests, responses: wf.fieldResponses, reports: demoAllReports(), assigneesByRecipient: assigneesByRecipient() }
}

export function demoWorkBoard(): WorkBoard {
  const ready = demoWorkflowReady()
  const frReady = demoFieldRequestsReady()
  const wf = demoReadWorkflow()
  return buildWorkBoard({
    reports: demoAllReports(),
    safetyReviews: ready ? wf.safetyReviews : [],
    actions: ready ? wf.actions : [],
    obligations: ready ? wf.obligations : [],
    reportEvents: ready ? wf.reportEvents : [],
    workflowReady: ready,
    fieldRequestsReady: frReady,
    requests: frReady ? wf.fieldRequests : [],
    responses: frReady ? wf.fieldResponses : [],
    assigneesByRecipient: assigneesByRecipient(),
    now: new Date(),
  })
}

export function demoRecipientWorkflow(recipientCode: string, reportIds: string[]): RecipientWorkflowView {
  if (!demoWorkflowReady()) return { workflowReady: false, byReport: {}, actions: [] }
  const wf = demoReadWorkflow()
  return {
    workflowReady: true,
    ...buildRecipientWorkflow(reportIds, { ...wf, actions: wf.actions.filter((a) => a.recipient_code === recipientCode) }, new Date(), requestContext()),
  }
}

export function demoReportWorkflow(reportId: string): ReportWorkflowView {
  const report = demoGetReport(reportId)
  if (!report) fail(404, '보고를 찾을 수 없습니다.')
  const base: ReportWorkflowView = {
    workflowReady: false,
    report: {
      id: report.id,
      recipientCode: report.recipient_code,
      status: report.status,
      reviewStatus: report.review_status,
      emergencyFlagged: report.emergency_flagged,
      updatedAt: report.updated_at,
      submittedAt: report.submitted_at,
    },
    events: [],
    decisions: [],
    safetyReviews: [],
    actions: [],
    recipientOpenActions: [],
  }
  if (!demoWorkflowReady()) return base
  const wf = demoReadWorkflow()
  const now = new Date()
  const rc = requestContext()
  const summaries = wf.actions.filter((a) => a.recipient_code === report.recipient_code).map((a) => summarizeAction(a, wf.obligations, now, rc))
  return {
    ...base,
    workflowReady: true,
    events: wf.reportEvents.filter((e) => e.report_id === reportId),
    decisions: wf.decisions.filter((d) => d.report_id === reportId),
    safetyReviews: wf.safetyReviews.filter((s) => s.report_id === reportId),
    actions: summaries.filter((s) => s.sourceReportId === reportId),
    recipientOpenActions: summaries.filter((s) => s.status === 'open' || s.status === 'draft'),
  }
}

export function demoListActions(filter: ActionFilter, recipientCode?: string): ActionListResponse {
  const now = new Date()
  if (!demoWorkflowReady()) return { workflowReady: false, filter, asOf: now.toISOString(), actions: [] }
  const wf = demoReadWorkflow()
  const rc = requestContext()
  const actions = wf.actions.filter((a) => !recipientCode || a.recipient_code === recipientCode).map((a) => summarizeAction(a, wf.obligations, now, rc))
  return { workflowReady: true, filter, asOf: now.toISOString(), actions: filterActions(actions, filter) }
}

export function demoGetAction(actionId: string): ActionDetailView {
  return run(() => {
    const wf = demoReadWorkflow()
    const action = wf.actions.find((a) => a.id === actionId)
    if (!action) fail(404, '이 기관에서 해당 조치를 찾을 수 없습니다.')
    const now = new Date()
    const rc = requestContext()
    const own = wf.obligations.filter((o) => o.action_id === actionId)
    return {
      workflowReady: true,
      fieldRequestsReady: Boolean(rc),
      action,
      summary: summarizeAction(action, wf.obligations, now, rc),
      events: wf.actionEvents.filter((e) => e.action_id === actionId).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)),
      linkedSafetyReviews: wf.safetyReviews
        .filter((s) => s.related_action_id === actionId)
        .map((s) => ({ id: s.id, report_id: s.report_id, outcome: s.outcome, reviewed_at: s.reviewed_at })),
      requests: rc
        ? wf.fieldRequests
            .filter((r) => r.action_id === actionId)
            .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
            .map((request) => ({
              request,
              summary: summarizeRequest(request, own, rc, now.toISOString()),
              responses: wf.fieldResponses.filter((x) => x.field_request_id === request.id),
            }))
        : [],
      verifications: rc ? wf.verifications.filter((v) => v.action_id === actionId) : [],
      assignees: assigneesByRecipient()[action.recipient_code] ?? [],
    }
  })
}

export function demoRecordDecision(input: DecisionRequest): ReportWorkflowView {
  run(() => {
    const report = demoGetReport(input.reportId)
    if (!report) fail(404, '보고를 찾을 수 없습니다.')
    const wf = demoReadWorkflow()
    const mine = wf.decisions.filter((d) => d.report_id === report.id)
    if (mine.some((d) => d.request_id === input.requestId)) return
    const plan = planDecision(report, latestBy(mine, (d) => d.decided_at), input, ctx())
    demoWriteWorkflow((w) => {
      w.decisions.push(plan)
    })
  })
  return demoReportWorkflow(input.reportId)
}

export function demoRecordSafetyReview(input: SafetyReviewRequest): ReportWorkflowView {
  run(() => {
    const report = demoGetReport(input.reportId)
    if (!report) fail(404, '보고를 찾을 수 없습니다.')
    const wf = demoReadWorkflow()
    const mine = wf.safetyReviews.filter((s) => s.report_id === report.id)
    if (mine.some((s) => s.request_id === input.requestId)) return
    const related = input.relatedActionId ? (wf.actions.find((a) => a.id === input.relatedActionId) ?? null) : null
    if (input.relatedActionId && !related) fail(404, '연결할 조치를 찾을 수 없습니다.')
    const plan = planSafetyReview(report, latestBy(mine, (s) => s.reviewed_at), related, input, ctx())
    demoWriteWorkflow((w) => {
      w.safetyReviews.push(plan)
    })
  })
  return demoReportWorkflow(input.reportId)
}

export function demoCreateAction(input: CreateActionRequest): ActionDetailView {
  const id = run(() => {
    const wf = demoReadWorkflow()
    const existing = wf.actions.find((a) => a.create_request_id === input.requestId)
    if (existing) return existing.id
    const recipientCode = String(input.recipientCode ?? '').trim().toUpperCase()
    if (input.sourceReportId) {
      const source = demoGetReport(input.sourceReportId)
      if (!source || source.recipient_code !== recipientCode) fail(400, '근거 보고가 이 수급자의 보고가 아닙니다.')
    }
    if (input.decisionId) {
      const decision = wf.decisions.find((d) => d.id === input.decisionId)
      const decisionReport = decision ? demoGetReport(decision.report_id) : undefined
      if (!decisionReport || decisionReport.recipient_code !== recipientCode) fail(400, '연결할 판단이 이 수급자의 보고 판단이 아닙니다.')
    }
    const plan = planCreateAction({ ...input, recipientCode }, ctx())
    demoWriteWorkflow((w) => {
      w.actions.push(plan.action)
      w.obligations.push(...plan.obligationInserts)
      w.actionEvents.push(plan.event)
    })
    return plan.action.id
  })
  return demoGetAction(id)
}

export function demoMutateAction(input: MutateActionRequest): ActionDetailView {
  run(() => {
    const wf = demoReadWorkflow()
    const action = wf.actions.find((a) => a.id === input.actionId)
    if (!action) fail(404, '이 기관에서 해당 조치를 찾을 수 없습니다.')
    if (wf.actionEvents.some((e) => e.request_id === input.requestId)) return
    if (FIELD_REQUEST_OPS.includes(input.op) && !demoFieldRequestsReady()) {
      fail(503, '현장 요청 저장소가 아직 준비되지 않았습니다(3단계 DB 마이그레이션 적용 필요).')
    }
    const plan = planActionMutation(
      {
        action,
        obligations: wf.obligations.filter((o) => o.action_id === action.id),
        requests: wf.fieldRequests.filter((r) => r.action_id === action.id),
        responses: wf.fieldResponses.filter((r) => r.action_id === action.id),
        assignees: assigneesByRecipient()[action.recipient_code] ?? [],
      },
      input,
      ctx(),
    )
    demoWriteWorkflow((w) => {
      const idx = w.actions.findIndex((a) => a.id === action.id)
      // 실DB 함수와 같은 조건부 갱신: 그 사이 조치나 요청 버전이 바뀌었으면 쓰지 않는다.
      if (w.actions[idx].version !== input.expectedVersion) fail(409, '다른 곳에서 이 조치가 먼저 수정됐습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.')
      for (const u of plan.requestUpdates) {
        const cur = w.fieldRequests.find((r) => r.id === u.id)
        if (!cur || cur.version !== u.version - 1) fail(409, '현장 요청이 그 사이 바뀌었습니다(응답 도착 등). 최신 내용을 확인해 주세요.')
      }
      w.actions[idx] = plan.action
      w.obligations = w.obligations.map((o) => plan.obligationUpdates.find((u) => u.id === o.id) ?? o).concat(plan.obligationInserts)
      w.fieldRequests = w.fieldRequests.map((r) => plan.requestUpdates.find((u) => u.id === r.id) ?? r).concat(plan.requestInserts)
      w.verifications.push(...plan.verificationInserts)
      w.actionEvents.push(plan.event)
    })
  })
  return demoGetAction(input.actionId)
}

// ── 현장(요양보호사) 쪽 ─────────────────────────────────────────────

export function demoListCenterRequests(caregiverCode: string, recipientCode: string): { ready: boolean; requests: CenterRequestView[] } {
  if (!demoFieldRequestsReady()) return { ready: false, requests: [] }
  const mine = demoAssignmentMap()[caregiverCode] ?? []
  if (!mine.includes(recipientCode)) throw Object.assign(new Error('배정되지 않은 수급자입니다.'), { status: 403 })
  const wf = demoReadWorkflow()
  return {
    ready: true,
    requests: wf.fieldRequests
      .filter((r) => r.recipient_code === recipientCode && isRequestVisibleTo(r, caregiverCode, mine))
      .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))
      .map((r) => toCenterRequestView(r, wf.obligations.find((o) => o.id === r.obligation_id) ?? null)),
  }
}

export function demoMarkCenterRequestsShown(caregiverCode: string, ids: string[]) {
  if (!demoFieldRequestsReady() || ids.length === 0) return
  const mine = demoAssignmentMap()[caregiverCode] ?? []
  demoWriteWorkflow((w) => {
    w.fieldRequests = w.fieldRequests.map((r) =>
      ids.includes(r.id) && !r.first_shown_at && isRequestVisibleTo(r, caregiverCode, mine) ? { ...r, first_shown_at: new Date().toISOString(), first_shown_to: caregiverCode } : r,
    )
  })
}

/** 실DB 함수 workflow_record_field_response와 같은 규칙: 중복(같은 요청 식별자·같은 보고)은 한 건,
 * 권한은 지금 배정·지정 대상·본인 보고 기준, 게시 중이던 요청의 첫 응답만 의무를 이행으로 바꾼다. */
export function demoRecordCenterResponses(caregiverCode: string, reportId: string, inputs: FieldResponseInput[]): CenterResponseResult[] {
  if (inputs.length === 0) return []
  if (!demoFieldRequestsReady()) return inputs.map((i) => ({ fieldRequestId: i.fieldRequestId, status: 'not_ready' as const }))
  const results: CenterResponseResult[] = []
  for (const input of inputs) {
    const wf = demoReadWorkflow()
    const request = wf.fieldRequests.find((r) => r.id === input.fieldRequestId)
    if (!request) {
      results.push({ fieldRequestId: input.fieldRequestId, status: 'not_found' })
      continue
    }
    if (wf.fieldResponses.some((x) => x.request_id === input.requestId || (x.field_request_id === request.id && x.report_id === reportId))) {
      results.push({ fieldRequestId: input.fieldRequestId, status: 'duplicate' })
      continue
    }
    const report = demoGetReport(reportId)
    const action = wf.actions.find((a) => a.id === request.action_id)
    if (!report || !action) {
      results.push({ fieldRequestId: input.fieldRequestId, status: 'not_found' })
      continue
    }
    try {
      const assignees = assigneesByRecipient()[request.recipient_code] ?? []
      const plan = planFieldResponse(
        { report, responderCode: caregiverCode, assignees, request, action, obligation: wf.obligations.find((o) => o.id === request.obligation_id) ?? null },
        input,
        ctx(),
      )
      demoWriteWorkflow((w) => {
        w.fieldResponses.push(plan.response)
        if (plan.requestUpdate) w.fieldRequests = w.fieldRequests.map((r) => (r.id === plan.requestUpdate!.id ? plan.requestUpdate! : r))
        if (plan.obligationUpdate) w.obligations = w.obligations.map((o) => (o.id === plan.obligationUpdate!.id ? plan.obligationUpdate! : o))
        if (plan.actionUpdate) w.actions = w.actions.map((a) => (a.id === plan.actionUpdate!.id ? plan.actionUpdate! : a))
        w.actionEvents.push(plan.event)
      })
      results.push({ fieldRequestId: input.fieldRequestId, status: 'ok', fulfilledObligation: plan.response.fulfilled_obligation })
    } catch (e) {
      if (e instanceof WorkflowError) {
        results.push({ fieldRequestId: input.fieldRequestId, status: e.status === 403 ? 'forbidden' : 'invalid', message: e.message })
        continue
      }
      throw e
    }
  }
  return results
}
