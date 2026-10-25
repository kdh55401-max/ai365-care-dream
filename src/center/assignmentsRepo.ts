import { assignmentId, parseCenterAssignment, parseCenterAssignmentMutation, type CenterAssignment, type CenterAssignmentMutation } from '../../shared/centerAssignments'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
import { DEMO_ASSIGNMENTS_KEY, readDemoAssignments } from './assignmentStorage'
export interface AssignmentsRepository { load(patientId: string): Promise<CenterAssignment>; save(input: CenterAssignmentMutation): Promise<CenterAssignment> }
async function body(response: Response): Promise<unknown> {
  let data: unknown
  try { data = await response.json() } catch { throw new Error('담당 배정 서버 응답을 확인하지 못했습니다.') }
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : '담당 배정 요청에 실패했습니다.')
  return data
}
function checked(value: unknown, patientId: string): CenterAssignment {
  const assignment = parseCenterAssignment(value)
  if (assignment.patientId !== patientId) throw new Error('담당 배정 대상이 다릅니다. 다시 조회하세요.')
  return assignment
}
export const serverAssignmentsRepository: AssignmentsRepository = {
  async load(patientId) { const id = assignmentId(patientId); return checked(await body(await fetch(`/api/center/assignments?patientId=${encodeURIComponent(id)}`, { credentials: 'same-origin' })), id) },
  async save(input) { const mutation = parseCenterAssignmentMutation(input); return checked(await body(await fetch('/api/center/assignments', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) })), mutation.patientId) },
}
export function createDemoAssignmentsRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): AssignmentsRepository {
  function activePeople() {
    try {
      const data = JSON.parse(storage.getItem(DEMO_OPERATIONS_STORAGE_KEY) || '{"people":[]}')
      if (!Array.isArray(data.people)) throw new Error()
      return data.people as { id: string; kind: string; archived?: boolean }[]
    } catch { throw new Error('시연 인물 자료를 읽지 못했습니다.') }
  }
  function patient(id: string) { if (!activePeople().some(p => p.id === id && p.kind === 'patient' && !p.archived)) throw new Error('활성 수급자를 찾지 못했습니다.') }
  return {
    async load(patientId) { const id = assignmentId(patientId); patient(id); return structuredClone(readDemoAssignments(storage).assignments.find(a => a.patientId === id) ?? { patientId: id, workerIds: [], version: 0 }) },
    async save(input) {
      const mutation = parseCenterAssignmentMutation(input), ledger = readDemoAssignments(storage), payload = JSON.stringify(mutation), previous = ledger.receipts[mutation.requestId]
      if (previous) { if (previous.input !== payload) throw new Error('같은 요청 번호의 배정 내용이 다릅니다.'); return structuredClone(checked(previous.result, mutation.patientId)) }
      patient(mutation.patientId)
      const old = ledger.assignments.find(a => a.patientId === mutation.patientId)
      if ((old?.version ?? 0) !== mutation.expectedVersion) throw new Error('담당 배정이 변경되었습니다. 새로 조회하세요.')
      const people = activePeople()
      if (!mutation.workerIds.every(id => people.some(p => p.id === id && p.kind === 'worker' && !p.archived))) throw new Error('현재 기관의 활성 직원을 선택하세요.')
      const result = { patientId: mutation.patientId, workerIds: mutation.workerIds, version: mutation.expectedVersion + 1 }
      ledger.assignments = [result, ...ledger.assignments.filter(a => a.patientId !== result.patientId)]
      ledger.receipts[mutation.requestId] = { input: payload, result }
      storage.setItem(DEMO_ASSIGNMENTS_KEY, JSON.stringify(ledger))
      return structuredClone(result)
    },
  }
}
