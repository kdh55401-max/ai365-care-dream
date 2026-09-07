import { describe, expect, it } from 'vitest'
import { extractCaregiverNote } from './caregiverNote.js'

describe('extractCaregiverNote — 대표 사례', () => {
  it('"어르신이 계속 거절하셔서 오늘 너무 힘들었어요." → 요양보호사 경험(caregiverNote)으로 보존', () => {
    const note = extractCaregiverNote('어르신이 계속 거절하셔서 오늘 너무 힘들었어요.')
    expect(note).not.toBe('')
    expect(note).toContain('힘들었어요')
  })

  it('"특이사항은 없는데 너무 지쳐요." → caregiverNote로 보존(주어 생략)', () => {
    const note = extractCaregiverNote('특이사항은 없는데 너무 지쳐요.')
    expect(note).not.toBe('')
    expect(note).toContain('지쳐요')
  })

  it('"어르신이 걷기 힘들어하셨어요." → 어르신 관찰 사실이므로 caregiverNote 아님(존댓말 활용형)', () => {
    expect(extractCaregiverNote('어르신이 걷기 힘들어하셨어요.')).toBe('')
  })

  it('"제가 보기에는 어르신이 많이 지쳐 보였어요." → 관찰 대상이 어르신이므로 caregiverNote 아님', () => {
    expect(extractCaregiverNote('제가 보기에는 어르신이 많이 지쳐 보였어요.')).toBe('')
  })

  it('"제가 힘들다고 말씀드리니 어르신이 도와주셨어요." → 앞 절(본인 경험)만 caregiverNote로', () => {
    const note = extractCaregiverNote('제가 힘들다고 말씀드리니 어르신이 도와주셨어요.')
    expect(note).not.toBe('')
    expect(note).toContain('힘들다고')
    expect(note).not.toContain('도와주셨어요')
  })

  it('지원요청 표현은 항상 caregiverNote로', () => {
    expect(extractCaregiverNote('오늘은 정말 도와주세요.')).not.toBe('')
  })

  it('아무 단서가 없으면 빈 문자열', () => {
    expect(extractCaregiverNote('오늘 점심을 잘 드셨어요.')).toBe('')
  })

  it('빈 입력은 빈 문자열', () => {
    expect(extractCaregiverNote('')).toBe('')
  })

  it('같은 문장을 여러 번 넘겨도(재계산) 중복 누적되지 않는다 — 순수함수라 항상 같은 결과', () => {
    const text = '어르신이 계속 거절하셔서 오늘 너무 힘들었어요.'
    const first = extractCaregiverNote(text)
    const second = extractCaregiverNote(text)
    expect(first).toBe(second)
  })
})
