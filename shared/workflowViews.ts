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
} from './workflow.js'

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
  fieldMessageStatus: 'unpublished' | 'not_applicable'
  version: number
  currentCycle: number
  createdAt: string
  updatedAt: string
  obligations: ObligationView[]
  overdue: boolean
  dueToday: boolean
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

export function summarizeAction(a: CareAction, obligations: ActionObligation[], now: Date): ActionSummary {
  const nowIso = now.toISOString()
  const day = kstDayRange(now)
  const obs = obligations
    .filter((o) => o.action_id === a.id)
    .sort((x, y) => x.cycle_no - y.cycle_no || x.obligation_type.localeCompare(y.obligation_type))
    .map((o) => obligationView(o, nowIso, day))
  const live = a.status === 'open'
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
  action: CareAction
  summary: ActionSummary
  events: ActionEvent[]
  /** 이 조치를 관련 조치로 연결한 안전 검토. */
  linkedSafetyReviews: Array<Pick<SafetyReview, 'id' | 'report_id' | 'outcome' | 'reviewed_at'>>
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
  return { byReport, actions: rows.actions.map((a) => summarizeAction(a, rows.obligations, now)) }
}
