import type { StoredPatientMemo } from '../../shared/centerPatientMemos'
import { isCenterDate } from '../../shared/centerOperations'
export interface MemoFilter { year: string; month: string; day: string; query: string; includeArchived: boolean }
export function filterPatientMemos(entries: readonly StoredPatientMemo[], f: MemoFilter): StoredPatientMemo[] {
 const q = f.query.trim().toLocaleLowerCase()
 return entries.filter(e => (f.includeArchived || !e.archived) && (!f.year || e.date.slice(0, 4) === f.year) && (!f.month || e.date.slice(5, 7) === f.month) && (!f.day || e.date === f.day) && (!q || `${e.text} ${e.writer}`.toLocaleLowerCase().includes(q))).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
}
export function memoCalendar(month: string, entries: readonly StoredPatientMemo[]): { blanks: number; days: { date: string; count: number }[] } {
 if (!/^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('달력 월을 확인하세요.')
 const first = new Date(`${month}-01T00:00:00Z`), count = new Map<string, number>()
 for (const e of entries) if (e.date.startsWith(month + '-')) count.set(e.date, (count.get(e.date) ?? 0) + 1)
 const days = Array.from({ length: 31 }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter(isCenterDate).map(date => ({ date, count: count.get(date) ?? 0 }))
 return { blanks: first.getUTCDay(), days }
}
