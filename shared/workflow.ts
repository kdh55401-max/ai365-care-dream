/** 관리자 업무(2단계): 판단 · 조치 · 의무 기한 · 안전 신호 검토 · 보고 이벤트.
 *
 * 규칙은 이 파일 한 곳에 둔다. 서버(api/admin/workflow)는 여기서 계산한 변경분을 DB 함수로
 * 한 트랜잭션에 적용하고(원자성·버전 충돌·중복 요청은 DB가 최종 확인), 데모 모드는 같은
 * 계산을 localStorage에 적용한다 — 두 경로의 업무 규칙이 갈라지지 않게 하기 위함.
 *
 * 구분 원칙(v3 공통 규칙 8):
 * - 보고 검토(승인/반려, reports.review_status) · 관리자 판단(AdminDecision) · 안전 신호 검토
 *   (SafetyReview) · 조치(CareAction) · 의무(ActionObligation)는 서로 다른 기록이다.
 * - 기존 manager_status / actual_followup_type(연구용 평가)은 여기로 옮기거나 해석하지 않는다.
 * - 공유 관리자 계정이라 실제 행위자는 "기관 공유 관리자 계정" 범위로만 기록한다. 화면에서 고른
 *   업무 담당(owner_label)·입력한 확인자(entered_by_label)는 입력값이지 로그인 신원이 아니다.
 * - 현장 요청 내용은 이번 단계에서 미게시 초안이다(게시·응답은 3단계). */

export const ADMIN_ACTOR_SCOPE = 'org_admin_shared' as const
export const ADMIN_ACTOR_SCOPE_LABEL = '기관 공유 관리자 계정(개인 식별 불가)'

// ── 관리자 판단 ─────────────────────────────────────────────────────
export const DECISION_KINDS = ['no_action_needed', 'observe_more', 'action_needed', 'on_hold'] as const
export type DecisionKind = (typeof DECISION_KINDS)[number]
export const DECISION_LABELS: Record<DecisionKind, string> = {
  no_action_needed: '검토 완료 · 추가 조치 불필요',
  observe_more: '추가 관찰 필요',
  action_needed: '조치 필요',
  on_hold: '판단 보류',
}

export interface AdminDecision {
  id: string
  organization_id: string
  report_id: string
  decision: DecisionKind
  reason: string | null
  decided_at: string
  actor_scope: string
  entered_by_label: string | null
  request_id: string
  previous_decision_id: string | null
}

// ── 안전 신호 검토 ───────────────────────────────────────────────────
export const SAFETY_OUTCOMES = ['action_linked', 'no_further_action', 'signal_not_applicable'] as const
export type SafetyOutcome = (typeof SAFETY_OUTCOMES)[number]
export const SAFETY_OUTCOME_LABELS: Record<SafetyOutcome, string> = {
  action_linked: '확인함 · 조치로 연결',
  no_further_action: '확인함 · 추가 조치 불필요',
  signal_not_applicable: '감지된 표현이 실제 위급 상황이 아님',
}

export interface SafetyReview {
  id: string
  organization_id: string
  report_id: string
  signal_source: 'emergency_flagged'
  /** 검토 당시 보고 상태·버전 — 이후 보고가 바뀌어도 무엇을 보고 판단했는지 남긴다. */
  report_status_at_review: 'draft' | 'submitted'
  report_updated_at_at_review: string
  outcome: SafetyOutcome
  reason: string
  related_action_id: string | null
  reviewed_at: string
  actor_scope: string
  entered_by_label: string | null
  request_id: string
  previous_review_id: string | null
}

// ── 조치와 의무 ─────────────────────────────────────────────────────
export const ACTION_KINDS = ['field_request', 'admin_direct'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]
export const ACTION_KIND_LABELS: Record<ActionKind, string> = {
  field_request: '현장 확인 요청(현장 답변 필요)',
  admin_direct: '관리자 직접 조치(수행 사실을 관리자가 기록)',
}

export type ActionStatus = 'draft' | 'open' | 'completed' | 'cancelled'
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  draft: '초안(활성화 전)',
  open: '진행 중',
  completed: '완료',
  cancelled: '취소',
}

export type ObligationType = 'field_response' | 'admin_verification' | 'admin_execution'
export const OBLIGATION_TYPE_LABELS: Record<ObligationType, string> = {
  field_response: '현장 응답기한',
  admin_verification: '관리자 결과 재확인기한',
  admin_execution: '관리자 직접 수행기한',
}

export type DueKind = 'datetime' | 'next_actual_visit' | 'unset'
export const DUE_KIND_LABELS: Record<DueKind, string> = {
  datetime: '특정 일시',
  next_actual_visit: '다음 실제 방문(날짜 없음)',
  unset: '미정',
}

export type ObligationStatus = 'inactive' | 'pending_publish' | 'active' | 'fulfilled' | 'cancelled'
export const OBLIGATION_STATUS_LABELS: Record<ObligationStatus, string> = {
  inactive: '초안(미활성)',
  pending_publish: '미게시 — 현장에 아직 전달되지 않음',
  active: '진행 중',
  fulfilled: '이행됨',
  cancelled: '취소됨',
}

export interface CareAction {
  id: string
  organization_id: string
  recipient_code: string
  source_report_id: string | null
  decision_id: string | null
  kind: ActionKind
  purpose: string
  action_content: string | null
  /** 현장에 전달할 요청 초안. 이번 단계에서는 게시하지 않는다. */
  field_message_draft: string | null
  field_message_status: 'unpublished' | 'not_applicable'
  /** 관리자 내부 메모 — 현장 API 응답에 절대 넣지 않는다. */
  internal_note: string | null
  /** 업무 담당(입력값). null이면 담당 미지정. */
  owner_label: string | null
  status: ActionStatus
  version: number
  current_cycle: number
  completion_evidence: string | null
  completion_remaining: string | null
  completed_at: string | null
  cancel_reason: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  created_by_scope: string
  create_request_id: string
}

export interface ActionObligation {
  id: string
  action_id: string
  cycle_no: number
  obligation_type: ObligationType
  /** 최초 기한 — 만든 뒤 바뀌지 않는다(DB 트리거로도 막는다). */
  initial_due_kind: DueKind
  initial_due_at: string | null
  current_due_kind: DueKind
  current_due_at: string | null
  status: ObligationStatus
  activated_at: string | null
  fulfilled_at: string | null
  cancelled_at: string | null
  created_at: string
}

export type ActionEventType = 'created' | 'activated' | 'updated' | 'due_changed' | 'completed' | 'cancelled' | 'reopened'

export interface ActionEvent {
  id: string
  action_id: string
  obligation_id: string | null
  event_type: ActionEventType
  reason: string | null
  detail: Record<string, unknown>
  actor_scope: string
  entered_by_label: string | null
  owner_label_at_event: string | null
  request_id: string
  occurred_at: string
}

/** 보고 생애 이벤트 — DB 트리거가 제출·승인·반려 순간에 한 번씩 남긴다(수정·삭제 불가).
 * 이 기능 이전의 보고에는 이벤트가 없다 — 과거 시각을 만들어 채우지 않는다. */
export interface ReportEvent {
  id: string
  report_id: string
  event_type: 'submitted' | 'review_approved' | 'review_rejected'
  occurred_at: string
  actor_scope: string
  actor_ref: string | null
  request_id: string | null
  recorded_at: string
}

// ── 오류 ─────────────────────────────────────────────────────────────
export class WorkflowError extends Error {
  status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

function requireText(v: unknown, message: string): string {
  const t = text(v)
  if (!t) throw new WorkflowError(400, message)
  return t
}

// ── 기한 입력 ───────────────────────────────────────────────────────
export interface DueInput {
  kind: DueKind
  /** kind='datetime'일 때만. ISO 문자열. */
  at?: string | null
}

export function normalizeDue(input: DueInput | null | undefined, allowNextVisit: boolean, label: string): { kind: DueKind; at: string | null } {
  if (!input || input.kind === 'unset') return { kind: 'unset', at: null }
  if (input.kind === 'next_actual_visit') {
    if (!allowNextVisit) throw new WorkflowError(400, `${label}에는 '다음 실제 방문'을 쓸 수 없습니다.`)
    // 다음 방문 일정 자료가 없으므로 날짜로 바꾸지 않는다.
    return { kind: 'next_actual_visit', at: null }
  }
  if (input.kind === 'datetime') {
    const d = input.at ? new Date(input.at) : null
    if (!d || Number.isNaN(d.getTime())) throw new WorkflowError(400, `${label}의 날짜·시각을 확인해 주세요.`)
    return { kind: 'datetime', at: d.toISOString() }
  }
  throw new WorkflowError(400, `${label}의 종류가 올바르지 않습니다.`)
}

// ── 계산 맥락 ───────────────────────────────────────────────────────
export interface WorkflowContext {
  now: string
  organizationId: string
  newId: () => string
}

// ── 판단 ─────────────────────────────────────────────────────────────
export interface DecisionInput {
  reportId: string
  decision: DecisionKind
  reason?: string | null
  enteredByLabel?: string | null
  /** 화면이 마지막으로 본 최신 판단 id(없으면 null). 다르면 409 — 동시 수정 충돌. */
  expectedLatestDecisionId: string | null
  requestId: string
}

export function planDecision(
  report: { id: string; status: string },
  latest: AdminDecision | null,
  input: DecisionInput,
  ctx: WorkflowContext,
): AdminDecision {
  if (!(DECISION_KINDS as readonly string[]).includes(input.decision)) throw new WorkflowError(400, '판단 종류를 선택해 주세요.')
  if (report.status !== 'submitted') throw new WorkflowError(409, '제출된 보고에만 관리자 판단을 남길 수 있습니다.')
  if ((latest?.id ?? null) !== (input.expectedLatestDecisionId ?? null)) {
    throw new WorkflowError(409, '다른 곳에서 이 보고의 판단이 먼저 저장됐습니다. 최신 내용을 확인해 주세요.')
  }
  return {
    id: ctx.newId(),
    organization_id: ctx.organizationId,
    report_id: report.id,
    decision: input.decision,
    reason: text(input.reason),
    decided_at: ctx.now,
    actor_scope: ADMIN_ACTOR_SCOPE,
    entered_by_label: text(input.enteredByLabel),
    request_id: requireText(input.requestId, '요청 식별자가 없습니다.'),
    previous_decision_id: latest?.id ?? null,
  }
}

// ── 안전 검토 ───────────────────────────────────────────────────────
export interface SafetyReviewInput {
  reportId: string
  outcome: SafetyOutcome
  reason: string
  relatedActionId?: string | null
  enteredByLabel?: string | null
  expectedLatestReviewId: string | null
  requestId: string
}

export function planSafetyReview(
  report: { id: string; status: string; emergency_flagged: boolean; updated_at: string; recipient_code: string },
  latest: SafetyReview | null,
  relatedAction: Pick<CareAction, 'id' | 'recipient_code' | 'status'> | null,
  input: SafetyReviewInput,
  ctx: WorkflowContext,
): SafetyReview {
  if (!report.emergency_flagged) throw new WorkflowError(409, '안전 신호가 기록되지 않은 보고입니다.')
  if (!(SAFETY_OUTCOMES as readonly string[]).includes(input.outcome)) throw new WorkflowError(400, '검토 결과를 선택해 주세요.')
  const reason = requireText(input.reason, '안전 검토 이유를 입력해 주세요.')
  if ((latest?.id ?? null) !== (input.expectedLatestReviewId ?? null)) {
    throw new WorkflowError(409, '다른 곳에서 이 신호의 검토가 먼저 저장됐습니다. 최신 내용을 확인해 주세요.')
  }
  if (input.outcome === 'action_linked') {
    if (!input.relatedActionId || !relatedAction) throw new WorkflowError(400, '연결할 조치를 선택해 주세요.')
    if (relatedAction.recipient_code !== report.recipient_code) throw new WorkflowError(400, '같은 수급자의 조치만 연결할 수 있습니다.')
  }
  return {
    id: ctx.newId(),
    organization_id: ctx.organizationId,
    report_id: report.id,
    signal_source: 'emergency_flagged',
    report_status_at_review: report.status === 'submitted' ? 'submitted' : 'draft',
    report_updated_at_at_review: report.updated_at,
    outcome: input.outcome,
    reason,
    related_action_id: input.outcome === 'action_linked' ? (input.relatedActionId ?? null) : text(input.relatedActionId),
    reviewed_at: ctx.now,
    actor_scope: ADMIN_ACTOR_SCOPE,
    entered_by_label: text(input.enteredByLabel),
    request_id: requireText(input.requestId, '요청 식별자가 없습니다.'),
    previous_review_id: latest?.id ?? null,
  }
}

// ── 조치 생성 ───────────────────────────────────────────────────────
export interface CreateActionInput {
  recipientCode: string
  sourceReportId?: string | null
  decisionId?: string | null
  kind: ActionKind
  purpose: string
  actionContent?: string | null
  fieldMessageDraft?: string | null
  internalNote?: string | null
  ownerLabel?: string | null
  /** false면 초안으로만 저장(기한이 돌지 않는다), true면 바로 진행 중. */
  activate: boolean
  responseDue?: DueInput | null
  verificationDue?: DueInput | null
  executionDue?: DueInput | null
  enteredByLabel?: string | null
  requestId: string
}

export interface ActionState {
  action: CareAction
  obligations: ActionObligation[]
}

export interface ActionPlan extends ActionState {
  /** 이번 요청으로 새로 생기는 의무(생성·재개). */
  obligationInserts: ActionObligation[]
  /** 이번 요청으로 바뀌는 기존 의무(전체 행). */
  obligationUpdates: ActionObligation[]
  /** 이번 요청의 이력 한 줄(요청 하나 = 이벤트 하나, request_id로 중복 방지). */
  event: ActionEvent
}

function obligationStatusFor(type: ObligationType, actionStatus: ActionStatus): ObligationStatus {
  if (actionStatus === 'draft') return 'inactive'
  // 현장 응답 의무는 요청을 게시해야 시작된다 — 이번 단계는 게시 기능이 없다.
  if (type === 'field_response') return 'pending_publish'
  return 'active'
}

function newObligation(
  ctx: WorkflowContext,
  actionId: string,
  cycle: number,
  type: ObligationType,
  due: { kind: DueKind; at: string | null },
  actionStatus: ActionStatus,
): ActionObligation {
  const status = obligationStatusFor(type, actionStatus)
  return {
    id: ctx.newId(),
    action_id: actionId,
    cycle_no: cycle,
    obligation_type: type,
    initial_due_kind: due.kind,
    initial_due_at: due.at,
    current_due_kind: due.kind,
    current_due_at: due.at,
    status,
    activated_at: status === 'active' ? ctx.now : null,
    fulfilled_at: null,
    cancelled_at: null,
    created_at: ctx.now,
  }
}

function actionSnapshot(a: CareAction) {
  return {
    status: a.status,
    kind: a.kind,
    purpose: a.purpose,
    action_content: a.action_content,
    field_message_draft: a.field_message_draft,
    owner_label: a.owner_label,
    // 내부 메모는 이력에도 내용 대신 "있음/없음"만 남긴다(내용은 조치 행에만).
    internal_note_present: Boolean(a.internal_note),
  }
}

export function planCreateAction(input: CreateActionInput, ctx: WorkflowContext): ActionPlan {
  if (!(ACTION_KINDS as readonly string[]).includes(input.kind)) throw new WorkflowError(400, '조치 종류를 선택해 주세요.')
  const recipientCode = requireText(input.recipientCode, '수급자를 확인해 주세요.')
  const purpose = requireText(input.purpose, '확인하거나 해결하려는 사항을 입력해 주세요.')
  const fieldMessage = input.kind === 'field_request' ? text(input.fieldMessageDraft) : null
  if (input.kind === 'field_request' && input.activate && !fieldMessage) {
    throw new WorkflowError(400, '현장에 전달할 요청 내용을 입력해야 진행 중으로 저장할 수 있습니다(초안 저장은 가능).')
  }
  if (input.kind === 'admin_direct' && input.responseDue && input.responseDue.kind !== 'unset') {
    throw new WorkflowError(400, '관리자 직접 조치에는 현장 응답기한이 없습니다.')
  }
  if (input.kind === 'field_request' && input.executionDue && input.executionDue.kind !== 'unset') {
    throw new WorkflowError(400, '현장 확인 요청에는 관리자 직접 수행기한을 쓰지 않습니다.')
  }
  const status: ActionStatus = input.activate ? 'open' : 'draft'
  const id = ctx.newId()
  const action: CareAction = {
    id,
    organization_id: ctx.organizationId,
    recipient_code: recipientCode,
    source_report_id: text(input.sourceReportId),
    decision_id: text(input.decisionId),
    kind: input.kind,
    purpose,
    action_content: text(input.actionContent),
    field_message_draft: fieldMessage,
    field_message_status: input.kind === 'field_request' ? 'unpublished' : 'not_applicable',
    internal_note: text(input.internalNote),
    owner_label: text(input.ownerLabel),
    status,
    version: 1,
    current_cycle: 1,
    completion_evidence: null,
    completion_remaining: null,
    completed_at: null,
    cancel_reason: null,
    cancelled_at: null,
    created_at: ctx.now,
    updated_at: ctx.now,
    created_by_scope: ADMIN_ACTOR_SCOPE,
    create_request_id: requireText(input.requestId, '요청 식별자가 없습니다.'),
  }
  const obligations: ActionObligation[] = []
  if (input.kind === 'field_request') {
    obligations.push(newObligation(ctx, id, 1, 'field_response', normalizeDue(input.responseDue, true, OBLIGATION_TYPE_LABELS.field_response), status))
  } else {
    obligations.push(newObligation(ctx, id, 1, 'admin_execution', normalizeDue(input.executionDue, false, OBLIGATION_TYPE_LABELS.admin_execution), status))
  }
  obligations.push(newObligation(ctx, id, 1, 'admin_verification', normalizeDue(input.verificationDue, false, OBLIGATION_TYPE_LABELS.admin_verification), status))
  return {
    action,
    obligations,
    obligationInserts: obligations,
    obligationUpdates: [],
    event: {
      id: ctx.newId(),
      action_id: id,
      obligation_id: null,
      event_type: 'created',
      reason: null,
      detail: { ...actionSnapshot(action), obligations: obligations.map((o) => ({ id: o.id, type: o.obligation_type, due_kind: o.initial_due_kind, due_at: o.initial_due_at })) },
      actor_scope: ADMIN_ACTOR_SCOPE,
      entered_by_label: text(input.enteredByLabel),
      owner_label_at_event: action.owner_label,
      request_id: action.create_request_id,
      occurred_at: ctx.now,
    },
  }
}

// ── 조치 변경 ───────────────────────────────────────────────────────
export type ActionMutation =
  | { op: 'update'; purpose?: string; actionContent?: string | null; fieldMessageDraft?: string | null; internalNote?: string | null; ownerLabel?: string | null; reason?: string | null }
  | { op: 'change_due'; obligationId: string; due: DueInput; reason: string }
  | { op: 'activate' }
  | { op: 'complete'; evidence: string; remaining?: string | null }
  | { op: 'cancel'; reason: string }
  | { op: 'reopen'; reason: string; verificationDue?: DueInput | null; executionDue?: DueInput | null }

export type ActionMutationInput = ActionMutation & { actionId: string; expectedVersion: number; requestId: string; enteredByLabel?: string | null }

export function planActionMutation(state: ActionState, input: ActionMutationInput, ctx: WorkflowContext): ActionPlan {
  const current = state.action
  if (current.version !== input.expectedVersion) {
    throw new WorkflowError(409, '다른 곳에서 이 조치가 먼저 수정됐습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.')
  }
  const requestId = requireText(input.requestId, '요청 식별자가 없습니다.')
  const next: CareAction = { ...current, version: current.version + 1, updated_at: ctx.now }
  const updates: ActionObligation[] = []
  const inserts: ActionObligation[] = []
  let eventType: ActionEventType
  let reason: string | null = null
  let obligationId: string | null = null
  let detail: Record<string, unknown> = {}
  const editable = current.status === 'draft' || current.status === 'open'

  switch (input.op) {
    case 'update': {
      if (!editable) throw new WorkflowError(409, '완료·취소된 조치는 내용을 고칠 수 없습니다(재개 후 수정).')
      const before = actionSnapshot(current)
      if (input.purpose !== undefined) next.purpose = requireText(input.purpose, '확인하거나 해결하려는 사항을 입력해 주세요.')
      if (input.actionContent !== undefined) next.action_content = text(input.actionContent)
      if (input.fieldMessageDraft !== undefined && current.kind === 'field_request') next.field_message_draft = text(input.fieldMessageDraft)
      if (input.internalNote !== undefined) next.internal_note = text(input.internalNote)
      if (input.ownerLabel !== undefined) next.owner_label = text(input.ownerLabel)
      if (current.kind === 'field_request' && current.status === 'open' && !next.field_message_draft) {
        throw new WorkflowError(400, '진행 중인 현장 확인 요청의 요청 내용은 비울 수 없습니다.')
      }
      eventType = 'updated'
      reason = text(input.reason)
      detail = { before, after: actionSnapshot(next) }
      break
    }
    case 'change_due': {
      if (!editable) throw new WorkflowError(409, '완료·취소된 조치의 기한은 바꿀 수 없습니다.')
      const ob = state.obligations.find((o) => o.id === input.obligationId)
      if (!ob) throw new WorkflowError(404, '기한을 찾을 수 없습니다.')
      if (ob.cycle_no !== current.current_cycle || ob.status === 'fulfilled' || ob.status === 'cancelled') {
        throw new WorkflowError(409, '이미 끝난 기한은 바꿀 수 없습니다. 새 확인이 필요하면 조치를 재개해 주세요.')
      }
      reason = requireText(input.reason, '기한을 바꾸는 이유를 입력해 주세요.')
      const due = normalizeDue(input.due, ob.obligation_type === 'field_response', OBLIGATION_TYPE_LABELS[ob.obligation_type])
      if (due.kind === ob.current_due_kind && timeOf(due.at) === timeOf(ob.current_due_at)) throw new WorkflowError(400, '바뀐 기한이 없습니다.')
      // 최초 기한(initial_*)은 그대로 두고 현재 기한만 바꾼다 — 과거 지연 기록을 지우지 않는다.
      updates.push({ ...ob, current_due_kind: due.kind, current_due_at: due.at })
      eventType = 'due_changed'
      obligationId = ob.id
      detail = {
        obligation_type: ob.obligation_type,
        from: { kind: ob.current_due_kind, at: ob.current_due_at },
        to: due,
        initial: { kind: ob.initial_due_kind, at: ob.initial_due_at },
        was_overdue: isObligationOverdue(ob, ctx.now),
      }
      break
    }
    case 'activate': {
      if (current.status !== 'draft') throw new WorkflowError(409, '초안인 조치만 진행 중으로 바꿀 수 있습니다.')
      if (current.kind === 'field_request' && !current.field_message_draft) {
        throw new WorkflowError(400, '현장에 전달할 요청 내용을 먼저 입력해 주세요.')
      }
      next.status = 'open'
      for (const ob of state.obligations.filter((o) => o.status === 'inactive')) {
        const status = obligationStatusFor(ob.obligation_type, 'open')
        updates.push({ ...ob, status, activated_at: status === 'active' ? ctx.now : null })
      }
      eventType = 'activated'
      break
    }
    case 'complete': {
      if (current.status !== 'open') throw new WorkflowError(409, '진행 중인 조치만 완료할 수 있습니다.')
      if (current.kind === 'field_request') {
        // 현장 답변이 필요한 조치는 답변(3단계)을 확인하기 전에 완료하지 않는다.
        throw new WorkflowError(409, '현장 확인 요청은 현장 답변을 받아 확인하기 전에는 완료할 수 없습니다(필요하면 취소).')
      }
      const evidence = requireText(input.evidence, '실제로 한 일과 결과 근거를 입력해 주세요.')
      next.status = 'completed'
      next.completion_evidence = evidence
      next.completion_remaining = text(input.remaining)
      next.completed_at = ctx.now
      for (const ob of state.obligations.filter((o) => o.cycle_no === current.current_cycle && o.status === 'active')) {
        updates.push({ ...ob, status: 'fulfilled', fulfilled_at: ctx.now })
      }
      eventType = 'completed'
      detail = { evidence, remaining: next.completion_remaining }
      break
    }
    case 'cancel': {
      if (!editable) throw new WorkflowError(409, '초안·진행 중인 조치만 취소할 수 있습니다.')
      reason = requireText(input.reason, '취소 이유를 입력해 주세요.')
      next.status = 'cancelled'
      next.cancel_reason = reason
      next.cancelled_at = ctx.now
      for (const ob of state.obligations.filter((o) => o.status !== 'fulfilled' && o.status !== 'cancelled')) {
        updates.push({ ...ob, status: 'cancelled', cancelled_at: ctx.now })
      }
      eventType = 'cancelled'
      detail = {
        overdue_at_cancel: state.obligations
          .filter((o) => isObligationOverdue(o, ctx.now))
          .map((o) => o.id),
      }
      break
    }
    case 'reopen': {
      if (current.status !== 'completed') throw new WorkflowError(409, '완료된 조치만 재개할 수 있습니다.')
      reason = requireText(input.reason, '재개하는 이유를 입력해 주세요.')
      // 기존 완료·기한 기록은 그대로 두고 새 후속 주기를 만든다.
      const cycle = current.current_cycle + 1
      next.status = 'open'
      next.current_cycle = cycle
      if (current.kind === 'admin_direct') {
        inserts.push(newObligation(ctx, current.id, cycle, 'admin_execution', normalizeDue(input.executionDue, false, OBLIGATION_TYPE_LABELS.admin_execution), 'open'))
      }
      inserts.push(newObligation(ctx, current.id, cycle, 'admin_verification', normalizeDue(input.verificationDue, false, OBLIGATION_TYPE_LABELS.admin_verification), 'open'))
      eventType = 'reopened'
      detail = {
        previous_completed_at: current.completed_at,
        previous_evidence: current.completion_evidence,
        new_cycle: cycle,
        new_obligations: inserts.map((o) => ({ id: o.id, type: o.obligation_type, due_kind: o.initial_due_kind, due_at: o.initial_due_at })),
      }
      break
    }
    default:
      throw new WorkflowError(400, '알 수 없는 조치 변경입니다.')
  }

  const merged = state.obligations.map((o) => updates.find((u) => u.id === o.id) ?? o).concat(inserts)
  return {
    action: next,
    obligations: merged,
    obligationInserts: inserts,
    obligationUpdates: updates,
    event: {
      id: ctx.newId(),
      action_id: current.id,
      obligation_id: obligationId,
      event_type: eventType,
      reason,
      detail,
      actor_scope: ADMIN_ACTOR_SCOPE,
      entered_by_label: text(input.enteredByLabel),
      owner_label_at_event: next.owner_label,
      request_id: requestId,
      occurred_at: ctx.now,
    },
  }
}

// ── 한국 시간 날짜 경계 ────────────────────────────────────────────
const KST_MS = 9 * 60 * 60 * 1000

/** 한국 시간 기준 오늘 [시작, 다음날 시작) — 시작 포함·끝 미포함. */
export function kstDayRange(now: Date): { date: string; start: string; end: string } {
  const kst = new Date(now.getTime() + KST_MS)
  const date = kst.toISOString().slice(0, 10)
  const start = new Date(new Date(`${date}T00:00:00Z`).getTime() - KST_MS)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { date, start: start.toISOString(), end: end.toISOString() }
}

/** 화면의 datetime-local 값(한국 시간으로 입력)을 ISO로. 형식이 틀리면 null. */
export function kstLocalToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null
  const d = new Date(`${v}:00+09:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function isoToKstLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 16)
}

// ── 의무 판정 ───────────────────────────────────────────────────────
/** 시각 비교는 항상 숫자로 한다 — DB(+00:00)와 브라우저(Z)의 ISO 표기가 달라 문자열 비교가 틀린다. */
export function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

export function isObligationOverdue(o: ActionObligation, nowIso: string): boolean {
  const due = timeOf(o.current_due_at)
  const now = timeOf(nowIso)
  return o.status === 'active' && o.current_due_kind === 'datetime' && due !== null && now !== null && due < now
}

export function isObligationDueToday(o: ActionObligation, day: { start: string; end: string }): boolean {
  const due = timeOf(o.current_due_at)
  return o.status === 'active' && o.current_due_kind === 'datetime' && due !== null && due >= (timeOf(day.start) ?? 0) && due < (timeOf(day.end) ?? 0)
}

/** 가장 늦은 시각의 행(동률이면 먼저 나온 행). */
export function latestBy<T>(rows: T[], key: (r: T) => string): T | null {
  return rows.reduce<T | null>((acc, r) => (!acc || (timeOf(key(r)) ?? 0) > (timeOf(key(acc)) ?? 0) ? r : acc), null)
}
