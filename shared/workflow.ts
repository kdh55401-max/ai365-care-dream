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
 * - 현장 요청은 관리자가 명시적으로 게시해야 현장에 보인다(3단계). 게시 문구는 고정되고,
 *   응답 도착·관리자 결과 확인·종결은 서로 다른 상태다. */

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
  /** 현장에 전달할 요청 초안. 게시하면 그 시점의 문구가 field_requests.message로 고정된다. */
  field_message_draft: string | null
  /** 현재 주기의 게시 상태(3단계). 'published'는 현재 주기에 게시된 요청이 있다는 뜻. */
  field_message_status: 'unpublished' | 'published' | 'not_applicable'
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
  /** 결과 확인으로 종결할 때의 결과(3단계). 건강 개선 지표가 아니라 사실 구분이다. */
  closure_outcome?: VerificationOutcome | null
  created_at: string
  updated_at: string
  created_by_scope: string
  create_request_id: string
}

// ── 현장 요청 · 응답 · 결과 확인(3단계) ─────────────────────────────
export type RequestTargetMode = 'recipient_assignees' | 'specific_caregiver'
export const REQUEST_TARGET_LABELS: Record<RequestTargetMode, string> = {
  recipient_assignees: '이 수급자의 현재 담당 요양보호사(다음 방문자)',
  specific_caregiver: '지정한 요양보호사',
}

export type FieldRequestStatus = 'published' | 'answered' | 'withdrawn' | 'closed'
export const FIELD_REQUEST_STATUS_LABELS: Record<FieldRequestStatus, string> = {
  published: '게시됨 · 응답 대기',
  answered: '응답 도착',
  withdrawn: '철회됨',
  closed: '결과 확인으로 게시 종료',
}

/** 관리자가 명시적으로 게시한 현장 요청(인계). 문구는 게시 시점 값으로 고정된다. */
export interface FieldRequest {
  id: string
  organization_id: string
  action_id: string
  obligation_id: string
  cycle_no: number
  recipient_code: string
  message: string
  target_mode: RequestTargetMode
  target_caregiver_code: string | null
  status: FieldRequestStatus
  published_at: string
  /** 요양보호사 화면에 처음 표시된 시각 — 게시만으로 추정하지 않는다(표시 기록이 없으면 null). */
  first_shown_at: string | null
  first_shown_to: string | null
  answered_at: string | null
  ended_at: string | null
  end_reason: string | null
  version: number
  publish_request_id: string
}

export const RESPONSE_STATUSES = ['observed', 'performed', 'not_observed', 'refused', 'other'] as const
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number]
export const RESPONSE_STATUS_LABELS: Record<ResponseStatus, string> = {
  observed: '확인했어요(관찰함)',
  performed: '요청대로 했어요(수행함)',
  not_observed: '이번에 확인하지 못했어요(미관찰)',
  refused: '어르신·보호자가 거절했어요',
  other: '기타',
}

/** 현장 응답 — 새 보고에 붙어 온다(원 요청·조치·의무·보고 id로 연결). 수정·삭제하지 않는다. */
export interface FieldResponse {
  id: string
  field_request_id: string
  action_id: string
  obligation_id: string
  report_id: string
  recipient_code: string
  /** 실제 응답자(요양보호사 세션의 참여자 코드). */
  responder_code: string
  response_status: ResponseStatus
  response_text: string | null
  /** 이번 보고 원문에서 요양보호사가 확인해 연결한 부분(없으면 null). */
  evidence_excerpt: string | null
  evidence_source: 'report_text' | 'typed' | null
  /** 응답이 도착했을 때의 요청 상태 — 철회·종결 뒤 늦은 응답도 기록은 남긴다. */
  request_state_at_response: FieldRequestStatus
  /** 이 응답으로 현장 응답 의무가 해소됐는지(게시 중이던 요청의 첫 응답만 true). */
  fulfilled_obligation: boolean
  submitted_at: string
  request_id: string
}

export const VERIFICATION_OUTCOMES = ['improved', 'no_change', 'unable_to_confirm', 'refused', 'unreachable', 'external_handoff'] as const
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number]
export const VERIFICATION_OUTCOME_LABELS: Record<VerificationOutcome, string> = {
  improved: '나아진 것으로 확인',
  no_change: '변화 없음 확인',
  unable_to_confirm: '확인 불가',
  refused: '거절',
  unreachable: '연락 불가',
  external_handoff: '외부 기관 인계',
}
/** 남은 문제와 다음 책임을 반드시 적어야 하는 결과. */
export const OUTCOMES_REQUIRING_FOLLOWUP_NOTE: VerificationOutcome[] = ['unable_to_confirm', 'refused', 'unreachable', 'external_handoff']

/** 관리자 결과 확인(재확인) — 요약·시각·근거. 수정·삭제하지 않는다. */
export interface ActionVerification {
  id: string
  action_id: string
  cycle_no: number
  outcome: VerificationOutcome
  summary: string
  evidence: string
  response_ids: string[]
  remaining_issue: string | null
  next_responsibility: string | null
  /** true면 조치를 종결, false면 새 후속 주기를 열었다. */
  closes_action: boolean
  verified_at: string
  actor_scope: string
  entered_by_label: string | null
  request_id: string
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

export type ActionEventType =
  | 'created'
  | 'activated'
  | 'updated'
  | 'due_changed'
  | 'completed'
  | 'cancelled'
  | 'reopened'
  | 'published'
  | 'withdrawn'
  | 'retargeted'
  | 'response_received'
  | 'verified'

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
  status: 400 | 403 | 404 | 409
  constructor(status: 400 | 403 | 404 | 409, message: string) {
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
  /** 3단계: 이 조치의 현장 요청·응답(없으면 빈 배열로 본다). */
  requests?: FieldRequest[]
  responses?: FieldResponse[]
  /** 3단계: 게시·대상 변경 검증용 — 이 수급자에게 지금 활성 배정된 요양보호사 코드. */
  assignees?: string[]
}

export interface ActionPlan {
  action: CareAction
  obligations: ActionObligation[]
  /** 이번 요청으로 새로 생기는 의무(생성·재개·새 후속 주기). */
  obligationInserts: ActionObligation[]
  /** 이번 요청으로 바뀌는 기존 의무(전체 행). */
  obligationUpdates: ActionObligation[]
  /** 3단계: 새로 게시하는 현장 요청 / 상태가 바뀌는 기존 요청 / 결과 확인 기록. */
  requestInserts: FieldRequest[]
  requestUpdates: FieldRequest[]
  verificationInserts: ActionVerification[]
  /** 이번 요청의 이력 한 줄(요청 하나 = 이벤트 하나, request_id로 중복 방지). */
  event: ActionEvent
}

function obligationStatusFor(type: ObligationType, actionStatus: ActionStatus): ObligationStatus {
  if (actionStatus === 'draft') return 'inactive'
  // 현장 응답 의무는 관리자가 요청을 명시적으로 게시해야 시작된다.
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
    requestInserts: [],
    requestUpdates: [],
    verificationInserts: [],
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
export interface FollowUpInput {
  responseDue?: DueInput | null
  verificationDue?: DueInput | null
  executionDue?: DueInput | null
  fieldMessageDraft?: string | null
}

export type ActionMutation =
  | { op: 'update'; purpose?: string; actionContent?: string | null; fieldMessageDraft?: string | null; internalNote?: string | null; ownerLabel?: string | null; reason?: string | null }
  | { op: 'change_due'; obligationId: string; due: DueInput; reason: string }
  | { op: 'activate' }
  | { op: 'complete'; evidence: string; remaining?: string | null }
  | { op: 'cancel'; reason: string }
  | { op: 'reopen'; reason: string; verificationDue?: DueInput | null; executionDue?: DueInput | null; responseDue?: DueInput | null }
  // 3단계
  | { op: 'publish'; targetMode: RequestTargetMode; targetCaregiverCode?: string | null }
  | { op: 'withdraw'; fieldRequestId: string; reason: string }
  | { op: 'retarget'; fieldRequestId: string; targetMode: RequestTargetMode; targetCaregiverCode?: string | null; reason: string }
  | {
      op: 'verify'
      outcome: VerificationOutcome
      summary: string
      evidence: string
      remaining?: string | null
      nextResponsibility?: string | null
      /** true: 조치 종결, false: 추가 확인 — 새 후속 주기를 연다. */
      closeAction: boolean
      followUp?: FollowUpInput | null
    }

export type ActionMutationInput = ActionMutation & { actionId: string; expectedVersion: number; requestId: string; enteredByLabel?: string | null }

/** 3단계 변경(게시·철회·대상 변경·결과 확인)은 3단계 저장소가 있어야 한다. */
export const FIELD_REQUEST_OPS: ReadonlyArray<ActionMutation['op']> = ['publish', 'withdraw', 'retarget', 'verify']

function resolveTarget(mode: RequestTargetMode, code: string | null | undefined, assignees: string[]): string | null {
  if (!(['recipient_assignees', 'specific_caregiver'] as string[]).includes(mode)) throw new WorkflowError(400, '요청 대상을 선택해 주세요.')
  if (assignees.length === 0) {
    throw new WorkflowError(409, '이 수급자에게 지금 배정된 요양보호사가 없어 요청을 보낼 수 없습니다. 배정을 먼저 확인해 주세요.')
  }
  if (mode === 'recipient_assignees') return null
  const target = text(code)?.toUpperCase() ?? null
  if (!target) throw new WorkflowError(400, '요청을 받을 요양보호사를 선택해 주세요.')
  if (!assignees.includes(target)) throw new WorkflowError(409, `${target}은(는) 지금 이 수급자에게 배정되어 있지 않습니다.`)
  return target
}

export function planActionMutation(state: ActionState, input: ActionMutationInput, ctx: WorkflowContext): ActionPlan {
  const current = state.action
  if (current.version !== input.expectedVersion) {
    throw new WorkflowError(409, '다른 곳에서 이 조치가 먼저 수정됐습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.')
  }
  const requestId = requireText(input.requestId, '요청 식별자가 없습니다.')
  const requests = state.requests ?? []
  const responses = state.responses ?? []
  const next: CareAction = { ...current, version: current.version + 1, updated_at: ctx.now }
  const updates: ActionObligation[] = []
  const inserts: ActionObligation[] = []
  const requestInserts: FieldRequest[] = []
  const requestUpdates: FieldRequest[] = []
  const verificationInserts: ActionVerification[] = []
  let eventType: ActionEventType
  let reason: string | null = null
  let obligationId: string | null = null
  let detail: Record<string, unknown> = {}
  const editable = current.status === 'draft' || current.status === 'open'
  const setObligation = (ob: ActionObligation, patch: Partial<ActionObligation>) => {
    const i = updates.findIndex((u) => u.id === ob.id)
    const base = i >= 0 ? updates[i] : ob
    const merged = { ...base, ...patch }
    if (i >= 0) updates[i] = merged
    else updates.push(merged)
  }
  /** 게시 중인 요청을 끝내고(철회·종결), 아직 이행되지 않은 그 요청의 현장 응답 의무를 취소하거나
   * (요청만 철회할 때) 게시 전으로 되돌린다 — 같은 주기에서 문구를 고쳐 새 요청으로 다시 게시할 수 있게.
   * 기록은 지우지 않는다 — 철회된 요청 행은 상태와 끝난 이유를 남긴 채 그대로 둔다. */
  const endPublished = (filter: (r: FieldRequest) => boolean, status: 'withdrawn' | 'closed', why: string, obligationAfter: 'cancelled' | 'pending_publish' = 'cancelled') => {
    for (const r of requests.filter((x) => x.status === 'published' && filter(x))) {
      requestUpdates.push({ ...r, status, ended_at: ctx.now, end_reason: why, version: r.version + 1 })
      const ob = state.obligations.find((o) => o.id === r.obligation_id)
      if (ob && ob.status !== 'fulfilled' && ob.status !== 'cancelled') {
        setObligation(ob, obligationAfter === 'cancelled' ? { status: 'cancelled', cancelled_at: ctx.now } : { status: 'pending_publish', activated_at: null })
      }
    }
  }
  const newCycle = (cycle: number, follow: FollowUpInput | null | undefined) => {
    if (current.kind === 'field_request') {
      inserts.push(newObligation(ctx, current.id, cycle, 'field_response', normalizeDue(follow?.responseDue, true, OBLIGATION_TYPE_LABELS.field_response), 'open'))
    } else {
      inserts.push(newObligation(ctx, current.id, cycle, 'admin_execution', normalizeDue(follow?.executionDue, false, OBLIGATION_TYPE_LABELS.admin_execution), 'open'))
    }
    inserts.push(newObligation(ctx, current.id, cycle, 'admin_verification', normalizeDue(follow?.verificationDue, false, OBLIGATION_TYPE_LABELS.admin_verification), 'open'))
  }

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
        throw new WorkflowError(409, '이미 끝난 기한은 바꿀 수 없습니다. 새 확인이 필요하면 새 후속 주기를 여세요.')
      }
      reason = requireText(input.reason, '기한을 바꾸는 이유를 입력해 주세요.')
      const due = normalizeDue(input.due, ob.obligation_type === 'field_response', OBLIGATION_TYPE_LABELS[ob.obligation_type])
      if (due.kind === ob.current_due_kind && timeOf(due.at) === timeOf(ob.current_due_at)) throw new WorkflowError(400, '바뀐 기한이 없습니다.')
      // 최초 기한(initial_*)은 그대로 두고 현재 기한만 바꾼다 — 과거 지연 기록을 지우지 않는다.
      setObligation(ob, { current_due_kind: due.kind, current_due_at: due.at })
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
        setObligation(ob, { status, activated_at: status === 'active' ? ctx.now : null })
      }
      eventType = 'activated'
      break
    }
    case 'complete': {
      if (current.status !== 'open') throw new WorkflowError(409, '진행 중인 조치만 완료할 수 있습니다.')
      if (current.kind === 'field_request') {
        // 현장 답변이 필요한 조치는 "결과 확인"으로만 끝낸다(답변 도착 ≠ 완료).
        throw new WorkflowError(409, '현장 확인 요청은 "결과 확인"에서 근거를 남겨 종결합니다(답변 도착만으로 완료하지 않음).')
      }
      const evidence = requireText(input.evidence, '실제로 한 일과 결과 근거를 입력해 주세요.')
      next.status = 'completed'
      next.completion_evidence = evidence
      next.completion_remaining = text(input.remaining)
      next.completed_at = ctx.now
      for (const ob of state.obligations.filter((o) => o.cycle_no === current.current_cycle && o.status === 'active')) {
        setObligation(ob, { status: 'fulfilled', fulfilled_at: ctx.now })
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
      if (current.kind === 'field_request') next.field_message_status = 'unpublished'
      // 게시 중인 요청도 함께 철회한다 — 취소 뒤 늦게 온 응답은 기록만 남고 조치를 되살리지 않는다.
      endPublished(() => true, 'withdrawn', `조치 취소: ${reason}`)
      for (const ob of state.obligations.filter((o) => o.status !== 'fulfilled' && o.status !== 'cancelled')) {
        setObligation(ob, { status: 'cancelled', cancelled_at: ctx.now })
      }
      eventType = 'cancelled'
      detail = {
        overdue_at_cancel: state.obligations.filter((o) => isObligationOverdue(o, ctx.now)).map((o) => o.id),
        withdrawn_requests: requestUpdates.map((r) => r.id),
      }
      break
    }
    case 'reopen': {
      if (current.status !== 'completed') throw new WorkflowError(409, '완료된 조치만 재개할 수 있습니다.')
      reason = requireText(input.reason, '재개하는 이유를 입력해 주세요.')
      // 기존 완료·기한·결과 확인 기록은 그대로 두고 새 후속 주기를 만든다.
      const cycle = current.current_cycle + 1
      next.status = 'open'
      next.current_cycle = cycle
      if (current.kind === 'field_request') next.field_message_status = 'unpublished'
      newCycle(cycle, { responseDue: input.responseDue, verificationDue: input.verificationDue, executionDue: input.executionDue })
      eventType = 'reopened'
      detail = {
        previous_completed_at: current.completed_at,
        previous_evidence: current.completion_evidence,
        previous_outcome: current.closure_outcome ?? null,
        new_cycle: cycle,
        new_obligations: inserts.map((o) => ({ id: o.id, type: o.obligation_type, due_kind: o.initial_due_kind, due_at: o.initial_due_at })),
      }
      break
    }
    case 'publish': {
      if (current.status !== 'open') throw new WorkflowError(409, '진행 중인 조치만 현장에 게시할 수 있습니다.')
      if (current.kind !== 'field_request') throw new WorkflowError(400, '관리자 직접 조치는 현장에 게시하지 않습니다.')
      const message = requireText(current.field_message_draft, '현장에 전달할 요청 내용을 먼저 입력해 주세요.')
      const ob = state.obligations.find((o) => o.cycle_no === current.current_cycle && o.obligation_type === 'field_response')
      if (!ob || ob.status !== 'pending_publish' || requests.some((r) => r.cycle_no === current.current_cycle && (r.status === 'published' || r.status === 'answered'))) {
        throw new WorkflowError(409, '이번 후속 주기의 현장 요청은 이미 게시됐거나 끝났습니다.')
      }
      const target = resolveTarget(input.targetMode, input.targetCaregiverCode, state.assignees ?? [])
      const req: FieldRequest = {
        id: ctx.newId(),
        organization_id: current.organization_id,
        action_id: current.id,
        obligation_id: ob.id,
        cycle_no: current.current_cycle,
        recipient_code: current.recipient_code,
        message,
        target_mode: input.targetMode,
        target_caregiver_code: target,
        status: 'published',
        published_at: ctx.now,
        first_shown_at: null,
        first_shown_to: null,
        answered_at: null,
        ended_at: null,
        end_reason: null,
        version: 1,
        publish_request_id: requestId,
      }
      requestInserts.push(req)
      // 게시 순간부터 현장 응답기한이 시작된다. '다음 실제 방문'이면 날짜 없이 방문 대기로 남는다.
      setObligation(ob, { status: 'active', activated_at: ctx.now })
      next.field_message_status = 'published'
      eventType = 'published'
      obligationId = ob.id
      detail = {
        field_request_id: req.id,
        target_mode: req.target_mode,
        target_caregiver_code: target,
        assignees_at_publish: state.assignees ?? [],
        response_due: { kind: ob.current_due_kind, at: ob.current_due_at },
      }
      break
    }
    case 'withdraw': {
      if (!editable) throw new WorkflowError(409, '완료·취소된 조치의 요청은 이미 끝났습니다.')
      const req = requests.find((r) => r.id === input.fieldRequestId)
      if (!req) throw new WorkflowError(404, '현장 요청을 찾을 수 없습니다.')
      if (req.status !== 'published') throw new WorkflowError(409, '게시 중인 요청만 철회할 수 있습니다.')
      reason = requireText(input.reason, '철회 이유를 입력해 주세요.')
      // 현장 응답 의무는 게시 전으로 돌아간다(최초·현재 기한은 그대로) — 문구를 고쳐 다시 게시할 수 있다.
      endPublished((r) => r.id === req.id, 'withdrawn', reason, 'pending_publish')
      next.field_message_status = 'unpublished'
      eventType = 'withdrawn'
      obligationId = req.obligation_id
      detail = { field_request_id: req.id, first_shown_at: req.first_shown_at, obligation_back_to: 'pending_publish' }
      break
    }
    case 'retarget': {
      if (current.status !== 'open') throw new WorkflowError(409, '진행 중인 조치의 요청만 대상을 바꿀 수 있습니다.')
      const req = requests.find((r) => r.id === input.fieldRequestId)
      if (!req) throw new WorkflowError(404, '현장 요청을 찾을 수 없습니다.')
      if (req.status !== 'published') throw new WorkflowError(409, '응답 대기 중인 요청만 대상을 바꿀 수 있습니다.')
      reason = requireText(input.reason, '대상을 바꾸는 이유를 입력해 주세요.')
      const target = resolveTarget(input.targetMode, input.targetCaregiverCode, state.assignees ?? [])
      if (input.targetMode === req.target_mode && target === req.target_caregiver_code) throw new WorkflowError(400, '바뀐 대상이 없습니다.')
      requestUpdates.push({ ...req, target_mode: input.targetMode, target_caregiver_code: target, version: req.version + 1 })
      eventType = 'retargeted'
      obligationId = req.obligation_id
      detail = {
        field_request_id: req.id,
        from: { mode: req.target_mode, caregiver: req.target_caregiver_code },
        to: { mode: input.targetMode, caregiver: target },
        assignees_at_change: state.assignees ?? [],
      }
      break
    }
    case 'verify': {
      if (current.status !== 'open') throw new WorkflowError(409, '진행 중인 조치만 결과를 확인할 수 있습니다.')
      if (!(VERIFICATION_OUTCOMES as readonly string[]).includes(input.outcome)) throw new WorkflowError(400, '확인한 결과를 선택해 주세요.')
      const summary = requireText(input.summary, '결과 요약을 입력해 주세요.')
      const evidence = requireText(input.evidence, '무엇을 근거로 확인했는지 입력해 주세요(현장 응답·통화 등).')
      const remaining = text(input.remaining)
      const nextResponsibility = text(input.nextResponsibility)
      if (OUTCOMES_REQUIRING_FOLLOWUP_NOTE.includes(input.outcome) && (!remaining || !nextResponsibility)) {
        throw new WorkflowError(400, `${VERIFICATION_OUTCOME_LABELS[input.outcome]}(으)로 정리할 때는 남은 문제와 다음 책임·업무를 적어 주세요.`)
      }
      const cycle = current.current_cycle
      const cycleRequestIds = new Set(requests.filter((r) => r.cycle_no === cycle).map((r) => r.id))
      const responseIds = responses.filter((r) => cycleRequestIds.has(r.field_request_id)).map((r) => r.id)
      // 이 주기에서 아직 답을 기다리던 요청은 결과 확인과 함께 게시를 끝낸다(기록은 보존).
      endPublished((r) => r.cycle_no === cycle, 'closed', '관리자 결과 확인으로 게시 종료')
      for (const ob of state.obligations.filter((o) => o.cycle_no === cycle)) {
        if (ob.status === 'pending_publish' || ob.status === 'inactive') setObligation(ob, { status: 'cancelled', cancelled_at: ctx.now })
        else if (ob.status === 'active' && ob.obligation_type !== 'field_response') setObligation(ob, { status: 'fulfilled', fulfilled_at: ctx.now })
      }
      const verification: ActionVerification = {
        id: ctx.newId(),
        action_id: current.id,
        cycle_no: cycle,
        outcome: input.outcome,
        summary,
        evidence,
        response_ids: responseIds,
        remaining_issue: remaining,
        next_responsibility: nextResponsibility,
        closes_action: Boolean(input.closeAction),
        verified_at: ctx.now,
        actor_scope: ADMIN_ACTOR_SCOPE,
        entered_by_label: text(input.enteredByLabel),
        request_id: requestId,
      }
      verificationInserts.push(verification)
      if (current.kind === 'field_request') next.field_message_status = 'unpublished'
      if (input.closeAction) {
        // 종결은 사실(결과)의 기록일 뿐 — 건강 개선으로 세지 않는다.
        next.status = 'completed'
        next.closure_outcome = input.outcome
        next.completion_evidence = `${summary} — 근거: ${evidence}`
        next.completion_remaining = remaining
        next.completed_at = ctx.now
      } else {
        const nextCycle = cycle + 1
        next.current_cycle = nextCycle
        if (current.kind === 'field_request' && input.followUp?.fieldMessageDraft !== undefined) {
          next.field_message_draft = text(input.followUp.fieldMessageDraft) ?? current.field_message_draft
        }
        newCycle(nextCycle, input.followUp)
      }
      eventType = 'verified'
      detail = {
        verification_id: verification.id,
        outcome: input.outcome,
        closes_action: verification.closes_action,
        response_ids: responseIds,
        new_cycle: input.closeAction ? null : cycle + 1,
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
    requestInserts,
    requestUpdates,
    verificationInserts,
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

// ── 현장 응답 기록(3단계) ─────────────────────────────────────────
export interface FieldResponseInput {
  fieldRequestId: string
  status: ResponseStatus
  text?: string | null
  /** 요양보호사가 확인해 연결한 이번 보고 원문 일부(없으면 직접 입력한 답만). */
  evidenceExcerpt?: string | null
  requestId: string
}

export interface FieldResponseContext {
  report: { id: string; recipient_code: string; participant_code: string; status: string; report_source?: string }
  responderCode: string
  /** 응답 시점에 이 수급자에게 활성 배정된 요양보호사. */
  assignees: string[]
  request: FieldRequest
  action: CareAction
  obligation: ActionObligation | null
}

export interface FieldResponsePlan {
  response: FieldResponse
  /** 게시 중이던 요청의 첫 응답일 때만: 요청 → 응답 도착, 현장 응답 의무 → 이행, 조치 버전 +1. */
  requestUpdate: FieldRequest | null
  obligationUpdate: ActionObligation | null
  actionUpdate: CareAction | null
  event: ActionEvent
}

/** 현장 응답 한 건. 권한(배정·지정 대상·본인 보고)을 확인하고, 철회·종결 뒤 늦게 온 응답은
 * 기록만 남긴다 — 조치를 되살리거나 완료시키지 않는다. 응답 도착은 완료가 아니다
 * (관리자 결과 확인 의무는 그대로 남는다). */
export function planFieldResponse(c: FieldResponseContext, input: FieldResponseInput, ctx: WorkflowContext): FieldResponsePlan {
  const { report, request } = c
  if (report.status !== 'submitted') throw new WorkflowError(409, '제출된 보고에만 센터 요청 답변을 연결할 수 있습니다.')
  if ((report.report_source ?? 'live') !== 'live') throw new WorkflowError(400, '연습 보고는 센터 요청에 답할 수 없습니다.')
  if (report.participant_code !== c.responderCode) throw new WorkflowError(403, '본인이 작성한 보고에만 답변을 연결할 수 있습니다.')
  if (report.recipient_code !== request.recipient_code) throw new WorkflowError(400, '다른 수급자의 요청에는 이 보고로 답할 수 없습니다.')
  if (!c.assignees.includes(c.responderCode)) throw new WorkflowError(403, '지금 배정되지 않은 수급자의 요청에는 답할 수 없습니다.')
  if (request.target_mode === 'specific_caregiver' && request.target_caregiver_code !== c.responderCode) {
    throw new WorkflowError(403, '다른 요양보호사에게 보낸 요청입니다.')
  }
  if (!(RESPONSE_STATUSES as readonly string[]).includes(input.status)) throw new WorkflowError(400, '답변 종류를 선택해 주세요.')
  const responseText = text(input.text)
  const evidence = text(input.evidenceExcerpt)
  if (input.status === 'other' && !responseText && !evidence) throw new WorkflowError(400, '"기타"는 내용을 적어 주세요.')
  const firstAnswer = request.status === 'published'
  const response: FieldResponse = {
    id: ctx.newId(),
    field_request_id: request.id,
    action_id: request.action_id,
    obligation_id: request.obligation_id,
    report_id: report.id,
    recipient_code: request.recipient_code,
    responder_code: c.responderCode,
    response_status: input.status,
    response_text: responseText,
    evidence_excerpt: evidence,
    evidence_source: evidence ? 'report_text' : responseText ? 'typed' : null,
    request_state_at_response: request.status,
    fulfilled_obligation: firstAnswer,
    submitted_at: ctx.now,
    request_id: requireText(input.requestId, '요청 식별자가 없습니다.'),
  }
  const requestUpdate = firstAnswer ? { ...request, status: 'answered' as const, answered_at: ctx.now, version: request.version + 1 } : null
  const obligationUpdate =
    firstAnswer && c.obligation && c.obligation.status === 'active' ? { ...c.obligation, status: 'fulfilled' as const, fulfilled_at: ctx.now } : null
  const actionUpdate = firstAnswer ? { ...c.action, version: c.action.version + 1, updated_at: ctx.now } : null
  return {
    response,
    requestUpdate,
    obligationUpdate,
    actionUpdate,
    event: {
      id: ctx.newId(),
      action_id: request.action_id,
      obligation_id: request.obligation_id,
      event_type: 'response_received',
      reason: null,
      detail: {
        field_request_id: request.id,
        response_id: response.id,
        report_id: report.id,
        response_status: input.status,
        request_state_at_response: request.status,
        fulfilled_obligation: firstAnswer,
        late: request.status === 'withdrawn' || request.status === 'closed',
      },
      actor_scope: 'caregiver_session',
      entered_by_label: null,
      owner_label_at_event: c.action.owner_label,
      request_id: response.request_id,
      occurred_at: ctx.now,
    },
  }
}

/** 요양보호사 화면에 보일 요청인지(현재 배정·지정 대상 기준). 게시 중인 요청만 보인다. */
export function isRequestVisibleTo(request: Pick<FieldRequest, 'status' | 'target_mode' | 'target_caregiver_code' | 'recipient_code'>, caregiverCode: string, assignedRecipients: string[]): boolean {
  if (request.status !== 'published') return false
  if (!assignedRecipients.includes(request.recipient_code)) return false
  return request.target_mode === 'recipient_assignees' || request.target_caregiver_code === caregiverCode
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
