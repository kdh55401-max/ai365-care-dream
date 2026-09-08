/** 요양보호사 본인이 표현한 어려움·지원요청을 어르신에 대한 관찰 사실과 분리해
 * 뽑아내는 규칙 기반 추출기. 정규식/키워드 휴리스틱이라 완벽하지 않다 — 애매한
 * 경우 임의로 버리거나 어르신 상태변화로 바꾸지 않고, 원문을 그대로 caregiverNote에
 * 보존한다("[주체 확인 필요]" 태그가 필요한 경우는 확인 화면에서 사람이 정정).
 *
 * 순수 함수: 호출할 때마다 주어진 전체 텍스트에서 새로 계산한다. 같은 발화를 여러
 * 번 넘겨도(재렌더 등) 누적되지 않는다 — 호출부가 "지금까지의 원문 전체"를 매번
 * 다시 넘기고 반환값으로 caregiverNote 필드를 덮어써야 한다(이어붙이면 안 됨).
 */

const REQUEST_KEYWORDS = ['도와주세요', '도와줬으면', '도와주셨으면', '지원해', '지원 부탁', '부탁드려요', '부탁드립니다', '부탁드려요']
// 활용형이 어간 축약으로 부분 문자열 매칭이 안 되는 경우(예: 지치다→지쳐/지쳤)를
// 대비해 실제 구어체에서 자주 쓰이는 형태를 추가로 등록한다(noChangeEngine.ts의
// 같은 문제 해결 방식과 동일).
const DIFFICULTY_KEYWORDS = ['힘들', '지치', '지쳐', '지쳤', '버거', '벅차']
const HONORIFIC_DIFFICULTY = ['힘드시', '힘드셨', '힘들어하시', '힘들어하셨', '지치시', '지치셨', '버거우시', '버거우셨', '벅차하시', '벅차하셨']
const THIRD_PERSON_SUBJECT = ['어르신이', '어르신은', '어르신께서', '그분이', '할머니가', '할아버지가']

// 원인/역접 연결어미 등 — 절 경계로 취급해 "A가 B해서 (내가) C했다"류 문장에서
// 앞 절의 3인칭 주어가 뒤 절의 어려움 표현까지 잘못 넘어오지 않게 한다. 주의:
// JS 정규식의 \b는 ASCII 기준이라 한글에는 적용되지 않으므로 "니"는 경계 없이
// 그냥 분리한다(과분할 위험이 있지만, 조각이 더 잘게 나뉠 뿐 분류 자체는 안전).
const CLAUSE_SEPARATORS = /[,.!?]|아서|어서|여서|해서|셔서|았어서|었어서|니까|으니까|는데|은데|지만|니/g

function splitFineClauses(text: string): string[] {
  return text
    .split(CLAUSE_SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean)
}

function containsAny(text: string, list: string[]): boolean {
  return list.some((kw) => text.includes(kw))
}

/** text 전체에서 요양보호사 본인의 어려움·지원요청 절만 뽑아 이어붙여 반환한다.
 * 아무것도 없으면 빈 문자열. */
export function extractCaregiverNote(text: string): string {
  if (!text) return ''
  const clauses = splitFineClauses(text)
  const found: string[] = []

  for (const clause of clauses) {
    // 1) 지원요청 표현은 항상 요양보호사 본인의 요청으로 본다.
    if (containsAny(clause, REQUEST_KEYWORDS)) {
      found.push(clause)
      continue
    }
    // 어려움 키워드가 없는 절은 볼 것이 없다.
    if (!containsAny(clause, DIFFICULTY_KEYWORDS)) continue
    // 2) 어르신을 높이는 존댓말 활용형("힘드셨어요" 등)이 붙었으면 어르신에 대한
    //    관찰 사실이다 — caregiverNote로 넣지 않는다.
    if (containsAny(clause, HONORIFIC_DIFFICULTY)) continue
    // 3) 같은(세분화된) 절 안에 3인칭 주어가 있으면 어르신에 대한 관찰로 본다
    //    (예: "제가 보기에는 어르신이 지쳐 보였어요"). 1인칭 단서가 함께 있어도
    //    관찰 대상이 어르신이면 관찰 사실 쪽을 우선한다.
    if (containsAny(clause, THIRD_PERSON_SUBJECT)) continue
    // 4) 나머지(1인칭 단서가 있거나, 주어가 아예 생략된 경우)는 요양보호사 본인의
    //    경험으로 본다. 한국어 구어 돌봄보고에서 주어 생략은 화자(요양보호사)
    //    자신을 가리키는 경우가 흔하다.
    found.push(clause)
  }

  // 같은 절이 중복으로 안 들어가게, 순서는 유지한 채 dedup.
  const seen = new Set<string>()
  const unique = found.filter((f) => {
    if (seen.has(f)) return false
    seen.add(f)
    return true
  })
  // 명백한 반복(예: "오늘 너무 힘들었어요"와 그 일부인 "너무 힘들었어요"가 같은
  // 발화 안에서 함께 잡히는 경우)은 더 긴 쪽만 남긴다. 새 내용을 만들어내는 게
  // 아니라 이미 포함된 부분 문자열만 제거하는 것이라 원문 손실이 없다 — 원문
  // 자체(raw_input/followup_answers)는 이 함수와 별개로 그대로 보존된다.
  const collapsed = unique.filter((seg, i) => !unique.some((other, j) => i !== j && other.length > seg.length && other.includes(seg)))
  return collapsed.join(' / ')
}
