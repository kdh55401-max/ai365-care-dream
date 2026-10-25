// 상태변화 기록지: 사용자가 쓰는 실제 서식(월 1부, 1~5주차 × 일자·체크 6항목·특이사항·급여제공결과)을
// 문서 content 문자열(JSON)로 보관한다. 서버 문서 계약(content: string)은 바꾸지 않는다.
export const STATE_CHANGE_CHECKS = [
  { key: 'body', label: '신체', hint: '통증, 발열, 식사량 감소 등' },
  { key: 'cognition', label: '인지', hint: '기억력, 지남력, 이해력, 집중력, 실행기능, 공격성 등' },
  { key: 'emotion', label: '정서', hint: '외로움, 우울감, 불안, 무기력 등' },
  { key: 'nutrition', label: '영양·배변·배뇨', hint: '식사량, 수분섭취, 연하곤란, 변비, 설사, 실금 등' },
  { key: 'rehab', label: '운동·재활', hint: '보행상태, 하지 근력, 관절 구축 등' },
  { key: 'safety', label: '안전', hint: '낙상 위험, 미끄럼, 배회 등' },
] as const
export type StateChangeCheckKey = typeof STATE_CHANGE_CHECKS[number]['key']
export const STATE_CHANGE_WEEKS = 5
export interface StateChangeWeek {
  date: string
  checks: Record<StateChangeCheckKey, boolean>
  remarks: string
  result: string
}
export interface StateChangeRecord {
  v: 1
  weeks: StateChangeWeek[]
  etc: string
}

function blankWeek(): StateChangeWeek {
  return { date: '', checks: { body: false, cognition: false, emotion: false, nutrition: false, rehab: false, safety: false }, remarks: '', result: '' }
}
export function emptyStateChange(): StateChangeRecord {
  return { v: 1, weeks: Array.from({ length: STATE_CHANGE_WEEKS }, blankWeek), etc: '' }
}
export function serializeStateChange(record: StateChangeRecord): string { return JSON.stringify(record) }

/** content가 이 서식의 JSON이면 복원하고, 예전 자유 텍스트이면 null. */
export function parseStateChange(content: string): StateChangeRecord | null {
  if (!content.trimStart().startsWith('{')) return null
  try {
    const raw = JSON.parse(content) as Partial<StateChangeRecord>
    if (raw.v !== 1 || !Array.isArray(raw.weeks)) return null
    const base = emptyStateChange()
    base.weeks = base.weeks.map((blank, i) => {
      const w = raw.weeks![i]
      if (!w || typeof w !== 'object') return blank
      const checks = { ...blank.checks }
      for (const { key } of STATE_CHANGE_CHECKS) checks[key] = w.checks?.[key] === true
      return { date: typeof w.date === 'string' ? w.date : '', checks, remarks: typeof w.remarks === 'string' ? w.remarks : '', result: typeof w.result === 'string' ? w.result : '' }
    })
    base.etc = typeof raw.etc === 'string' ? raw.etc : ''
    return base
  } catch { return null }
}

export function stateChangeWeekFilled(week: StateChangeWeek): boolean {
  return Boolean(week.date || week.remarks.trim() || week.result.trim() || Object.values(week.checks).some(Boolean))
}

function validServiceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 저장 전 점검: 비어 있는 서식, 기준월 밖의 날짜. */
export function stateChangeProblems(record: StateChangeRecord, period: string): string[] {
  const problems: string[] = []
  const filled = record.weeks.map((w, i) => ({ w, n: i + 1 })).filter(({ w }) => stateChangeWeekFilled(w))
  if (!filled.length) problems.push('주차별 내용을 한 주 이상 입력하세요.')
  for (const { w, n } of filled) {
    if (!w.date) problems.push(`${n}주차 서비스 일자를 입력하세요.`)
    else if (!validServiceDate(w.date)) problems.push(`${n}주차 서비스 일자가 올바른 날짜가 아닙니다.`)
    else if (w.date.slice(0, 7) !== period) problems.push(`${n}주차 일자가 기준월(${period})이 아닙니다.`)
    if (!w.remarks.trim() && !w.result.trim()) problems.push(`${n}주차 특이사항 또는 급여제공결과를 입력하세요.`)
  }
  return problems
}

/** 상세 보기·.txt 내려받기용 읽기 쉬운 본문. */
export function formatStateChangeText(record: StateChangeRecord): string {
  const lines: string[] = []
  record.weeks.forEach((w, i) => {
    if (!stateChangeWeekFilled(w)) return
    const checked = STATE_CHANGE_CHECKS.filter(c => w.checks[c.key]).map(c => c.label)
    lines.push(`[${i + 1}주차] ${w.date || '일자 미입력'}`, `상태변화 체크: ${checked.length ? checked.join(', ') : '해당 없음'}`,
      `특이사항 및 조치내용: ${w.remarks.trim() || '-'}`, `급여제공결과: ${w.result.trim() || '-'}`, '')
  })
  lines.push(`기타 사항: ${record.etc.trim() || '-'}`)
  return lines.join('\n')
}

// 방문요양 평가매뉴얼 24번 ④: '특이사항없음'·'양호함'·'지난주와 동일함' 같은 기록과 단순 급여제공내용만 쓴 기록은 불인정.
// 저장을 막지 않고 작성 중 경고만 한다(최종 판단은 작성자·관리자).
const VAGUE = /^(특이\s*사항\s*(은\s*)?(없음|없습니다|없음\.?)|양호(함|합니다)?|지난\s*주와?\s*동일(함|합니다)?|변화\s*없음|이상\s*없음)\.?$/
export function stateChangeQualityWarnings(record: StateChangeRecord): string[] {
  const warnings: string[] = []
  record.weeks.forEach((w, i) => {
    if (!stateChangeWeekFilled(w)) return
    const text = w.remarks.trim().replace(/\s+/g, ' ')
    if (VAGUE.test(text)) warnings.push(`${i + 1}주차 특이사항이 '${text}'뿐입니다. 평가에서 충실한 기록으로 인정되지 않을 수 있으니 관찰한 상태와 조치를 구체적으로 적으세요.`)
    else if (text.length > 0 && text.length < 15) warnings.push(`${i + 1}주차 특이사항이 짧습니다. 관찰한 상태와 조치를 구체적으로 적으세요.`)
    if (!text) warnings.push(`${i + 1}주차 특이사항 및 조치내용이 비어 있습니다.`)
  })
  return warnings
}
