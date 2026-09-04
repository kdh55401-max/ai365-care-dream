export type {
  AiTurnResult,
  CareReportRecord,
  DomainEntry,
  DomainKey,
  DomainStatus,
  FollowupItem,
  InitialStatusChoice,
  InputMethod,
  ReportSource,
  ReportStatus,
  ReportType,
  StructuredReport,
} from '../../../shared/careTypes.js'
export { computeInformativeness, DOMAIN_LABELS, DOMAIN_KEYS } from '../../../shared/careTypes.js'

import type { CareReportRecord } from '../../../shared/careTypes.js'

/** 목록 화면(본인/전체 목록)에서 쓰는 축약 형태. 실제로는 CareReportRecord의 부분집합. */
export type CareReportListItem = Pick<
  CareReportRecord,
  | 'id'
  | 'recipient_code'
  | 'report_type'
  | 'report_date'
  | 'status'
  | 'submitted_at'
  | 'completion_seconds'
  | 'created_at'
> &
  Partial<
    Pick<
      CareReportRecord,
      'initial_status_choice' | 'no_information_report' | 'report_source' | 'scenario_id' | 'ai_inaccuracy_detected' | 'raw_evaluated_at' | 'ai_evaluated_at' | 'participant_code'
    >
  >

export type CareReportDetail = CareReportRecord

/** /care 화면이 보고 1건을 만들거나 저장할 때 서버(api/care/reports PATCH)로 보내는
 * 요청 바디. wire 포맷은 camelCase를 쓴다(기존 API 컨벤션 유지). */
export interface CareReportPatchInput {
  id: string
  rawInput?: string
  inputMethod?: 'voice' | 'text'
  followupQuestions?: import('../../../shared/careTypes.js').FollowupItem[]
  followupAnswers?: import('../../../shared/careTypes.js').FollowupItem[]
  aiGeneratedReport?: import('../../../shared/careTypes.js').StructuredReport
  caregiverFinalReport?: import('../../../shared/careTypes.js').StructuredReport
  initialStatusChoice?: 'changed' | 'similar' | 'uncertain'
  noChangeInitialInput?: boolean
  observedDomains?: import('../../../shared/careTypes.js').DomainEntry[]
  changedDomains?: import('../../../shared/careTypes.js').DomainEntry[]
  unobservedDomains?: import('../../../shared/careTypes.js').DomainEntry[]
  uncertainDomains?: import('../../../shared/careTypes.js').DomainEntry[]
  noChangeFollowupCount?: number
  noChangeFollowupAnswered?: number
  initialInformationCount?: number
  finalInformationCount?: number
  informationAddedCount?: number
  noInformationReport?: boolean
  submit?: boolean
}

export interface CareReportCreateInput {
  recipientCode: string
  reportType: 'daily' | 'additional'
  inputMethod: 'voice' | 'text'
  reportSource?: 'live' | 'scenario'
  scenarioId?: string
}
