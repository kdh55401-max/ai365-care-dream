import { describe, expect, it } from 'vitest'
import { emptyStateChange } from './centerStateChange.js'
import { checkedWeekReviewSaved, latestWeekReviews, parseWeekReviewInput, parseWeekReviewMutation, parseWeekReviewsMonth, sha256Hex, weekContentDigest, type StoredWeekReview, type WeekReviewInput } from './centerWeekReviews.js'

const uuid = () => crypto.randomUUID()
const digest = 'b'.repeat(64)
const entry = (patch: Partial<WeekReviewInput> = {}): WeekReviewInput => ({ id: uuid(), weekStart: '2026-10-05', value: 'same_as_usual', areas: [], note: '', digest, documentId: uuid(), batch: false, ...patch })
describe('주별 확인 기록 형식', () => {
  it('동기 SHA-256이 표준 값과 같다(빈 값·한글·긴 입력)', async () => {
    for (const text of ['', 'abc', '한글 상태변화 기록', 'x'.repeat(1000)]) expect(sha256Hex(text)).toBe([...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join(''))
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('기록 내용이 바뀌면 지문이 달라지고 같은 내용은 같다', () => {
    const [w] = emptyStateChange().weeks; const a = { ...w, date: '2026-10-06', remarks: '관찰', result: '지원' }
    expect(weekContentDigest([])).toBe(''); expect(weekContentDigest([a])).toMatch(/^[0-9a-f]{64}$/)
    expect(weekContentDigest([{ ...a, remarks: ' 관찰 ' }])).toBe(weekContentDigest([a])); expect(weekContentDigest([{ ...a, remarks: '다름' }])).not.toBe(weekContentDigest([a]))
    expect(weekContentDigest([{ ...a, checks: { ...a.checks, safety: true } }])).not.toBe(weekContentDigest([a]))
  })
  it('항목 검사: 값·영역·메모·지문 규칙', () => {
    expect(parseWeekReviewInput(entry({ value: 'changed', areas: ['body', 'safety'], note: '식사량 감소' })).areas).toEqual(['body', 'safety'])
    expect(parseWeekReviewInput(entry({ value: 'not_observed', digest: '', note: '입원' })).digest).toBe('')
    for (const bad of [{ value: 'changed', digest: '' }, { value: 'same_as_usual', digest: '' }, { areas: ['body'] }, { value: 'changed' as const, areas: ['body', 'body'] }, { value: 'changed' as const, areas: ['mind' as never] }, { note: 'x'.repeat(501) }, { digest: 'zz' }, { weekStart: '2026-02-30' }, { documentId: 'abc' }])
      expect(() => parseWeekReviewInput(entry(bad as Partial<WeekReviewInput>))).toThrow()
    expect(() => parseWeekReviewInput({ ...entry(), extra: 1 })).toThrow(); expect(() => parseWeekReviewInput({ ...entry(), reviewer: 'x' })).toThrow()
  })
  it('요청: 1~6개, 번호 중복 없음', () => {
    const base = { requestId: uuid(), patientId: uuid(), expectedVersion: 0 }
    expect(parseWeekReviewMutation({ ...base, entries: [entry()] }).entries).toHaveLength(1)
    expect(() => parseWeekReviewMutation({ ...base, entries: [] })).toThrow(); expect(() => parseWeekReviewMutation({ ...base, entries: Array.from({ length: 7 }, () => entry()) })).toThrow()
    const same = entry(); expect(() => parseWeekReviewMutation({ ...base, entries: [same, same] })).toThrow(); expect(() => parseWeekReviewMutation({ ...base, entries: [entry()], extra: 1 })).toThrow()
  })
  it('저장 응답이 요청과 다르면 거절하고 조회 결과는 월·환자·항목을 검사한다', () => {
    const input = parseWeekReviewMutation({ requestId: uuid(), patientId: uuid(), expectedVersion: 2, entries: [entry({ value: 'changed', areas: ['rehab'], note: '보행' })] })
    const stored = { ...input.entries[0], reviewer: 'admin', at: '2026-10-25T01:02:03Z' }
    expect(checkedWeekReviewSaved({ patientId: input.patientId, version: 3, saved: [stored] }, input).saved[0].reviewer).toBe('admin')
    expect(() => checkedWeekReviewSaved({ patientId: input.patientId, version: 2, saved: [stored] }, input)).toThrow()
    expect(() => checkedWeekReviewSaved({ patientId: input.patientId, version: 3, saved: [{ ...stored, note: '변조' }] }, input)).toThrow()
    expect(() => checkedWeekReviewSaved({ patientId: uuid(), version: 3, saved: [stored] }, input)).toThrow()
    const month = { month: '2026-10', patients: [{ patientId: input.patientId, version: 1, entries: [stored] }] }
    expect(parseWeekReviewsMonth(month).patients[0].entries).toHaveLength(1)
    expect(() => parseWeekReviewsMonth({ ...month, month: '2026-13' })).toThrow(); expect(() => parseWeekReviewsMonth({ ...month, patients: [{ ...month.patients[0], entries: [{ ...stored, at: 'now' }] }] })).toThrow()
  })
  it('같은 주를 다시 확인하면 나중 것이 유효하다', () => {
    const first = { ...entry(), reviewer: 'a', at: '2026-10-25T01:00:00Z' } as StoredWeekReview, second = { ...entry({ value: 'changed', areas: ['body'] }), reviewer: 'a', at: '2026-10-26T01:00:00Z' } as StoredWeekReview
    expect(latestWeekReviews([first, second]).get('2026-10-05')!.value).toBe('changed')
  })
})
