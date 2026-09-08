/** 서버(api/)와 브라우저(src/) 양쪽에서 쓰는 CARE REPORT 공통 타입.
 * Node/DOM 전용 API를 쓰지 않는 순수 TypeScript만 둔다. */

export interface StructuredReport {
  change: string
  action: string
  result: string
  escalation: string
  /** 요양보호사 본인이 표현한 어려움·지원 요청. 어르신에 대한 관찰 사실(change)과
   * 분리해서 담는다 — "제가 힘들었어요"와 "어르신이 힘들어하셨어요"를 섞지 않기 위함.
   * 규칙 기반 추출이 애매하면 "[주체 확인 필요] " 접두어를 붙여 원문을 그대로
   * 보존한다(임의로 버리거나 어르신 상태변화로 바꾸지 않는다). */
  caregiverNote: string
}

export interface FollowupItem {
  question: string
  missingField: string
  answer: string
}

export type ReportType = 'daily' | 'additional'
export type ReportStatus = 'draft' | 'submitted'
export type InputMethod = 'voice' | 'text'
export type ReportSource = 'live' | 'scenario'

/** 돌봄보고 시작 직후 첫 선택지. null=아직 선택 안 함(직접 말하기로 건너뜀). */
export type InitialStatusChoice = 'changed' | 'similar' | 'uncertain' | null

export const DOMAIN_KEYS = [
  'meal_hydration',
  'mobility_fall',
  'excretion',
  'cognition_communication',
  'emotion_behavior',
  'pain_breathing',
  'sleep',
  'skin_hygiene',
  'medication',
  'other',
  'not_checked',
] as const
export type DomainKey = (typeof DOMAIN_KEYS)[number]

export const DOMAIN_LABELS: Record<DomainKey, string> = {
  meal_hydration: '식사·수분',
  mobility_fall: '이동·낙상',
  excretion: '배설',
  cognition_communication: '인지·의사소통',
  emotion_behavior: '정서·행동',
  pain_breathing: '통증·호흡',
  sleep: '수면',
  skin_hygiene: '피부·위생',
  medication: '복약 관찰',
  other: '기타',
  not_checked: '확인하지 못함',
}

export type DomainStatus = 'same_as_usual' | 'changed' | 'not_observed' | 'uncertain' | 'not_mentioned'

export interface DomainEntry {
  domain: DomainKey
  status: DomainStatus
}

/** reports 테이블/데모 스토어가 공유하는 전체 필드. DB 컬럼명은 snake_case로 맞춘다. */
export interface CareReportRecord {
  id: string
  participant_code: string
  recipient_code: string
  report_type: ReportType
  report_date: string
  status: ReportStatus
  input_method: InputMethod | null
  started_at: string
  submitted_at: string | null
  completion_seconds: number | null

  raw_input: string
  followup_questions: FollowupItem[]
  followup_answers: FollowupItem[]
  ai_generated_report: StructuredReport | null
  caregiver_final_report: StructuredReport | null

  // 특이사항 없음 흐름 전용 필드
  initial_status_choice: InitialStatusChoice
  no_change_initial_input: boolean
  observed_domains_json: DomainEntry[]
  changed_domains_json: DomainEntry[]
  unobserved_domains_json: DomainEntry[]
  uncertain_domains_json: DomainEntry[]
  no_change_followup_count: number
  no_change_followup_answered: number
  initial_information_count: number
  final_information_count: number
  information_added_count: number
  no_information_report: boolean
  report_source: ReportSource
  scenario_id: string | null

  /** 응급 신호(정규식 기반, 임상적으로 검증된 판정 아님) 감지 시 true. draft 상태에서도
   * 즉시 기록되며, 제출 여부(status)와 별개다 — "전달 성공"/"검토완료" 집계에는 포함하지
   * 않고 관리자 화면에 "미제출·확인 전 주의 신호"로만 별도 표시한다. */
  emergency_flagged: boolean

  /** 최종 보고문이 실제 Gemini 응답으로 만들어졌는지(false) 아니면 Gemini 실패/무효
   * 응답으로 규칙 기반 대체(fallbackReport)가 대신 쓰였는지(true) — "저장됐다"와
   * "AI가 정상 작동했다"는 다른 사실이라 이 필드로 구분한다. null=이 필드가 생기기
   * 전에 만들어진 기록이라 확인 불가(과거 값을 추정해서 채우지 않는다). 데모 모드는
   * 애초에 실제 AI를 쓰지 않으므로 이 필드를 건드리지 않는다(항상 null).*/
  ai_fallback_used: boolean | null
  ai_fallback_stage: 'final_report' | null

  // 관리자 1단계(원문) 평가
  raw_immediately_actionable: boolean | null
  raw_followup_needed: boolean | null
  raw_completeness_score: number | null
  raw_eval_note: string | null
  raw_evaluated_at: string | null

  // 관리자 2단계(AI 보고) 평가
  ai_immediately_actionable: boolean | null
  ai_followup_needed: boolean | null
  ai_completeness_score: number | null
  actual_followup_type: 'none' | 'sms' | 'call' | null
  ai_usefulness_score: number | null
  ai_inaccuracy_detected: boolean | null
  ai_eval_note: string | null
  manager_status: 'confirmed' | 'needs_followup' | 'called' | 'closed' | null
  ai_evaluated_at: string | null

  // 관리자 검토(승인/반려) — 위 1/2단계 연구용 평가와는 별개의, 실제 운영 워크플로우.
  // 이 앱은 공유 관리자 비밀번호 하나뿐이라 개별 검토자 신원은 기록하지 않는다
  // ("누가 검토했는지"는 확인 불가 — 행위주체 범위만 이력에 남긴다).
  /** 관리자가 승인/반려 시 폼에 있던 내용을 그대로 기록(수정 안 했어도 caregiver_final_report를
   * 복사해 채운다) — "확정본 없음"과 "미검토"를 같은 뜻으로 만들지 않기 위함.
   * review_status가 유일한 진실 소스이고, 이 필드는 그 시점의 내용 스냅샷일 뿐이다. */
  admin_final_report: StructuredReport | null
  review_status: ReviewStatus
  review_note: string | null
  reviewed_at: string | null
  review_history: ReviewHistoryEntry[]
  /** 검토 요청 중복방지용 클라이언트 요청 식별자. 화면에는 노출하지 않는다. */
  last_review_request_id: string | null

  deleted: boolean
  created_at: string
  updated_at: string
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface ReviewHistoryEntry {
  at: string
  review_status: ReviewStatus
  review_note: string | null
  admin_final_report: StructuredReport | null
}

const EMPTY_STRUCTURED_REPORT: StructuredReport = { change: '', action: '', result: '', escalation: '', caregiverNote: '' }

/** 저장소(로컬스토리지/DB) 경계에서 한 번만 적용하는 하위호환 정규화. 새 필드가 없는
 * 옛 레코드(캐어기버노트/응급플래그/검토 필드 도입 이전)를 화면이 그대로 다룰 수 있게
 * 기본값을 채운다 — 옛 데이터를 지우거나 바꾸지 않고 읽을 때만 보정한다. */
export function normalizeReportRecord<T extends Partial<CareReportRecord>>(raw: T): T & CareReportRecord {
  const r = raw as Partial<CareReportRecord>
  const normalizeStructured = (s: StructuredReport | null | undefined): StructuredReport | null =>
    s ? { ...EMPTY_STRUCTURED_REPORT, ...s } : s ?? null
  return {
    ...raw,
    ai_generated_report: normalizeStructured(r.ai_generated_report),
    caregiver_final_report: normalizeStructured(r.caregiver_final_report),
    emergency_flagged: r.emergency_flagged ?? false,
    admin_final_report: normalizeStructured(r.admin_final_report),
    review_status: r.review_status ?? 'pending',
    review_note: r.review_note ?? null,
    reviewed_at: r.reviewed_at ?? null,
    review_history: Array.isArray(r.review_history) ? r.review_history : [],
    last_review_request_id: r.last_review_request_id ?? null,
    ai_fallback_used: r.ai_fallback_used ?? null,
    ai_fallback_stage: r.ai_fallback_stage ?? null,
  } as T & CareReportRecord
}

export interface AiTurnResult {
  needFollowup: boolean
  question: string | null
  missingField: string | null
  report: StructuredReport | null
  /** 후속 질문에 대해 화면에서 버튼으로 바로 고를 수 있는 짧은 선택지(2~4개).
   * 타이핑을 줄이기 위한 보조 수단이며, 없으면(undefined/빈 배열) 자유 입력만
   * 제공한다. AI/데모 엔진이 채우지 못한 값을 화면이 임의로 만들어내지 않는다. */
  options?: string[]
  /** true면 복수 선택 후 "다음"으로 진행, false/undefined면 하나를 고르면 바로 진행. */
  allowMultiple?: boolean
  /** report가 채워진 턴(최종 보고문 생성)에서만 의미 있음 — 그 보고문이 실제 Gemini
   * 응답인지(false), Gemini 실패/무효 응답으로 규칙 기반 대체가 쓰였는지(true). */
  usedFallback?: boolean
}

/** AI 생성보고/최종보고의 4개 CARE 영역이 실제로 채워졌는지로 계산하는 자동 정보충실도(0~4).
 * "확인되지 않음"류 placeholder는 채워진 것으로 세지 않는다 — AI가 임의로 채운 것과
 * 구분하기 위함(그런 값은 실질 정보가 아니므로). */
const EMPTY_MARKERS = ['확인되지 않음', '별도 확인하지 않음', '확인하지 못함', '']

export function computeInformativeness(report: StructuredReport | null | undefined): number {
  if (!report) return 0
  const fields: Array<keyof StructuredReport> = ['change', 'action', 'result', 'escalation']
  return fields.reduce((count, key) => {
    const value = (report[key] ?? '').trim()
    if (!value) return count
    if (EMPTY_MARKERS.some((marker) => value === marker)) return count
    return count + 1
  }, 0)
}
