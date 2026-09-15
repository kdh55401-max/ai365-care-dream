/** 기관 첫 화면의 업무 카드 4개와 각 카드의 전체 목록, 그리고 운영 규칙 순서의 통합 목록.
 * 서버가 권한 범위의 전체 데이터를 읽어 이 함수로 한 번에 계산한다 — 카드 숫자와 목록이
 * 같은 기준 시각·같은 조건에서 나오게 하기 위함(화면에 로딩된 일부만 세지 않는다).
 *
 * 카드는 대상과 단위가 달라 합산하지 않는다: 안전 신호(신호 수·수급자 수), 새 보고(보고 수),
 * 기한 지난 조치(조치 수·의무 수), 오늘 재확인(조치 수·의무 수).
 * 3단계 카드: 응답 대기 요청(요청 수), 결과 확인 대기(조치 수), 재배정·담당 필요(요청 수·조치 수).
 * 정렬은 운영 규칙이다(안전 신호 → 기한 초과 → 오늘 재확인 → 응답 도착·결과 확인 → 재배정 필요 → 변화·확인 필요 보고 → 일반 보고,
 * 같은 범주는 오래 기다린 순) — 임상 중증도 순위가 아니다. */
import { buildReviewQueue, type ReviewQueueItem } from './recipientHub.js'
import type { CareReportRecord } from './careTypes.js'
import {
  isObligationDueToday,
  isObligationOverdue,
  kstDayRange,
  latestBy,
  timeOf,
  type ActionKind,
  type ActionObligation,
  type ActionStatus,
  type CareAction,
  type DueKind,
  type ObligationType,
  type ReportEvent,
  type SafetyOutcome,
  type SafetyReview,
  type FieldRequest,
  type FieldResponse,
  type RequestTargetMode,
} from './workflow.js'
import { requestWaitState, routingProblem, type RequestWaitState, type RoutingProblem } from './fieldRequests.js'
import { computeRepeatCandidates, reviewStateOf, type CandidateDecision, type CandidateReview, type RepeatCandidate } from './changeCandidates.js'

type BoardReport = Partial<CareReportRecord> & Pick<CareReportRecord, 'id' | 'recipient_code' | 'participant_code' | 'status'>

export interface SafetySignalItem {
  reportId: string
  recipientCode: string
  participantCode: string
  reportStatus: 'draft' | 'submitted'
  /** 보고 검토(승인/반려) 상태 — 안전 검토와 별개로 함께 보여준다. */
  reportReviewStatus: string
  /** 제출 보고는 제출 시각, 임시저장은 시작 시각. */
  at: string | null
  excerpt: string | null
  latestReview: { outcome: SafetyOutcome; reviewedAt: string } | null
}

export interface ObligationBrief {
  obligationId: string
  type: ObligationType
  dueKind: DueKind
  dueAt: string | null
  initialDueKind: DueKind
  initialDueAt: string | null
}

export interface ActionWorkItem {
  actionId: string
  recipientCode: string
  kind: ActionKind
  status: ActionStatus
  purpose: string
  ownerLabel: string | null
  sourceReportId: string | null
  overdue: ObligationBrief[]
  dueToday: ObligationBrief[]
}

export type WorkCategory = 'safety' | 'overdue' | 'verification_today' | 'verification_pending' | 'reassign' | 'report_attention' | 'report_general'

export const WORK_CATEGORY_LABELS: Record<WorkCategory, string> = {
  safety: '안전 신호 미검토',
  overdue: '기한 지난 조치',
  verification_today: '오늘 재확인',
  verification_pending: '응답 도착 · 결과 확인 대기',
  reassign: '재배정·담당 필요',
  report_attention: '변화·확인 필요 보고',
  report_general: '새 보고 미확인',
}

export interface RequestWorkItem {
  requestId: string
  actionId: string
  recipientCode: string
  purpose: string
  message: string
  targetMode: RequestTargetMode
  targetCaregiverCode: string | null
  publishedAt: string
  firstShownAt: string | null
  waitState: RequestWaitState | null
  reportsSincePublish: number
  routing: RoutingProblem | null
  responseDueKind: string
  responseDueAt: string | null
}

export interface VerificationWorkItem {
  actionId: string
  recipientCode: string
  purpose: string
  requestId: string
  answeredAt: string | null
  responseCount: number
  latestResponseStatus: string | null
  ownerLabel: string | null
}

export interface CombinedWorkItem {
  key: string
  category: WorkCategory
  recipientCode: string
  reportId: string | null
  actionId: string | null
  headline: string
  notes: string[]
  /** 이 범주 안에서 오래 기다린 순으로 세우는 기준 시각. */
  waitingSince: string | null
}

export interface WorkBoard {
  asOf: string
  today: { date: string; start: string; end: string }
  /** 판단·조치·안전 검토 저장소(DB 마이그레이션) 준비 여부. false면 해당 카드는 "준비 중". */
  workflowReady: boolean
  cards: {
    safety: { ready: boolean; signals: number; recipients: number; draftSignals: number; legacyUnclear: number }
    reports: { reports: number; recipients: number }
    overdue: { ready: boolean; actions: number; obligations: number }
    today: { ready: boolean; actions: number; obligations: number }
    /** 3단계: 게시돼 응답을 기다리는 요청(요청 수). */
    requests: { ready: boolean; requests: number; overdue: number; reportsWithoutAnswer: number; awaitingVisit: number }
    /** 3단계: 응답이 도착해 관리자 결과 확인을 기다리는 조치(조치 수). */
    verification: { ready: boolean; actions: number }
    /** 재배정 필요한 게시 요청(요청 수)과 담당 미지정 조치(조치 수). */
    reassign: { ready: boolean; requests: number; unassignedActions: number }
    /** 5단계: 반복 보고 후보(초기 운영 규칙 v1, 보고일 기준 — 관찰일 없음). 후보 수·수급자 수·변화 신호 수를 구분한다. */
    repeat: { candidates: number; recipients: number; unreviewed: number; signals: number; changedRecipients: number; reviewsReady: boolean }
  }
  lists: {
    safety: SafetySignalItem[]
    /** 제출 전 임시저장에 남은 신호(서버에 저장된 것만) — 제출 지표에서 제외. */
    safetyDrafts: SafetySignalItem[]
    /** 이 기능 이전에 보고 승인/반려만 있고 안전 검토 기록이 없는 신호 — 검토 여부 불명확. */
    safetyLegacy: SafetySignalItem[]
    reports: ReviewQueueItem[]
    overdue: ActionWorkItem[]
    today: ActionWorkItem[]
    requests: RequestWorkItem[]
    verification: VerificationWorkItem[]
    reassignRequests: RequestWorkItem[]
    unassignedActions: ActionWorkItem[]
    repeat: Array<{ candidate: RepeatCandidate; latestDecision: CandidateDecision | null; needsRecheck: boolean; newEvidence: number }>
  }
  /** 3단계 저장소 준비 여부. */
  fieldRequestsReady: boolean
  combined: CombinedWorkItem[]
  todayActivity: { submittedReports: number; participants: number }
}

export interface WorkBoardInput {
  reports: BoardReport[]
  safetyReviews: SafetyReview[]
  actions: CareAction[]
  obligations: ActionObligation[]
  reportEvents: Pick<ReportEvent, 'report_id' | 'event_type'>[]
  workflowReady: boolean
  now: Date
  /** 3단계(없으면 빈 것으로 본다). */
  fieldRequestsReady?: boolean
  requests?: FieldRequest[]
  responses?: FieldResponse[]
  assigneesByRecipient?: Record<string, string[]>
  /** 5단계(없으면 판단 없음으로 본다). */
  candidateReviews?: CandidateReview[]
  candidateReviewsReady?: boolean
}

function brief(o: ActionObligation): ObligationBrief {
  return {
    obligationId: o.id,
    type: o.obligation_type,
    dueKind: o.current_due_kind,
    dueAt: o.current_due_at,
    initialDueKind: o.initial_due_kind,
    initialDueAt: o.initial_due_at,
  }
}

function cut(t: string | null | undefined, max = 80): string | null {
  const v = (t ?? '').trim()
  if (!v) return null
  return v.length > max ? `${v.slice(0, max)}…` : v
}

const byTimeAsc = (a: string | null, b: string | null) => (timeOf(a) ?? Infinity) - (timeOf(b) ?? Infinity)

export function buildWorkBoard(input: WorkBoardInput): WorkBoard {
  const asOf = input.now.toISOString()
  const today = kstDayRange(input.now)
  const live = input.reports.filter((r) => !r.deleted && (r.report_source ?? 'live') === 'live')

  // ── 안전 신호 ──
  const reviewsByReport = new Map<string, SafetyReview[]>()
  for (const r of input.safetyReviews) reviewsByReport.set(r.report_id, [...(reviewsByReport.get(r.report_id) ?? []), r])
  const reviewedByEvent = new Set(input.reportEvents.filter((e) => e.event_type !== 'submitted').map((e) => e.report_id))
  const safetyItem = (r: BoardReport): SafetySignalItem => {
    const latest = latestBy(reviewsByReport.get(r.id) ?? [], (x) => x.reviewed_at)
    return {
      reportId: r.id,
      recipientCode: r.recipient_code,
      participantCode: r.participant_code,
      reportStatus: r.status === 'submitted' ? 'submitted' : 'draft',
      reportReviewStatus: r.review_status ?? 'pending',
      at: r.status === 'submitted' ? (r.submitted_at ?? null) : (r.started_at ?? r.created_at ?? null),
      excerpt: cut(r.raw_input),
      latestReview: latest ? { outcome: latest.outcome, reviewedAt: latest.reviewed_at } : null,
    }
  }
  const flagged = live.filter((r) => r.emergency_flagged)
  const unreviewed = flagged.filter((r) => !(reviewsByReport.get(r.id)?.length))
  const safety: SafetySignalItem[] = []
  const safetyLegacy: SafetySignalItem[] = []
  const safetyDrafts: SafetySignalItem[] = []
  for (const r of unreviewed) {
    if (r.status !== 'submitted') {
      safetyDrafts.push(safetyItem(r))
    } else if (input.workflowReady && (r.review_status ?? 'pending') !== 'pending' && !reviewedByEvent.has(r.id)) {
      // 보고 승인/반려는 됐지만 그 시각이 이벤트로 남지 않은(= 이 기능 이전) 보고 — 검토 여부 불명확.
      safetyLegacy.push(safetyItem(r))
    } else {
      safety.push(safetyItem(r))
    }
  }
  for (const list of [safety, safetyLegacy, safetyDrafts]) list.sort((a, b) => byTimeAsc(a.at, b.at))

  // ── 새 보고 미확인 ──
  const reportQueue = buildReviewQueue(live)

  // ── 조치 의무 ──
  const openActions = input.actions.filter((a) => a.status === 'open')
  const obligationsByAction = new Map<string, ActionObligation[]>()
  for (const o of input.obligations) obligationsByAction.set(o.action_id, [...(obligationsByAction.get(o.action_id) ?? []), o])
  const overdue: ActionWorkItem[] = []
  const dueToday: ActionWorkItem[] = []
  for (const a of openActions) {
    const obs = obligationsByAction.get(a.id) ?? []
    const late = obs.filter((o) => isObligationOverdue(o, asOf))
    const todays = obs.filter((o) => o.obligation_type === 'admin_verification' && isObligationDueToday(o, today))
    const item = (): ActionWorkItem => ({
      actionId: a.id,
      recipientCode: a.recipient_code,
      kind: a.kind,
      status: a.status,
      purpose: a.purpose,
      ownerLabel: a.owner_label,
      sourceReportId: a.source_report_id,
      overdue: late.map(brief),
      dueToday: todays.map(brief),
    })
    if (late.length) overdue.push(item())
    if (todays.length) dueToday.push(item())
  }
  const earliest = (list: ObligationBrief[]) => list.reduce<string | null>((acc, o) => (byTimeAsc(o.dueAt, acc) < 0 ? o.dueAt : acc), null)
  overdue.sort((a, b) => byTimeAsc(earliest(a.overdue), earliest(b.overdue)))
  dueToday.sort((a, b) => byTimeAsc(earliest(a.dueToday), earliest(b.dueToday)))

  // ── 3단계: 게시 요청·응답 도착·재배정 ──
  const frReady = Boolean(input.fieldRequestsReady && input.workflowReady)
  const requests = frReady ? (input.requests ?? []) : []
  const responses = frReady ? (input.responses ?? []) : []
  const assignees = input.assigneesByRecipient ?? {}
  const actionsById = new Map(input.actions.map((a) => [a.id, a]))
  const allObligations = new Map(input.obligations.map((o) => [o.id, o]))
  const requestItem = (r: FieldRequest): RequestWorkItem => {
    const ob = allObligations.get(r.obligation_id) ?? null
    const wait = requestWaitState(r, ob, live, asOf)
    return {
      requestId: r.id,
      actionId: r.action_id,
      recipientCode: r.recipient_code,
      purpose: actionsById.get(r.action_id)?.purpose ?? '',
      message: r.message,
      targetMode: r.target_mode,
      targetCaregiverCode: r.target_caregiver_code,
      publishedAt: r.published_at,
      firstShownAt: r.first_shown_at,
      waitState: wait?.state ?? null,
      reportsSincePublish: wait?.reportsSincePublish ?? 0,
      routing: routingProblem(r, assignees[r.recipient_code] ?? []),
      responseDueKind: ob?.current_due_kind ?? 'unset',
      responseDueAt: ob?.current_due_at ?? null,
    }
  }
  const openAction = (id: string) => actionsById.get(id)?.status === 'open'
  const publishedItems = requests.filter((r) => r.status === 'published' && openAction(r.action_id)).map(requestItem).sort((a, b) => byTimeAsc(a.publishedAt, b.publishedAt))
  const reassignRequests = publishedItems.filter((r) => r.routing)
  const verificationItems: VerificationWorkItem[] = requests
    .filter((r) => r.status === 'answered' && openAction(r.action_id) && actionsById.get(r.action_id)?.current_cycle === r.cycle_no)
    .map((r) => {
      const own = responses.filter((x) => x.field_request_id === r.id).sort((a, b) => byTimeAsc(b.submitted_at, a.submitted_at))
      const a = actionsById.get(r.action_id)!
      return {
        actionId: a.id,
        recipientCode: a.recipient_code,
        purpose: a.purpose,
        requestId: r.id,
        answeredAt: r.answered_at,
        responseCount: own.length,
        latestResponseStatus: own[0]?.response_status ?? null,
        ownerLabel: a.owner_label,
      }
    })
    .sort((a, b) => byTimeAsc(a.answeredAt, b.answeredAt))
  const unassignedActions: ActionWorkItem[] = input.workflowReady
    ? input.actions
        .filter((a) => (a.status === 'open' || a.status === 'draft') && !a.owner_label)
        .map((a) => ({ actionId: a.id, recipientCode: a.recipient_code, kind: a.kind, status: a.status, purpose: a.purpose, ownerLabel: null, sourceReportId: a.source_report_id, overdue: [], dueToday: [] }))
    : []

  // ── 5단계: 반복 보고 후보(보고에서 매번 같은 규칙으로 계산, 판단은 따로) ──
  const repeat = computeRepeatCandidates(live, today.date)
  const reviews = input.candidateReviews ?? []
  const repeatItems = repeat.candidates.map((candidate) => {
    const st = reviewStateOf(candidate.key, candidate, reviews, live)
    return { candidate, latestDecision: st.latest?.decision ?? null, needsRecheck: st.recheckReasons.length > 0, newEvidence: st.newEvidenceSinceReview }
  })

  // ── 통합 목록(운영 규칙 순서, 같은 대상은 가장 앞 범주에 한 번만) ──
  const combined: CombinedWorkItem[] = []
  const seen = new Set<string>()
  const push = (item: CombinedWorkItem) => {
    if (seen.has(item.key)) return
    seen.add(item.key)
    combined.push(item)
  }
  const reportsById = new Map(live.map((r) => [r.id, r]))
  for (const s of safety) {
    const r = reportsById.get(s.reportId)
    push({
      key: `report:${s.reportId}`,
      category: 'safety',
      recipientCode: s.recipientCode,
      reportId: s.reportId,
      actionId: null,
      headline: s.excerpt ?? '(원문 없음)',
      notes: [
        input.workflowReady ? '안전 검토 기록 없음' : '검토 여부 미확인(안전 검토 저장 준비 전)',
        r && (r.review_status ?? 'pending') === 'pending' ? '보고 검토도 대기' : `보고 검토: ${r?.review_status === 'approved' ? '승인됨' : '반려됨'}(안전 검토와 별개)`,
      ],
      waitingSince: s.at,
    })
  }
  for (const a of overdue) {
    push({
      key: `action:${a.actionId}`,
      category: 'overdue',
      recipientCode: a.recipientCode,
      reportId: a.sourceReportId,
      actionId: a.actionId,
      headline: a.purpose,
      notes: [...a.overdue.map((o) => `${o.type === 'admin_verification' ? '재확인' : o.type === 'admin_execution' ? '직접 수행' : '현장 응답'}기한 지남`), a.ownerLabel ? `담당 ${a.ownerLabel}` : '담당 미지정'],
      waitingSince: earliest(a.overdue),
    })
  }
  for (const a of dueToday) {
    push({
      key: `action:${a.actionId}`,
      category: 'verification_today',
      recipientCode: a.recipientCode,
      reportId: a.sourceReportId,
      actionId: a.actionId,
      headline: a.purpose,
      notes: ['오늘 관리자 재확인기한', a.ownerLabel ? `담당 ${a.ownerLabel}` : '담당 미지정'],
      waitingSince: earliest(a.dueToday),
    })
  }
  for (const v of verificationItems) {
    push({
      key: `action:${v.actionId}`,
      category: 'verification_pending',
      recipientCode: v.recipientCode,
      reportId: actionsById.get(v.actionId)?.source_report_id ?? null,
      actionId: v.actionId,
      headline: v.purpose,
      notes: ['현장 응답 도착 — 관리자 결과 확인 필요(응답만으로 완료 아님)', v.ownerLabel ? `담당 ${v.ownerLabel}` : '담당 미지정'],
      waitingSince: v.answeredAt,
    })
  }
  for (const r of reassignRequests) {
    push({
      key: `action:${r.actionId}`,
      category: 'reassign',
      recipientCode: r.recipientCode,
      reportId: actionsById.get(r.actionId)?.source_report_id ?? null,
      actionId: r.actionId,
      headline: r.purpose || r.message,
      notes: [r.routing === 'no_assignee' ? '배정된 요양보호사 없음' : `지정 대상 ${r.targetCaregiverCode} 배정 해제됨`, '게시 요청이 현장에 보이지 않음'],
      waitingSince: r.publishedAt,
    })
  }
  const attention = reportQueue.filter((q) => q.reasons.some((x) => x.tone === 'alert'))
  const general = reportQueue.filter((q) => !q.reasons.some((x) => x.tone === 'alert'))
  const pushReport = (q: ReviewQueueItem, category: WorkCategory) =>
    push({
      key: `report:${q.reportId}`,
      category,
      recipientCode: q.recipientCode,
      reportId: q.reportId,
      actionId: null,
      headline: q.excerpt ?? '(내용 없음)',
      notes: q.reasons.filter((x) => x.code !== 'not_reviewed').map((x) => x.label),
      waitingSince: q.submittedAt,
    })
  for (const q of [...attention].sort((a, b) => byTimeAsc(a.submittedAt, b.submittedAt))) pushReport(q, 'report_attention')
  for (const q of [...general].sort((a, b) => byTimeAsc(a.submittedAt, b.submittedAt))) pushReport(q, 'report_general')

  // ── 오늘 활동(참고) ──
  const startMs = timeOf(today.start) ?? 0
  const endMs = timeOf(today.end) ?? 0
  const submittedToday = live.filter((r) => {
    const t = timeOf(r.submitted_at)
    return r.status === 'submitted' && t !== null && t >= startMs && t < endMs
  })

  return {
    asOf,
    today,
    workflowReady: input.workflowReady,
    cards: {
      safety: {
        ready: input.workflowReady,
        signals: safety.length,
        recipients: new Set(safety.map((s) => s.recipientCode)).size,
        draftSignals: safetyDrafts.length,
        legacyUnclear: safetyLegacy.length,
      },
      reports: { reports: reportQueue.length, recipients: new Set(reportQueue.map((q) => q.recipientCode)).size },
      overdue: { ready: input.workflowReady, actions: overdue.length, obligations: overdue.reduce((n, a) => n + a.overdue.length, 0) },
      today: { ready: input.workflowReady, actions: dueToday.length, obligations: dueToday.reduce((n, a) => n + a.dueToday.length, 0) },
      requests: {
        ready: frReady,
        requests: publishedItems.length,
        overdue: publishedItems.filter((r) => r.waitState === 'overdue').length,
        reportsWithoutAnswer: publishedItems.filter((r) => r.waitState === 'reports_without_answer').length,
        awaitingVisit: publishedItems.filter((r) => r.waitState === 'awaiting_visit').length,
      },
      verification: { ready: frReady, actions: verificationItems.length },
      reassign: { ready: input.workflowReady, requests: reassignRequests.length, unassignedActions: unassignedActions.length },
      repeat: {
        candidates: repeatItems.length,
        recipients: new Set(repeatItems.map((x) => x.candidate.recipientCode)).size,
        unreviewed: repeatItems.filter((x) => !x.latestDecision).length,
        signals: repeat.signalsInWindow,
        changedRecipients: repeat.changedRecipients,
        reviewsReady: Boolean(input.candidateReviewsReady),
      },
    },
    lists: {
      safety,
      safetyDrafts,
      safetyLegacy,
      reports: reportQueue,
      overdue,
      today: dueToday,
      requests: publishedItems,
      verification: verificationItems,
      reassignRequests,
      unassignedActions,
      repeat: repeatItems,
    },
    fieldRequestsReady: frReady,
    combined,
    todayActivity: { submittedReports: submittedToday.length, participants: new Set(submittedToday.map((r) => r.participant_code)).size },
  }
}
