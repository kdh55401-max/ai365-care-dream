import { DOMAIN_LABELS, type DomainEntry, type DomainKey, type DomainStatus, type StructuredReport } from './careTypes.js'
import { extractCaregiverNote } from './caregiverNote.js'

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
  {
    // '묶음은 UI 분류이며 하위 관찰의 증거가 아니다'(설계 검토 결정 D1) — 식사와
    // 수분을 하나의 도메인으로 합치면 "식사는 평소와 같음, 수분은 관찰 못함"처럼
    // 상태가 엇갈릴 때 한쪽이 다른 쪽에 덮여 사라진다. 반드시 분리해서 둔다.
    domain: 'meal',
    // '드시'는 "드셨다/드신다"의 활용형(드셨,드신,드셔)에서 어간이 바뀌어(ㅣ+었→ㅕㅆ)
    // 부분 문자열로 안 걸리므로 활용형을 따로 추가한다. '밥'도 구어체로 자주 쓰인다.
    keywords: ['식사', '드시', '드셨', '드신', '드셔', '식욕', '음식', '반찬', '밥'],
  },
  { domain: 'hydration', keywords: ['수분', '물'] },
  {
    // 이동(보행 자체)과 낙상(사고·위험 신호)도 같은 이유로 분리한다 — "이동은
    // 평소와 같음"이라는 응답만으로 "낙상 없음"까지 확인된 것은 아니다.
    domain: 'mobility',
    keywords: ['이동', '걷', '걸음', '걸어', '걸으', '보행', '일어나'],
  },
  {
    domain: 'fall',
    // '넘어지'의 활용형(넘어질,넘어졌)도 어간 변화로 부분 문자열 매칭이 안 되므로 추가.
    // 휘청/어지럼/현기증은 낙상 위험 신호로 다룬다.
    keywords: ['낙상', '넘어지', '넘어질', '넘어졌', '휘청', '어지럽', '어지러움', '현기증'],
  },
  { domain: 'excretion', keywords: ['배설', '대변', '소변', '화장실', '기저귀', '변'] },
  { domain: 'cognition_communication', keywords: ['대화', '말씀', '인지', '기억', '의사소통', '알아'] },
  { domain: 'emotion_behavior', keywords: ['기분', '정서', '짜증', '불안', '행동', '표정'] },
  { domain: 'pain_breathing', keywords: ['통증', '아프', '아팠', '호흡', '숨', '기침'] },
  { domain: 'sleep', keywords: ['수면', '잠', '주무', '잠들'] },
  { domain: 'skin_hygiene', keywords: ['피부', '욕창', '위생', '씻', '목욕', '세면'] },
  { domain: 'medication', keywords: ['복약', '투약', '약'] },
]

// '관찰'은 '확인'과 같은 뜻으로 요양보호사가 실제로 쓰는 동의어다(예: Codex
// 재현 사례 "수분 섭취는 관찰하지 못했어요") — '확인' 계열만 두면 이 표현이
// 단서 미검출로 빠져 기본값(same_as_usual)으로 잘못 분류된다.
const NOT_OBSERVED_CUES = [
  '확인 못', '확인하지 못', '확인 안', '못 봤', '안 봤', '보지 못',
  '관찰 못', '관찰하지 못', '관찰 안',
]
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
  '절반', '못 드시', '못 드셨', '안 드시', '안 드셨', '거의 못', '거의 안', '불안정', '비틀', '누락', '거르', '잊으',
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

/** information_added_count 계산: "질문한 횟수"가 아니라 "흐름 시작 시점에는
 * changed로 분류되지 않았던 도메인이 새로 changed로 바뀐 개수"다. 이것이 이 값의
 * 정확한 범위이며, "새로 확보된 모든 세부정보의 양"을 재는 값이 아니다 — 예를 들어
 * 이미 changed로 분류된 도메인(예: 식사)에 대해 후속 답변에서 "한 공기에서 반
 * 공기로 줄었어요"처럼 더 구체적인 세부사실이 추가돼도, 그 도메인은 이미
 * initialEntries에서 changed였으므로 이 카운트는 늘지 않는다. 그 세부사실 자체는
 * 사라지지 않고 followup_answers에 원문 그대로 남는다 — 다만 이 숫자에는 반영되지
 * 않는다는 뜻이다. 과거 데이터 호환을 위해 이 공식 자체는 바꾸지 않는다. */
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

/** 1번 질문("오늘 직접 확인한 것 가운데 평소와 같았던 내용을 말씀해주세요")은 이미
 * 최초 발화에서 도메인이 하나라도 분류됐다면(확인이든 미확인이든) 방금 한 말을
 * 그대로 되묻는 것과 같다 — 설계 검토 결정 D2("이미 답한 질문은 반복하지 않는다").
 * 이 경우 1번 질문을 건너뛰고 바로 2번 질문(확인하지 못한 것)으로 넘어간다. */
export function shouldSkipFirstQuestion(entriesSoFar: DomainEntry[]): boolean {
  return entriesSoFar.length > 0
}

function joinLabels(entries: DomainEntry[]): string {
  return entries.map((e) => DOMAIN_LABELS[e.domain]).join('·')
}

/** "평소와 비슷했어요" 흐름의 최종 보고문을 만든다. AI 자유생성이 아니라 규칙 기반
 * 템플릿이라 사실을 지어낼 여지가 없다 — 실제로 분류된 도메인만 문장에 들어간다.
 *
 * rawTexts: 이 흐름에서 실제로 오간 원문들(최초 입력 + 각 답변). 어르신은
 * 특이사항이 없어도 요양보호사 본인이 힘들거나 지원이 필요하다고 말했을 수 있으므로
 * "특이사항없음 흐름은 어려움 호소를 다루지 않는다"고 가정하지 않고, 여기서도
 * extractCaregiverNote로 항상 확인한다(무조건 빈 문자열로 두지 않음). */
export function buildNoChangeReport(entries: DomainEntry[], rawTexts: string[] = []): StructuredReport {
  const { same, changed, notObserved, uncertain } = splitDomainsByStatus(entries)
  const unclear = [...notObserved, ...uncertain]
  const caregiverNote = extractCaregiverNote(rawTexts.join(' '))

  // 이 흐름은 "어떤 조치를 했는지"를 따로 묻지 않는다 — 묻지 않은 것을 "조치
  // 없음"으로 단정하지 않고 미응답으로 남긴다(설계 검토 결정 D4.4).
  const action = '조치 내용은 미응답.'
  // "센터가 확인할 사항이 있는지"는 관리자가 검토해 판단할 몫이지, 요양보호사의
  // 응답 유무로 이 화면이 대신 "확인할 사항 없음"을 단정하지 않는다(D4.4).
  const reviewPending = '센터의 추가 확인 필요 여부는 아직 검토되지 않음.'
  const escalation = unclear.length > 0 ? `다음 방문 시 ${joinLabels(unclear)} 상태 확인 필요. ${reviewPending}` : reviewPending

  if (same.length === 0 && changed.length === 0 && unclear.length === 0) {
    return {
      change: '금일 요양보호사가 구체적인 관찰영역을 언급하지 않음. 확인된 관찰영역 없음.',
      action,
      result: '확인되지 않음',
      escalation,
      caregiverNote,
    }
  }

  // 언급된 영역에 대한 사실만 문장으로 남긴다. "그 밖의 뚜렷한 변화는 관찰되지
  // 않음"처럼 확인 범위를 넓히는 문장은 붙이지 않는다(설계 검토 결정 D1.5) —
  // 언급되지 않은 영역은 애초에 entries에 없으므로 이 함수가 알 수 없는 사실이다.
  const sentences: string[] = []
  if (same.length > 0) sentences.push(`${joinLabels(same)} 상태는 평소와 같다고 보고함.`)
  if (changed.length > 0) sentences.push(`${joinLabels(changed)} 상태는 평소와 다르다고 보고함.`)
  // not_observed(관찰 자체를 못함)와 uncertain(관찰은 했으나 확실하지 않음)은 서로
  // 다른 사실이다 — 둘 다 "관찰하지 못했다"로 뭉뚱그리면 "잘 모르겠어요"처럼 실제로는
  // 보긴 했으나 확신이 없다는 답변까지 아예 못 본 것으로 왜곡된다.
  if (notObserved.length > 0) sentences.push(`${joinLabels(notObserved)} 상태는 이번 방문에서 관찰하지 못했다고 보고함.`)
  if (uncertain.length > 0) sentences.push(`${joinLabels(uncertain)} 상태는 확실하지 않다고 보고함.`)

  return {
    change: sentences.join(' '),
    action,
    result: same.length > 0 || changed.length > 0 ? '언급된 영역은 평소와 유사하다고 보고됨.' : '확인되지 않음',
    escalation,
    caregiverNote,
  }
}
