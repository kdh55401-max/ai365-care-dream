import { expect, it } from 'vitest'
import { filterPatientMemos, memoCalendar } from './patientMemoView'
const entries = [
 { id: 'a', date: '2024-02-29', text: '같은날 첫 기록', writer: '가상 담당자', archived: false },
 { id: 'b', date: '2024-02-29', text: '같은날 보관', writer: '다른 담당자', archived: true },
 { id: 'c', date: '2025-02-28', text: '다음해', writer: '가상 담당자', archived: false },
]
const all = { year: '', month: '', day: '', query: '', includeArchived: false }
it('연도·월·날짜·작성자 검색과 보관 조건을 함께 적용하며 원본을 바꾸지 않는다', () => {
 const before = JSON.stringify(entries)
 expect(filterPatientMemos(entries, { ...all, year: '2024', month: '02', day: '2024-02-29' }).map(e => e.id)).toEqual(['a'])
 expect(filterPatientMemos(entries, { ...all, query: ' 다른 담당자 ', includeArchived: true }).map(e => e.id)).toEqual(['b'])
 expect(filterPatientMemos(entries, { ...all, year: '2025', day: '2024-02-29' })).toEqual([])
 expect(JSON.stringify(entries)).toBe(before)
})
it('윤년·세기 경계·요일 정렬 및 동일 날짜 복수 건수를 유지한다', () => {
 expect(memoCalendar('2024-02', entries)).toMatchObject({ blanks: 4 }); expect(memoCalendar('2024-02', entries).days.at(-1)).toEqual({ date: '2024-02-29', count: 2 })
 expect(memoCalendar('1900-02', []).days).toHaveLength(28); expect(memoCalendar('2000-02', []).days).toHaveLength(29); expect(memoCalendar('2025-02', []).days).toHaveLength(28)
 for (const m of ['2026-13', '2026-00', '2200-01', '2026-2', '']) expect(() => memoCalendar(m, [])).toThrow()
})
