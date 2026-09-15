/** 관리자 화면이 받는 업무 보기(서버·데모 공통 계산). 저장 행을 그대로 넘기지 않고,
 * 화면에 필요한 판정(기한 지남·오늘 재확인·담당 미지정)을 같은 기준 시각으로 붙인다. */
import {
  isObligationDueToday,
  isObligationOverdue,
  kstDayRange,
  latestBy,
  type ActionEvent,
  type ActionKind,
  type ActionObligation,
  type ActionStatus,
  type AdminDecision,
  type CareAction,
  type DecisionKind,
  type DueKind,
  type ObligationStatus,
  type ObligationType,
  type ReportEvent,
  type SafetyOutcome,
  type SafetyReview,
  type ActionVerification,
  type FieldRequest,
  type FieldRequestStatus,
  type FieldResponse,
  type RequestTargetMode,
  type VerificationOutcome,
} from './workflow.js'
import { requestWaitState, routingProblem, type RequestWaitState, type RoutingProblem } from './fieldRequests.js'
import type { ActionBaselineLinkView, BaselineOption } from './baseline.js'
import type { CandidateReview } from './changeCandidates.js'

export interface ObligationView {
  id: string
  cycleNo: number
  type: ObligationType
  status: ObligationStatus
  initialDueKind: DueKind
  initialDueAt: string | null
  currentDueKind: DueKind
  currentDueAt: string | null
  /** 최초 기한과 현재 기한이 다름(변경 이력 있음). */
  dueChanged: boolean
  overdue: boolean
  dueToday: boolean
}

export interface ActionSummary {
  id: string
  recipientCode: string
  sourceReportId: string | null
  decisionId: string | null
  kind: ActionKind
  status: ActionStatus
  purpose: string
  ownerLabel: string | null
  fieldMessageStatus: CareAction['field_message_status']
  version: number
  currentCycle: number
  createdAt: string
  updatedAt: string
  obligations: ObligationView[]
  overdue: boolean
  dueToday: boolean
  /** 3단계: 현재 후속 주기의 현장 요청(없으면 null). */
  request: RequestSummary | null
  /** 3단계: 현재 주기에 응답이 도착했고 관리자 결과 확인을 기다림. */
  awaitingVerification: boolean
  closureOutcome: VerificationOutcome | null
}

export interface RequestSummary {
  id: string
  status: FieldRequestStatus
  targetMode: RequestTargetMode
  targetCaregiverCode: string | null
  publishedAt: string
  firstShownAt: string | null
  waitState: RequestWaitState | null
  reportsSincePublish: number
  routing: RoutingProblem | null
  responseCount: number
}

/** summarizeAction에 3단계 정보를 붙이기 위한 선택 입력(없으면 요청 정보 없이 요약). */
export interface RequestContext {
  requests: FieldRequest[]
  responses: FieldResponse[]
  /** 이 기관의 실제 보고(방문 근거 계산용 — 게시 뒤 제출된 보고 수만 센다). */
  reports: Array<{ id: string; recipient_code: string; participant_code: string; status: string; submitted_at?: string | null; report_source?: string; deleted?: boolean }>
  /** 수급자별 현재 활성 배정 요양보호사. */
  assigneesByRecipient: Record<string, string[]>
}

function obligationView(o: ActionObligation, nowIso: string, day: { start: string; end: string }): ObligationView {
  return {
    id: o.id,
    cycleNo: o.cycle_no,
    type: o.obligation_type,
    status: o.status,
    initialDueKind: o.initial_due_kind,
    initialDueAt: o.initial_due_at,
    currentDueKind: o.current_due_kind,
    currentDueAt: o.current_due_at,
    dueChanged: o.initial_due_kind !== o.current_due_kind || Date.parse(o.initial_due_at ?? '0') !== Date.parse(o.current_due_at ?? '0'),
    overdue: isObligationOverdue(o, nowIso),
    dueToday: o.obligation_type === 'admin_verification' && isObligationDueToday(o, day),
  }
}

export function summarizeRequest(r: FieldRequest, obligations: ActionObligation[], rc: RequestContext, nowIso: string): RequestSummary {
  const wait = requestWaitState(r, obligations.find((o) => o.id === r.obligation_id) ?? null, rc.reports, nowIso)
  return {
    id: r.id,
    status: r.status,
    targetMode: r.target_mode,
    targetCaregiverCode: r.target_caregiver_code,
    publishedAt: r.published_at,
    firstShownAt: r.first_shown_at,
    waitState: wait?.state ?? null,
    reportsSincePublish: wait?.reportsSincePublish ?? 0,
    routing: routingProblem(r, rc.assigneesByRecipient[r.recipient_code] ?? []),
    responseCount: rc.responses.filter((x) => x.field_request_id === r.id).length,
  }
}

export function summarizeAction(a: CareAction, obligations: ActionObligation[], now: Date, rc?: RequestContext): ActionSummary {
  const nowIso = now.toISOString()
  const day = kstDayRange(now)
  const own = obligations.filter((o) => o.action_id === a.id)
  const obs = own
    .sort((x, y) => x.cycle_no - y.cycle_no || x.obligation_type.localeCompare(y.obligation_type))
    .map((o) => obligationView(o, nowIso, day))
  const live = a.status === 'open'
  const currentRequest = rc
    ? rc.requests.filter((r) => r.action_id === a.id && r.cycle_no === a.current_cycle).sort((x, y) => Date.parse(y.published_at) - Date.parse(x.published_at))[0] ?? null
    : null
  const request = currentRequest && rc ? summarizeRequest(currentRequest, own, rc, nowIso) : null
  return {
    id: a.id,
    recipientCode: a.recipient_code,
    sourceReportId: a.source_report_id,
    decisionId: a.decision_id,
    kind: a.kind,
    status: a.status,
    purpose: a.purpose,
    ownerLabel: a.owner_label,
    fieldMessageStatus: a.field_message_status,
    version: a.version,
    currentCycle: a.current_cycle,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    obligations: obs,
    overdue: live && obs.some((o) => o.overdue),
    dueToday: live && obs.some((o) => o.dueToday),
    request,
    awaitingVerification: live && request?.status === 'answered',
    closureOutcome: a.closure_outcome ?? null,
  }
}

export const ACTION_FILTERS = ['open', 'draft', 'overdue', 'today', 'unassigned', 'completed', 'cancelled', 'all'] as const
export type ActionFilter = (typeof ACTION_FILTERS)[number]
export const ACTION_FILTER_LABELS: Record<ActionFilter, string> = {
  open: '진행 중',
  draft: '초안',
  overdue: '기한 지남',
  today: '오늘 재확인',
  unassigned: '담당 미지정',
  completed: '완료',
  cancelled: '취소',
  all: '전체',
}

export function parseActionFilter(v: string | null | undefined): ActionFilter {
  return (ACTION_FILTERS as readonly string[]).includes(v ?? '') ? (v as ActionFilter) : 'open'
}

/** 조치 목록 필터 — 업무 카드와 같은 판정(summarizeAction의 overdue/dueToday)을 쓴다. */
export function filterActions(list: ActionSummary[], filter: ActionFilter): ActionSummary[] {
  const pick = (s: ActionSummary) => {
    switch (filter) {
      case 'open':
        return s.status === 'open'
      case 'draft':
        return s.status === 'draft'
      case 'overdue':
        return s.overdue
      case 'today':
        return s.dueToday
      case 'unassigned':
        return (s.status === 'open' || s.status === 'draft') && !s.ownerLabel
      case 'completed':
        return s.status === 'completed'
      case 'cancelled':
        return s.status === 'cancelled'
      case 'all':
        return true
    }
  }
  return list.filter(pick).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

export interface ReportWorkflowView {
  workflowReady: boolean
  report: { id: string; recipientCode: string; status: string; reviewStatus: string; emergencyFlagged: boolean; updatedAt: string; submittedAt: string | null }
  /** 이 보고의 제출·검토 이벤트(기능 적용 이후 것만). */
  events: ReportEvent[]
  decisions: AdminDecision[]
  safetyReviews: SafetyReview[]
  /** 이 보고를 근거로 만든 조치. */
  actions: ActionSummary[]
  /** 같은 수급자의 진행 중·초안 조치 — 안전 검토를 기존 조치에 연결할 때 고른다. */
  recipientOpenActions: ActionSummary[]
}

export interface ActionDetailView {
  workflowReady: true
  /** 3단계 저장소(현장 요청·응답·결과 확인) 준비 여부. false면 게시·결과 확인을 "준비 중"으로 둔다. */
  fieldRequestsReady: boolean
  action: CareAction
  summary: ActionSummary
  events: ActionEvent[]
  /** 이 조치를 관련 조치로 연결한 안전 검토. */
  linkedSafetyReviews: Array<Pick<SafetyReview, 'id' | 'report_id' | 'outcome' | 'reviewed_at'>>
  /** 3단계: 모든 주기의 현장 요청(최근 게시가 위)과 각 요청의 응답. */
  requests: Array<{ request: FieldRequest; summary: RequestSummary; responses: FieldResponse[] }>
  verifications: ActionVerification[]
  /** 게시·대상 변경에 쓰는 현재 활성 배정 요양보호사. */
  assignees: string[]
  /** 4단계: 기준정보 저장소 준비 여부와 이 조치의 근거 연결(연결 당시 버전) · 연결할 수 있는 확인된 값. */
  baselineReady: boolean
  baselineLinks: ActionBaselineLinkView[]
  baselineOptions: BaselineOption[]
  /** 5단계: 이 조치에 연결된 반복 보고·값 비교 후보 판단(판단 당시 근거 스냅샷 포함). */
  candidateReviews: CandidateReview[]
}

export interface RecipientWorkflowView {
  workflowReady: boolean
  byReport: Record<string, { decision: { decision: DecisionKind; decidedAt: string } | null; safety: { outcome: SafetyOutcome; reviewedAt: string } | null; actionIds: string[] }>
  actions: ActionSummary[]
}

export function buildRecipientWorkflow(
  reportIds: string[],
  rows: { decisions: AdminDecision[]; safetyReviews: SafetyReview[]; actions: CareAction[]; obligations: ActionObligation[] },
  now: Date,
  rc?: RequestContext,
): Omit<RecipientWorkflowView, 'workflowReady'> {
  const byReport: RecipientWorkflowView['byReport'] = {}
  for (const id of reportIds) {
    const d = latestBy(rows.decisions.filter((x) => x.report_id === id), (x) => x.decided_at)
    const s = latestBy(rows.safetyReviews.filter((x) => x.report_id === id), (x) => x.reviewed_at)
    byReport[id] = {
      decision: d ? { decision: d.decision, decidedAt: d.decided_at } : null,
      safety: s ? { outcome: s.outcome, reviewedAt: s.reviewed_at } : null,
      actionIds: rows.actions.filter((a) => a.source_report_id === id).map((a) => a.id),
    }
  }
  return { byReport, actions: rows.actions.map((a) => summarizeAction(a, rows.obligations, now, rc)) }
}
