import { checkedWeekReviewSaved, parseWeekReviewMutation, parseWeekReviewsMonth, type PatientWeekReviews, type StoredWeekReview, type WeekReviewMutation, type WeekReviewSaved, type WeekReviewsMonth } from '../../shared/centerWeekReviews'
import type { CenterPerson } from '../../shared/centerOperations'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
export interface WeekReviewsRepository { inspectMonth(month: string): Promise<WeekReviewsMonth>; save(input: WeekReviewMutation): Promise<WeekReviewSaved> }
async function body(response: Response): Promise<unknown> { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error((data as { error?: string })?.error || '주별 확인 저장소를 사용할 수 없습니다.'); return data }
export const serverWeekReviewsRepository: WeekReviewsRepository = {
  async inspectMonth(month) { const result = parseWeekReviewsMonth(await body(await fetch(`/api/center/week-reviews?month=${encodeURIComponent(month)}`, { credentials: 'same-origin' }))); if (result.month !== month) throw new Error('주별 확인 조회 월 불일치'); return result },
  async save(value) { const input = parseWeekReviewMutation(value); return checkedWeekReviewSaved(await body(await fetch('/api/center/week-reviews', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })), input) },
}
interface Ledger { states: Record<string, PatientWeekReviews>; receipts: Record<string, { payload: string; result: WeekReviewSaved }> }
export function createDemoWeekReviewsRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): WeekReviewsRepository {
  function read() {
    const data = JSON.parse(storage.getItem(DEMO_OPERATIONS_STORAGE_KEY) || '{}') as { people: CenterPerson[]; visits: unknown[]; requests: unknown; weekReviewsState?: Ledger }
    if (!Array.isArray(data.people) || !Array.isArray(data.visits) || !data.requests || typeof data.requests !== 'object') throw new Error('시연 인물 자료 조회 실패')
    const ledger = data.weekReviewsState ?? { states: {}, receipts: {} }
    if (!ledger.states || typeof ledger.states !== 'object' || Array.isArray(ledger.states) || !ledger.receipts || typeof ledger.receipts !== 'object' || Array.isArray(ledger.receipts)) throw new Error('주별 확인 장부 손상 · 기존 자료 유지')
    return { data, ledger }
  }
  return {
    async inspectMonth(month) {
      const { ledger } = read()
      const patients = Object.values(ledger.states).map(s => ({ patientId: s.patientId, version: s.version, entries: s.entries.filter(e => e.weekStart.startsWith(month + '-')) })).sort((a, b) => a.patientId.localeCompare(b.patientId))
      return structuredClone(parseWeekReviewsMonth({ month, patients }))
    },
    async save(value) {
      const input = parseWeekReviewMutation(value), { data, ledger } = read(), payload = JSON.stringify(input), receipt = ledger.receipts[input.requestId]
      if (receipt) { if (receipt.payload !== payload) throw new Error('같은 요청 번호의 내용이 다릅니다.'); return structuredClone(checkedWeekReviewSaved(receipt.result, input)) }
      if (!data.people.some(p => p.id === input.patientId && p.kind === 'patient' && !p.archived)) throw new Error('활성 수급자를 찾지 못했습니다.')
      const state = ledger.states[input.patientId] ?? { patientId: input.patientId, version: 0, entries: [] as StoredWeekReview[] }
      if (state.version !== input.expectedVersion) throw new Error('주별 확인이 변경되었습니다. 다시 조회하세요.')
      if (input.entries.some(e => state.entries.some(old => old.id === e.id))) throw new Error('이미 저장된 확인 번호입니다.')
      if (state.entries.length + input.entries.length > 2000) throw new Error('주별 확인 저장 한도입니다.')
      const at = new Date().toISOString().slice(0, 19) + 'Z', saved = input.entries.map(e => ({ ...e, reviewer: '시연 관리자', at }))
      state.entries = [...state.entries, ...saved]; state.version++
      const result = checkedWeekReviewSaved({ patientId: state.patientId, version: state.version, saved }, input)
      ledger.states[state.patientId] = state; ledger.receipts[input.requestId] = { payload, result }; data.weekReviewsState = ledger
      storage.setItem(DEMO_OPERATIONS_STORAGE_KEY, JSON.stringify(data)); return structuredClone(result)
    },
  }
}
