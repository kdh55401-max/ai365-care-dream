/** 요양보호사가 말/입력으로 "그만할게요"류 종료 의사를 표현했는지 감지한다.
 * 버튼("여기까지 말씀드릴게요")과 별도로, 자유발화 텍스트 안에 같은 의사가
 * 있으면 동일하게 존중한다. 어르신이 한 말을 인용한 문장("어르신이 '그만하자'고
 * 하셨어요")은 요양보호사 본인의 종료 요청이 아니므로 제외한다. */

const STOP_PATTERNS: RegExp[] = [
  /그만\s*할게요/,
  /그만\s*말할게요/,
  /그만\s*하겠습니다/,
  /그만할래요/,
  /여기까지\s*할게요/,
  /여기까지\s*말씀드릴게요/,
  /여기까지만\s*할게요/,
  /이만\s*됐어요/,
  /이제\s*그만할게요/,
]

// 어르신(3인칭)의 발화를 인용한 경우("어르신이 '그만하자'고 하셨어요") 제외하기
// 위한 인용 단서. 매치 지점 주변 창 안에 이 패턴이 있으면 종료요청으로 보지 않는다.
const QUOTED_ELDER_SPEECH = /(어르신|그분|할머니|할아버지)[\s\S]{0,12}(라고|하고)[\s\S]{0,8}(하셨|말씀하셨|하시)/

export function detectStopRequest(text: string): boolean {
  if (!text) return false
  for (const pattern of STOP_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    // 인용 표지는 한국어에서 보통 인용된 말 "뒤"에 붙는다("...라고 하셨어요")
    // 그리고 인용 주체(어르신 등)는 앞에 나오는 경우가 많으므로, 매치 앞뒤 모두
    // 넉넉히 살펴본다.
    const windowStart = Math.max(0, match.index - 20)
    const windowEnd = Math.min(text.length, match.index + match[0].length + 20)
    const window = text.slice(windowStart, windowEnd)
    if (QUOTED_ELDER_SPEECH.test(window)) continue
    return true
  }
  return false
}
