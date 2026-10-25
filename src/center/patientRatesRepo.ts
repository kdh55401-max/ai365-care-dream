import { checkedPatientRateResult, parsePatientRateMutation, parsePatientRatesState, type PatientRateMutation, type PatientRateResult, type PatientRatesState } from '../../shared/centerPatientRates'
import { assignmentId } from '../../shared/centerAssignments'
import type { CenterPerson } from '../../shared/centerOperations'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
export interface PatientRatesRepository { inspect(patientId: string): Promise<PatientRatesState>; save(input: PatientRateMutation): Promise<PatientRateResult> }
async function body(response: Response): Promise<unknown> { const data = await response.json(); if (!response.ok) throw new Error(data?.error || '부담률 이력 저장 실패'); return data }
export const serverPatientRatesRepository: PatientRatesRepository = {
  async inspect(patientId) { const id = assignmentId(patientId), result = parsePatientRatesState(await body(await fetch(`/api/center/patient-rates?patientId=${id}`, { credentials: 'same-origin' }))); if (result.patientId !== id) throw new Error('부담률 이력 대상 불일치'); return result },
  async save(value) { const input = parsePatientRateMutation(value); return checkedPatientRateResult(await body(await fetch('/api/center/patient-rates', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })), input) },
}
interface Ledger { states: Record<string, PatientRatesState>; receipts: Record<string, { payload: string; result: PatientRateResult }> }
export function createDemoPatientRatesRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): PatientRatesRepository {
  function read() {
    const data = JSON.parse(storage.getItem(DEMO_OPERATIONS_STORAGE_KEY) || '{}') as { people: CenterPerson[]; visits: unknown[]; requests: unknown; patientRatesState?: Ledger }
    if (!Array.isArray(data.people) || !Array.isArray(data.visits) || !data.requests || typeof data.requests !== 'object') throw new Error('시연 인물 자료 조회 실패')
    const ledger = data.patientRatesState ?? { states: {}, receipts: {} }
    if (!ledger.states || typeof ledger.states !== 'object' || Array.isArray(ledger.states) || !ledger.receipts || typeof ledger.receipts !== 'object' || Array.isArray(ledger.receipts)) throw new Error('부담률 이력 장부 손상 · 기존 자료 유지')
    return { data, ledger }
  }
  return {
    async inspect(patientId) { const id = assignmentId(patientId), { data, ledger } = read(); if (!data.people.some(p => p.id === id && p.kind === 'patient')) throw new Error('수급자를 찾지 못했습니다.'); const state = parsePatientRatesState(ledger.states[id] ?? { patientId: id, version: 0, entries: [] }); if (state.patientId !== id) throw new Error('부담률 이력 대상 불일치'); return structuredClone(state) },
    async save(value) {
      const input = parsePatientRateMutation(value), { data, ledger } = read(), payload = JSON.stringify(input), receipt = ledger.receipts[input.requestId]
      if (receipt) { if (receipt.payload !== payload) throw new Error('같은 요청 번호의 내용이 다릅니다.'); return structuredClone(checkedPatientRateResult(receipt.result, input)) }
      const person = data.people.find(p => p.id === input.patientId && p.kind === 'patient' && !p.archived)
      if (!person) throw new Error('활성 수급자를 찾지 못했습니다.')
      const state = parsePatientRatesState(ledger.states[input.patientId] ?? { patientId: input.patientId, version: 0, entries: [] })
      if (state.patientId !== input.patientId || state.version !== input.expectedVersion) throw new Error('부담률 이력이 변경되었습니다. 다시 조회하세요.')
      const id = input.action === 'save' ? input.rate.id : input.id, old = state.entries.find(e => e.id === id)
      if (old?.archived) throw new Error('보관된 부담률 이력은 수정할 수 없습니다.')
      if (input.action === 'save') {
        if (!old && state.entries.length >= 500) throw new Error('부담률 이력 저장 한도입니다.')
        if (state.entries.some(e => !e.archived && e.id !== id && e.effectiveDate === input.rate.effectiveDate)) throw new Error('같은 적용일 이력이 있습니다. 기존 이력을 수정하거나 보관하세요.')
        const entry = { ...input.rate, archived: false }; state.entries = old ? state.entries.map(e => e.id === id ? entry : e) : [...state.entries, entry]
      } else {
        if (!old) throw new Error('해당 부담률 이력을 찾지 못했습니다.')
        old.archived = true
      }
      state.version++; const result = checkedPatientRateResult({ state }, input)
      ledger.states[state.patientId] = state; ledger.receipts[input.requestId] = { payload, result }; data.patientRatesState = ledger
      storage.setItem(DEMO_OPERATIONS_STORAGE_KEY, JSON.stringify(data)); return structuredClone(result)
    },
  }
}
