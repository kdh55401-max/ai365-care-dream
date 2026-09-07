/** 응급 신호 즉시감지 — 옛 src/triage.ts의 정규식 5종을 그대로 포팅했다.
 *
 * 주의(과장 금지): 이것은 임상적으로 검증된 응급 판정 기준이 아니다. 문장에 특정
 * 표현이 포함됐는지만 보는 규칙 기반 필터로, 나머지 절차(추가질문)를 건너뛰고
 * 119/센터 연락 화면을 먼저 보여줄지 정하는 용도로만 쓴다. 과거시제나 타인의
 * 말을 인용한 문장("교육 때 배웠는데 의식이 없으면...")을 완벽히 걸러내지 못한다 —
 * 알려진 한계다.
 *
 * 부정문 오탐 완화: "매치 뒤 N글자"가 아니라 매치가 일어난 절(clause) 안에서만
 * 부정 단서를 찾는다. 문장을 마침표/느낌표/물음표/쉼표 기준으로 절로 나눈 뒤,
 * 매치된 절 자체에 부정 단서가 있을 때만 무효화한다 — 다른 절의 부정이 엉뚱하게
 * 영향을 주지 않는다.
 */

const EMERGENCY_PATTERNS: RegExp[] = [
  /반응이?\s*없|불러도\s*반응|의식이?\s*없|의식[\s\S]{0,4}저하/,
  /숨(을)?\s*(잘\s*)?(못\s*쉬|쉬지\s*않)|호흡\s*곤란|숨이?\s*가빠|숨\s*쉬기\s*힘들/,
  /한쪽\s*(팔|다리|손|발)[\s\S]{0,10}(힘이?\s*없|저하|마비|움직이지\s*않|움직임)/,
  /(안면|얼굴)[\s\S]{0,6}(비대칭|처짐|마비|돌아)|말이?\s*어눌|발음이?\s*어눌|발음[\s\S]{0,6}이상/,
  /(출혈|피)[\s\S]{0,10}(멈추지\s*않|안\s*멈추|계속)|심한\s*출혈/,
]

const NEGATION_CUES = ['없었', '없다고', '없었고', '아니었', '않았', '아니라고']

function splitClauses(text: string): string[] {
  return text
    .split(/[.!?]|,\s*(?:그리고|그런데|근데|하지만|그래도)?/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 응급 신호가 감지되면 true. 매치된 절 안에 부정 단서가 함께 있으면(같은 절
 * 안에서만 확인 — 다른 절의 부정은 영향 없음) 무효화한다. */
export function detectEmergencyPhrase(text: string): boolean {
  if (!text) return false
  const clauses = splitClauses(text)
  const haystacks = clauses.length > 0 ? clauses : [text]
  for (const clause of haystacks) {
    for (const pattern of EMERGENCY_PATTERNS) {
      if (pattern.test(clause) && !NEGATION_CUES.some((cue) => clause.includes(cue))) {
        return true
      }
    }
  }
  return false
}
