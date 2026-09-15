import type { ActionListResponse, CreateActionRequest, DecisionRequest, MutateActionRequest, SafetyReviewRequest } from '../shared/adminRepo'
import { WorkflowRequestError } from '../shared/adminRepo'
import { buildWorkBoard, type WorkBoard } from '../../../shared/workBoard'
import {
  latestBy,
  planActionMutation,
  planCreateAction,
  planDecision,
  planSafetyReview,
  WorkflowError,
  type WorkflowContext,
} from '../../../shared/workflow'
import {
  buildRecipientWorkflow,
  filterActions,
  summarizeAction,
  type ActionDetailView,
  type ActionFilter,
  type RecipientWorkflowView,
  type ReportWorkflowView,
} from '../../../shared/workflowViews'
import { DEPLOYMENT_ORGANIZATION } from '../../../shared/organization'
import { demoAllReports, demoGetReport, demoReadWorkflow, demoWriteWorkflow, newDemoId } from './demoStore'

/** 데모 모드의 관리자 업무(2단계). 실서버와 같은 규칙(shared/workflow.ts)을 쓰고, 실DB 함수가
 * 하는 확인(중복 요청·버전 충돌·근거 보고/판단의 수급자 일치)을 같은 계약으로 흉내 낸다.
 * localStorage라 탭 사이의 진짜 원자성은 없다.
 *
 * `?demo=1&demo_workflow=off`로 열면 "DB 마이그레이션 적용 전" 상태를 흉내 낸다 — 화면이
 * 가짜 0 대신 "준비 중"을 보이는지 확인하기 위한 데모 전용 스위치다. */

export function demoWorkflowReady(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('demo_workflow') !== 'off'
  } catch {
    return true
  }
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

export function demoWorkBoard(): WorkBoard {
  const ready = demoWorkflowReady()
  const wf = demoReadWorkflow()
  return buildWorkBoard({
    reports: demoAllReports(),
    safetyReviews: ready ? wf.safetyReviews : [],
    actions: ready ? wf.actions : [],
    obligations: ready ? wf.obligations : [],
    reportEvents: ready ? wf.reportEvents : [],
    workflowReady: ready,
    now: new Date(),
  })
}

export function demoRecipientWorkflow(recipientCode: string, reportIds: string[]): RecipientWorkflowView {
  if (!demoWorkflowReady()) return { workflowReady: false, byReport: {}, actions: [] }
  const wf = demoReadWorkflow()
  return {
    workflowReady: true,
    ...buildRecipientWorkflow(reportIds, { ...wf, actions: wf.actions.filter((a) => a.recipient_code === recipientCode) }, new Date()),
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
  const summaries = wf.actions.filter((a) => a.recipient_code === report.recipient_code).map((a) => summarizeAction(a, wf.obligations, now))
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
  const actions = wf.actions.filter((a) => !recipientCode || a.recipient_code === recipientCode).map((a) => summarizeAction(a, wf.obligations, now))
  return { workflowReady: true, filter, asOf: now.toISOString(), actions: filterActions(actions, filter) }
}

export function demoGetAction(actionId: string): ActionDetailView {
  return run(() => {
    const wf = demoReadWorkflow()
    const action = wf.actions.find((a) => a.id === actionId)
    if (!action) fail(404, '이 기관에서 해당 조치를 찾을 수 없습니다.')
    return {
      workflowReady: true,
      action,
      summary: summarizeAction(action, wf.obligations, new Date()),
      events: wf.actionEvents.filter((e) => e.action_id === actionId).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)),
      linkedSafetyReviews: wf.safetyReviews
        .filter((s) => s.related_action_id === actionId)
        .map((s) => ({ id: s.id, report_id: s.report_id, outcome: s.outcome, reviewed_at: s.reviewed_at })),
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
    const plan = planActionMutation({ action, obligations: wf.obligations.filter((o) => o.action_id === action.id) }, input, ctx())
    demoWriteWorkflow((w) => {
      const idx = w.actions.findIndex((a) => a.id === action.id)
      // 실DB 함수와 같은 조건부 갱신: 그 사이 버전이 바뀌었으면 쓰지 않는다.
      if (w.actions[idx].version !== input.expectedVersion) fail(409, '다른 곳에서 이 조치가 먼저 수정됐습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.')
      w.actions[idx] = plan.action
      w.obligations = w.obligations.map((o) => plan.obligationUpdates.find((u) => u.id === o.id) ?? o).concat(plan.obligationInserts)
      w.actionEvents.push(plan.event)
    })
  })
  return demoGetAction(input.actionId)
}
