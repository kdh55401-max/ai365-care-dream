import { checkedWorkerMemoResult, parseWorkerMemoMutation, parseWorkerMemosState, type WorkerMemoMutation, type WorkerMemoResult, type WorkerMemosState } from '../../shared/centerWorkerMemos'
import { assignmentId } from '../../shared/centerAssignments'
import type { CenterPerson } from '../../shared/centerOperations'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
export interface WorkerMemosRepository { inspect(workerId: string): Promise<WorkerMemosState>; save(input: WorkerMemoMutation): Promise<WorkerMemoResult> }
async function body(response: Response): Promise<unknown> { const data = await response.json(); if (!response.ok) throw new Error(data?.error || '관리기록 저장 실패'); return data }
export const serverWorkerMemosRepository: WorkerMemosRepository = {
  async inspect(workerId) { const id = assignmentId(workerId), result = parseWorkerMemosState(await body(await fetch(`/api/center/worker-memos?workerId=${id}`, { credentials: 'same-origin' }))); if (result.workerId !== id) throw new Error('관리기록 대상 불일치'); return result },
  async save(value) { const input = parseWorkerMemoMutation(value); return checkedWorkerMemoResult(await body(await fetch('/api/center/worker-memos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })), input) },
}
interface Ledger { states: Record<string, WorkerMemosState>; receipts: Record<string, { payload: string; result: WorkerMemoResult }> }
export function createDemoWorkerMemosRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): WorkerMemosRepository {
  function read() {
    const data = JSON.parse(storage.getItem(DEMO_OPERATIONS_STORAGE_KEY) || '{}') as { people: CenterPerson[]; visits: unknown[]; requests: unknown; workerMemosState?: Ledger }
    if (!Array.isArray(data.people) || !Array.isArray(data.visits) || !data.requests || typeof data.requests !== 'object') throw new Error('시연 인물 자료 조회 실패')
    const ledger = data.workerMemosState ?? { states: {}, receipts: {} }
    if (!ledger.states || typeof ledger.states !== 'object' || Array.isArray(ledger.states) || !ledger.receipts || typeof ledger.receipts !== 'object' || Array.isArray(ledger.receipts)) throw new Error('관리기록 장부 손상 · 기존 자료 유지')
    return { data, ledger }
  }
  return {
    async inspect(workerId) { const id = assignmentId(workerId), { data, ledger } = read(); if (!data.people.some(p => p.id === id && p.kind === 'worker')) throw new Error('직원를 찾지 못했습니다.'); const state = parseWorkerMemosState(ledger.states[id] ?? { workerId: id, version: 0, entries: [] }); if (state.workerId !== id) throw new Error('관리기록 대상 불일치'); return structuredClone(state) },
    async save(value) {
      const input = parseWorkerMemoMutation(value), { data, ledger } = read(), payload = JSON.stringify(input), receipt = ledger.receipts[input.requestId]
      if (receipt) { if (receipt.payload !== payload) throw new Error('같은 요청 번호의 내용이 다릅니다.'); return structuredClone(checkedWorkerMemoResult(receipt.result, input)) }
      const person = data.people.find(p => p.id === input.workerId && p.kind === 'worker' && !p.archived)
      if (!person) throw new Error('활성 직원를 찾지 못했습니다.')
      const state = parseWorkerMemosState(ledger.states[input.workerId] ?? { workerId: input.workerId, version: 0, entries: [] })
      if (state.workerId !== input.workerId || state.version !== input.expectedVersion) throw new Error('관리기록이 변경되었습니다. 다시 조회하세요.')
      const id = input.action === 'save' ? input.memo.id : input.id, old = state.entries.find(e => e.id === id)
      if (old?.archived) throw new Error('보관된 관리기록은 수정할 수 없습니다.')
      if (input.action === 'save') {
        if (!old && state.entries.length >= 500) throw new Error('관리기록 저장 한도입니다.')
        const entry = { ...input.memo, archived: false, writer: '시연 관리자' }; state.entries = old ? state.entries.map(e => e.id === id ? entry : e) : [...state.entries, entry]
      } else {
        if (!old) throw new Error('해당 관리기록을 찾지 못했습니다.')
        old.archived = true
      }
      state.version++; const result = checkedWorkerMemoResult({ state }, input)
      ledger.states[state.workerId] = state; ledger.receipts[input.requestId] = { payload, result }; data.workerMemosState = ledger
      storage.setItem(DEMO_OPERATIONS_STORAGE_KEY, JSON.stringify(data)); return structuredClone(result)
    },
  }
}
