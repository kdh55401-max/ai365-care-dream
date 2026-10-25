import { checkedPatientContractResult, parsePatientContractMutation, parsePatientContractsState, type PatientContractMutation, type PatientContractResult, type PatientContractsState } from '../../shared/centerPatientContracts'
import { assignmentId } from '../../shared/centerAssignments'
import type { CenterPerson } from '../../shared/centerOperations'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
export interface PatientContractsRepository { inspect(patientId: string): Promise<PatientContractsState>; save(input: PatientContractMutation): Promise<PatientContractResult> }
async function body(response: Response): Promise<unknown> { const data = await response.json(); if (!response.ok) throw new Error(data?.error || '계약이력 저장 실패'); return data }
export const serverPatientContractsRepository: PatientContractsRepository = {
  async inspect(patientId) { const id = assignmentId(patientId), result = parsePatientContractsState(await body(await fetch(`/api/center/patient-contracts?patientId=${id}`, { credentials: 'same-origin' }))); if (result.patientId !== id) throw new Error('계약이력 대상 불일치'); return result },
  async save(value) { const input = parsePatientContractMutation(value); return checkedPatientContractResult(await body(await fetch('/api/center/patient-contracts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })), input) },
}
interface Ledger { states: Record<string, PatientContractsState>; receipts: Record<string, { payload: string; result: PatientContractResult }> }
export function createDemoPatientContractsRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): PatientContractsRepository {
  function read() {
    const data = JSON.parse(storage.getItem(DEMO_OPERATIONS_STORAGE_KEY) || '{}') as { people: CenterPerson[]; visits: unknown[]; requests: unknown; patientContractsState?: Ledger }
    if (!Array.isArray(data.people) || !Array.isArray(data.visits) || !data.requests || typeof data.requests !== 'object') throw new Error('시연 인물 자료 조회 실패')
    const ledger = data.patientContractsState ?? { states: {}, receipts: {} }
    if (!ledger.states || typeof ledger.states !== 'object' || Array.isArray(ledger.states) || !ledger.receipts || typeof ledger.receipts !== 'object' || Array.isArray(ledger.receipts)) throw new Error('계약이력 장부 손상 · 기존 자료 유지')
    return { data, ledger }
  }
  return {
    async inspect(patientId) { const id = assignmentId(patientId), { data, ledger } = read(); if (!data.people.some(p => p.id === id && p.kind === 'patient')) throw new Error('수급자를 찾지 못했습니다.'); const state = parsePatientContractsState(ledger.states[id] ?? { patientId: id, version: 0, activeId: null, entries: [] }); if (state.patientId !== id) throw new Error('계약이력 대상 불일치'); return structuredClone(state) },
    async save(value) {
      const input = parsePatientContractMutation(value), { data, ledger } = read(), payload = JSON.stringify(input), receipt = ledger.receipts[input.requestId]
      if (receipt) { if (receipt.payload !== payload) throw new Error('같은 요청 번호의 내용이 다릅니다.'); return structuredClone(checkedPatientContractResult(receipt.result, input)) }
      const person = data.people.find(p => p.id === input.patientId && p.kind === 'patient' && !p.archived)
      if (!person) throw new Error('활성 수급자를 찾지 못했습니다.')
      const state = parsePatientContractsState(ledger.states[input.patientId] ?? { patientId: input.patientId, version: 0, activeId: null, entries: [] })
      if (state.patientId !== input.patientId || state.version !== input.expectedVersion) throw new Error('계약이력이 변경되었습니다. 다시 조회하세요.')
      const id = input.action === 'save' ? input.contract.id : input.id, old = state.entries.find(e => e.id === id)
      if (old?.archived || (state.activeId === id && input.action !== 'apply')) throw new Error('적용중이거나 보관된 계약은 수정·보관할 수 없습니다.')
      let changed: CenterPerson | undefined
      if (input.action === 'save') {
        if (!old && state.entries.length >= 500) throw new Error('계약이력 저장 한도입니다.')
        const entry = { ...input.contract, archived: false }; state.entries = old ? state.entries.map(e => e.id === id ? entry : e) : [...state.entries, entry]
      } else {
        if (!old) throw new Error('해당 계약을 찾지 못했습니다.')
        if (input.action === 'archive') old.archived = true
        else {
          if (person.version !== input.expectedPersonVersion) throw new Error('수급자 기본정보가 변경되었습니다. 다시 조회하세요.')
          changed = { ...person, start: old.contractDate, end: old.periodEnd, version: input.expectedPersonVersion + 1, archived: false }; data.people = data.people.map(p => p.id === person.id ? changed! : p); state.activeId = id
        }
      }
      state.version++; const result = checkedPatientContractResult({ state, ...(changed ? { person: changed } : {}) }, input)
      ledger.states[state.patientId] = state; ledger.receipts[input.requestId] = { payload, result }; data.patientContractsState = ledger
      storage.setItem(DEMO_OPERATIONS_STORAGE_KEY, JSON.stringify(data)); return structuredClone(result)
    },
  }
}
