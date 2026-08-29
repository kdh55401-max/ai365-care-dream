import type { CareResponse, RiskLevel } from './gemini'

export const CENTER_INSTRUCTION_OPTIONS = [
  '현장에서 계속 관찰',
  '보호자에게 연락',
  '의료기관 상담 또는 방문',
  '119 신고',
  '서비스 일정 조정',
  '관리자 추가 확인',
  '기타',
]

export const FIELD_ACTION_OPTIONS = [
  '안전한 자세 유지',
  '상태 계속 관찰',
  '보호자에게 연락',
  '센터에 보고',
  '119 신고',
  '의료기관 이동',
  '아직 조치 중',
  '기타',
]

export interface CaseDraftInput {
  /** <input type="datetime-local"> 값 ("YYYY-MM-DDTHH:mm") */
  occurredAt: string
  situation: string
  answers: Array<{ question: string; label: string; tier: RiskLevel }>
  result: CareResponse
  /** 센터 전화 버튼을 눌렀는지 여부. 통화 완료 여부를 뜻하지 않는다. */
  centerCallClicked: boolean
  centerInstructions: string[]
  centerInstructionNote: string
  fieldActions: string[]
  fieldActionNote: string
}

export interface CaseDraftItem {
  label: string
  value: string
}

const FURTHER_CHECK_BY_TIER: Record<RiskLevel, string> = {
  '일반 관찰': '경과를 지속적으로 관찰할 예정임',
  '기관 확인 필요': '기관 판단에 따라 추가 확인이 필요할 수 있음',
  '우선 확인 필요': '즉시 확인 및 대응이 필요한 상황임',
}

/**
 * 지금까지 사용자가 입력·선택한 사실만으로 기록 초안을 구성한다. 확인되지
 * 않은 조치나 지시사항, 통화 완료 여부를 임의로 만들어내지 않는다.
 */
export function buildCaseDraftItems(input: CaseDraftInput): CaseDraftItem[] {
  const qaText = input.answers.length
    ? input.answers.map((a) => `${a.question} → ${a.label}`).join(' / ')
    : '추가 확인 질문 없음'

  const reportStatus = input.centerCallClicked
    ? '센터로 연락을 시도함 (통화 완료 여부는 화면에서 확인되지 않음)'
    : '센터 연락 여부가 기록되지 않음'

  const centerInstructionParts = [
    ...input.centerInstructions,
    ...(input.centerInstructionNote.trim() ? [input.centerInstructionNote.trim()] : []),
  ]
  const centerInstructionText =
    centerInstructionParts.length > 0
      ? centerInstructionParts.join(', ')
      : '전달받은 지시사항이 기록되지 않음'

  const fieldActionText =
    input.fieldActions.length > 0 ? input.fieldActions.join(', ') : '기록된 조치 없음'

  const currentResultText = input.fieldActionNote.trim() || '추가로 기록된 내용 없음'

  return [
    { label: '발생 일시', value: input.occurredAt.replace('T', ' ') },
    { label: '수급자 가명 ID', value: '가명 ID 미입력' },
    { label: '발생 상황', value: input.situation },
    { label: '추가 확인 내용', value: qaText },
    { label: '위험도 분류', value: input.result.riskLevel },
    { label: 'AI가 안내한 현장 대응', value: input.result.immediateAction },
    { label: '기관 보고 여부', value: reportStatus },
    { label: '기관 지시사항', value: centerInstructionText },
    { label: '실제 현장 조치', value: fieldActionText },
    { label: '현재 결과', value: currentResultText },
    { label: '추가 확인 필요 여부', value: FURTHER_CHECK_BY_TIER[input.result.riskLevel] },
  ]
}

export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
