/**
 * AI365 생활안전스캐너 데이터 구조.
 * 질문 프로토콜(protocol.ts)과 위험규칙(riskRules.ts)이 이 타입을 기준으로
 * UI 컴포넌트와 분리되어 관리된다.
 */

export type SafetyArea = 'mobility' | 'gasFire' | 'electrical'

export const AREA_LABELS: Record<SafetyArea, string> = {
  mobility: '낙상·이동 동선',
  gasFire: '가스·화재',
  electrical: '전기',
}

export type RiskLevelCode = 'LEVEL1' | 'LEVEL2' | 'LEVEL3'

/** 질문 하나의 선택지 하나. signalId가 null이면 위험신호 없음(정상 응답)을 뜻한다. */
export interface ProtocolOption {
  id: string
  label: string
  signalId: string | null
}

interface ProtocolStepBase {
  id: string
  area: SafetyArea
  /** 이 단계 이전까지 수집된 신호를 보고 이 단계를 물을지 결정한다. 없으면 항상 진행. */
  askIf?: (collectedSignalIds: string[]) => boolean
}

export interface ProtocolQuestion extends ProtocolStepBase {
  kind: 'question'
  /** AI 질문 말풍선 문구 */
  prompt: string
  /** single: 하나만 선택, multi: 여러 개 선택 후 '다음' */
  answerType: 'single' | 'multi'
  options: ProtocolOption[]
}

export interface ProtocolPhotoPrompt extends ProtocolStepBase {
  kind: 'photo'
  /** 촬영 안내 문구 (개인정보 주의 문구는 별도 상수로 공통 표시) */
  prompt: string
}

export type ProtocolStep = ProtocolQuestion | ProtocolPhotoPrompt

/** 대화창에 쌓이는 한 줄(AI 질문 또는 생활지원사 답변) */
export interface ScanMessage {
  id: string
  role: 'ai' | 'user'
  text: string
}

/** 생활지원사가 실제로 관찰/응답한 내용 한 건 */
export interface Observation {
  id: string
  area: SafetyArea
  question: string
  answerLabel: string
  signalIds: string[]
}

/** 세션 안에서만 미리보기로 보관되는 현장사진(업로드 없음) */
export interface EvidencePhoto {
  id: string
  area: SafetyArea
  areaLabel: string
  previewUrl: string
  capturedAt: string
}

export interface RiskSignal {
  id: string
  area: SafetyArea
  label: string
  level: RiskLevelCode
  emergency?: boolean
}

export interface RiskAssessment {
  level: RiskLevelCode
  signals: RiskSignal[]
  isEmergency: boolean
}

/** 현장조치(즉시 대응) 입력 결과 */
export interface ImmediateAction {
  selected: string[]
  customText: string
}

/** 결과 카드에 표시되는 추천 후속조치 한 건 (확정 아님, "검토" 문구만) */
export interface FollowUpAction {
  id: string
  label: string
}

export type ScanStatus = '기록 완료' | '기관 확인 대기' | '우선 확인 필요'

/** 점검 완료 뒤 자동 정리되는 생활안전 사례카드 */
export interface ScanResult {
  performedAt: string
  scanType: string
  demoSubjectName: string
  areasChecked: SafetyArea[]
  /** 영역별 생활지원사 주요 관찰 요약 문장 목록 */
  observationSummary: string[]
  /** 어르신이 직접 말한 내용(자유 메모). 없으면 빈 배열. */
  subjectQuotes: string[]
  observations: Observation[]
  evidencePhotos: EvidencePhoto[]
  riskAssessment: RiskAssessment
  immediateAction: ImmediateAction
  institutionCheckNotes: string[]
  followUpActions: FollowUpAction[]
  nextVisitChecks: string[]
  status: ScanStatus
}

export interface ScanSession {
  id: string
  startedAt: string
  demoSubjectName: string
  messages: ScanMessage[]
  observations: Observation[]
  evidencePhotos: EvidencePhoto[]
  collectedSignalIds: string[]
}
