import { DOMAIN_LABELS, type DomainEntry, type DomainKey, type DomainStatus, type StructuredReport } from './careTypes.js'

/** "특이사항 없음" 계열 발화를 감지해 평소와 비슷했어요 흐름으로 자동 연결하기 위한 패턴.
 * 규칙 기반(비-AI)이라 Gemini 키 없이도, 서버 왕복 없이도 항상 동작한다. */
const NO_CHANGE_PATTERNS = [
  '특이사항 없', '특이 사항 없', '별일 없', '별 일 없', '평소와 같', '평소랑 같',
  '평소와 비슷', '똑같', '괜찮았', '괜찮으셨', '이상 없', '다른 점 없', '다른 점이 없',
  '달라진 점 없', '달라진 점이 없', '문제 없었', '변화 없',
]

export function detectNoChangePhrase(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  return NO_CHANGE_PATTERNS.some((p) => t.includes(p.replace(/\s+/g, '')))
}

interface DomainRule {
  domain: DomainKey
  keywords: string[]
}

const DOMAIN_RULES: DomainRule[] = [
  { domain: 'meal_hydration', keywords: ['식사', '드시', '식욕', '수분', '물', '음식', '반찬'] },
  {
    domain: 'mobility_fall',
    keywords: ['이동', '걷', '걸음', '걸어', '걸으', '보행', '휘청', '낙상', '넘어지', '일어나', '어지럽', '어지러움', '현기증'],
  },
  { domain: 'excretion', keywords: ['배설', '대변', '소변', '화장실', '기저귀', '변'] },
  { domain: 'cognition_communication', keywords: ['대화', '말씀', '인지', '기억', '의사소통', '알아'] },
  { domain: 'emotion_behavior', keywords: ['기분', '정서', '짜증', '불안', '행동', '표정'] },
  { domain: 'pain_breathing', keywords: ['통증', '아프', '아팠', '호흡', '숨', '기침'] },
  { domain: 'sleep', keywords: ['수면', '잠', '주무', '잠들'] },
  { domain: 'skin_hygiene', keywords: ['피부', '욕창', '위생', '씻', '목욕', '세면'] },
  { domain: 'medication', keywords: ['복약', '투약', '약'] },
]

const NOT_OBSERVED_CUES = ['확인 못', '확인하지 못', '확인 안', '못 봤', '안 봤', '보지 못']
const UNCERTAIN_CUES = ['모르겠', '잘 모르', '애매', '확실치 않', '확실하지 않']
// "낙상 없었어요"처럼 증상 단어와 부정 표현이 함께 나오면, 아래 CHANGED_CUES보다
// 먼저 검사해서 "증상이 없었다(=평소와 같다)"는 뜻으로 해석한다. 부정 표현이
// 없을 때만 증상 단어 자체가 변화 신호로 인정된다.
const NEGATION_CUES = ['없었', '없으', '없어', '아니었', '않았', '않으']
const CHANGED_CUES = [
  '변화', '달라', '줄었', '늘었', '불편', '안 좋', '나빠', '심해', '휘청', '넘어',
  // 언급 자체가 이례적인 증상/사고 단어 — 부정(NEGATION_CUES)이 없는 한 변화로 본다.
  '어지럽', '어지러움', '현기증', '낙상', '통증', '아프', '아팠', '욕창',
  // 사용자가 예시로 든 구체적 표현
  '절반', '못 드시', '못 드셨', '거의 못', '불안정', '비틀', '누락', '거르', '잊으',
]
const USUAL_CUES = ['평소', '같았', '같아', '비슷', '괜찮', '정상', '여느 때']

function windowAround(text: string, index: number, radius = 16): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius))
}

function classifyWindow(w: string): DomainStatus {
  if (NOT_OBSERVED_CUES.some((c) => w.includes(c))) return 'not_observed'
  if (UNCERTAIN_CUES.some((c) => w.includes(c))) return 'uncertain'
  if (NEGATION_CUES.some((c) => w.includes(c))) return 'same_as_usual'
  if (CHANGED_CUES.some((c) => w.includes(c))) return 'changed'
  if (USUAL_CUES.some((c) => w.includes(c))) return 'same_as_usual'
  // "평소와 비슷했어요" 흐름 안에서는 별다른 단서 없이 영역만 언급된 경우
  // 이어서 말한 맥락상 "평소와 같다"는 취지로 보되, 명시적 근거가 약하므로
  // 가장 보수적으로 same_as_usual로 둔다(단정적 이상 신호가 없기 때문).
  return 'same_as_usual'
}

/** 사용자가 실제로 말한 문장에서 영역별 상태를 추출한다. 언급되지 않은 영역은
 * 결과에 아예 포함하지 않는다(= not_mentioned를 임의로 same_as_usual로 바꾸지 않음). */
export function classifyDomainsFromText(text: string): DomainEntry[] {
  const entries: DomainEntry[] = []
  for (const rule of DOMAIN_RULES) {
    for (const kw of rule.keywords) {
      const idx = text.indexOf(kw)
      if (idx === -1) continue
      const status = classifyWindow(windowAround(text, idx))
      entries.push({ domain: rule.domain, status })
      break
    }
  }
  return entries
}

/** 여러 번의 발화(최초 입력 + 답변들)에서 나온 분류를 도메인 기준으로 합친다.
 * 같은 영역이 다시 언급되면 더 나중(최신) 발화의 분류로 덮어쓴다. */
export function mergeDomainEntries(...batches: DomainEntry[][]): DomainEntry[] {
  const byDomain = new Map<DomainKey, DomainStatus>()
  for (const batch of batches) {
    for (const e of batch) byDomain.set(e.domain, e.status)
  }
  return [...byDomain.entries()].map(([domain, status]) => ({ domain, status }))
}

/** information_added_count 계산: "질문한 횟수"가 아니라 "실제로 새로 발견한
 * 의미 있는 정보의 수"다. 흐름 시작 시점(initialEntries)에는 없었던 changed
 * 도메인만 센다 — "평소와 같아요"/"없어요" 같은 답변은 도메인이 언급돼도
 * same_as_usual로 분류되므로 여기 포함되지 않는다. */
export function computeInformationAddedCount(initialEntries: DomainEntry[], finalEntries: DomainEntry[]): number {
  const initialChangedDomains = new Set(initialEntries.filter((e) => e.status === 'changed').map((e) => e.domain))
  return finalEntries.filter((e) => e.status === 'changed' && !initialChangedDomains.has(e.domain)).length
}

export function splitDomainsByStatus(entries: DomainEntry[]) {
  return {
    same: entries.filter((e) => e.status === 'same_as_usual'),
    changed: entries.filter((e) => e.status === 'changed'),
    notObserved: entries.filter((e) => e.status === 'not_observed'),
    uncertain: entries.filter((e) => e.status === 'uncertain'),
  }
}

export const NO_CHANGE_QUESTION_1 =
  '오늘 직접 확인한 것 가운데 평소와 같았던 내용을 말씀해주세요. 예를 들어 식사, 이동, 배설, 인지·기분, 통증·호흡 등이 있습니다.'
export const NO_CHANGE_QUESTION_2 = '오늘 확인하지 못했거나 다음 방문에서 살펴볼 내용이 있나요?'

/** 첫 답변에 확인 항목(same/changed)과 미확인 항목(not_observed/uncertain)이 모두
 * 있으면 두 번째 질문을 생략한다. */
export function shouldSkipSecondQuestion(entriesSoFar: DomainEntry[]): boolean {
  const { same, changed, notObserved, uncertain } = splitDomainsByStatus(entriesSoFar)
  const hasConfirmed = same.length > 0 || changed.length > 0
  const hasUnconfirmed = notObserved.length > 0 || uncertain.length > 0
  return hasConfirmed && hasUnconfirmed
}

function joinLabels(entries: DomainEntry[]): string {
  return entries.map((e) => DOMAIN_LABELS[e.domain]).join('·')
}

/** "평소와 비슷했어요" 흐름의 최종 보고문을 만든다. AI 자유생성이 아니라 규칙 기반
 * 템플릿이라 사실을 지어낼 여지가 없다 — 실제로 분류된 도메인만 문장에 들어간다. */
export function buildNoChangeReport(entries: DomainEntry[]): StructuredReport {
  const { same, changed, notObserved, uncertain } = splitDomainsByStatus(entries)
  const unclear = [...notObserved, ...uncertain]

  if (same.length === 0 && changed.length === 0 && unclear.length === 0) {
    return {
      change: '금일 요양보호사가 별도 상태변화를 보고하지 않음. 구체적으로 확인된 관찰영역은 없음.',
      action: '특이사항이 없어 별도 조치 없음.',
      result: '확인되지 않음',
      escalation: '센터가 별도로 확인할 사항 없음. 다음 방문에서 일반 관찰을 지속함.',
    }
  }

  const sentences: string[] = []
  if (same.length > 0) sentences.push(`금일 ${joinLabels(same)} 상태는 평소와 유사한 것으로 관찰됨.`)
  if (changed.length > 0) sentences.push(`${joinLabels(changed)} 상태는 평소와 다르게 관찰됨.`)
  if (unclear.length > 0) sentences.push(`${joinLabels(unclear)} 상태는 이번 방문에서 확인하지 못함.`)
  sentences.push('그 밖의 뚜렷한 상태변화는 관찰되지 않음.')

  return {
    change: sentences.join(' '),
    action: '특이사항이 없어 별도 조치 없음.',
    result: same.length > 0 || changed.length > 0 ? '평소와 유사한 상태로 판단됨.' : '확인되지 않음',
    escalation:
      unclear.length > 0
        ? `다음 방문 시 ${joinLabels(unclear)} 상태 확인 필요.`
        : '센터가 별도로 확인할 사항 없음.',
  }
}
