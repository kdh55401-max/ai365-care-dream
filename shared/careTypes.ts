/** 서버(api/)와 브라우저(src/) 양쪽에서 쓰는 CARE REPORT 공통 타입.
 * Node/DOM 전용 API를 쓰지 않는 순수 TypeScript만 둔다. */

export interface StructuredReport {
  change: string
  action: string
  result: string
  escalation: string
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

  deleted: boolean
  created_at: string
  updated_at: string
}

export interface AiTurnResult {
  needFollowup: boolean
  question: string | null
  missingField: string | null
  report: StructuredReport | null
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
