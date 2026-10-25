import { checkedPatientRecognitionResult, parsePatientRecognitionMutation, parsePatientRecognitionsState, type PatientRecognitionMutation, type PatientRecognitionResult, type PatientRecognitionsState } from '../../shared/centerPatientRecognitions'
import { assignmentId } from '../../shared/centerAssignments'
import type { CenterPerson } from '../../shared/centerOperations'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
export interface PatientRecognitionsRepository { inspect(patientId: string): Promise<PatientRecognitionsState>; save(input: PatientRecognitionMutation): Promise<PatientRecognitionResult> }
async function body(response: Response): Promise<unknown> { const data = await response.json(); if (!response.ok) throw new Error(data?.error || '등급·인정이력 저장 실패'); return data }
export const serverPatientRecognitionsRepository: PatientRecognitionsRepository = {
  async inspect(patientId) { const id = assignmentId(patientId), result = parsePatientRecognitionsState(await body(await fetch(`/api/center/patient-recognitions?patientId=${id}`, { credentials: 'same-origin' }))); if (result.patientId !== id) throw new Error('등급·인정이력 대상 불일치'); return result },
  async save(value) { const input = parsePatientRecognitionMutation(value); return checkedPatientRecognitionResult(await body(await fetch('/api/center/patient-recognitions', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })), input) },
}
interface Ledger { states: Record<string, PatientRecognitionsState>; receipts: Record<string, { payload: string; result: PatientRecognitionResult }> }
export function createDemoPatientRecognitionsRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): PatientRecognitionsRepository {
  function read() {
    const data = JSON.parse(storage.getItem(DEMO_OPERATIONS_STORAGE_KEY) || '{}') as { people: CenterPerson[]; visits: unknown[]; requests: unknown; patientRecognitionsState?: Ledger }
    if (!Array.isArray(data.people) || !Array.isArray(data.visits) || !data.requests || typeof data.requests !== 'object') throw new Error('시연 인물 자료 조회 실패')
    const ledger = data.patientRecognitionsState ?? { states: {}, receipts: {} }
    if (!ledger.states || typeof ledger.states !== 'object' || Array.isArray(ledger.states) || !ledger.receipts || typeof ledger.receipts !== 'object' || Array.isArray(ledger.receipts)) throw new Error('등급·인정이력 장부 손상 · 기존 자료 유지')
    return { data, ledger }
  }
  return {
    async inspect(patientId) { const id = assignmentId(patientId), { data, ledger } = read(); if (!data.people.some(p => p.id === id && p.kind === 'patient')) throw new Error('수급자를 찾지 못했습니다.'); const state = parsePatientRecognitionsState(ledger.states[id] ?? { patientId: id, version: 0, activeId: null, entries: [] }); if (state.patientId !== id) throw new Error('등급·인정이력 대상 불일치'); return structuredClone(state) },
    async save(value) {
      const input = parsePatientRecognitionMutation(value), { data, ledger } = read(), payload = JSON.stringify(input), receipt = ledger.receipts[input.requestId]
      if (receipt) { if (receipt.payload !== payload) throw new Error('같은 요청 번호의 내용이 다릅니다.'); return structuredClone(checkedPatientRecognitionResult(receipt.result, input)) }
      const person = data.people.find(p => p.id === input.patientId && p.kind === 'patient' && !p.archived)
      if (!person) throw new Error('활성 수급자를 찾지 못했습니다.')
      const state = parsePatientRecognitionsState(ledger.states[input.patientId] ?? { patientId: input.patientId, version: 0, activeId: null, entries: [] })
      if (state.patientId !== input.patientId || state.version !== input.expectedVersion) throw new Error('등급·인정이력이 변경되었습니다. 다시 조회하세요.')
      const id = input.action === 'save' ? input.recognition.id : input.id, old = state.entries.find(e => e.id === id)
      if (old?.archived || (state.activeId === id && input.action !== 'apply')) throw new Error('적용중이거나 보관된 등급·인정은 수정·보관할 수 없습니다.')
      let changed: CenterPerson | undefined
      if (input.action === 'save') {
        if (!old && state.entries.length >= 500) throw new Error('등급·인정이력 저장 한도입니다.')
        const entry = { ...input.recognition, archived: false }; state.entries = old ? state.entries.map(e => e.id === id ? entry : e) : [...state.entries, entry]
      } else {
        if (!old) throw new Error('해당 등급·인정을 찾지 못했습니다.')
        if (input.action === 'archive') old.archived = true
        else {
          if (person.version !== input.expectedPersonVersion) throw new Error('수급자 기본정보가 변경되었습니다. 다시 조회하세요.')
          changed = { ...person, category: old.grade, version: input.expectedPersonVersion + 1, archived: false }; data.people = data.people.map(p => p.id === person.id ? changed! : p); state.activeId = id
        }
      }
      state.version++; const result = checkedPatientRecognitionResult({ state, ...(changed ? { person: changed } : {}) }, input)
      ledger.states[state.patientId] = state; ledger.receipts[input.requestId] = { payload, result }; data.patientRecognitionsState = ledger
      storage.setItem(DEMO_OPERATIONS_STORAGE_KEY, JSON.stringify(data)); return structuredClone(result)
    },
  }
}
