import { assignmentId } from '../../shared/centerAssignments'
import { checkWeeklyPlanTransition, parseStoredWeeklyPlan, parseWeeklyPlanMutation, weeklyPlanFields, type StoredWeeklyPlan, type WeeklyPlanMutation } from '../../shared/centerWeeklyPlanStore'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
import { DEMO_WEEKLY_PLANS_KEY, readDemoWeeklyPlans } from './weeklyPlanStorage'
export interface WeeklyPlansRepository { list(patientId: string): Promise<StoredWeeklyPlan[]>; mutate(input: WeeklyPlanMutation): Promise<StoredWeeklyPlan> }
async function body(response: Response): Promise<unknown> {
  let data: unknown
  try { data = await response.json() } catch { throw new Error('계획 서버 응답을 확인하지 못했습니다.') }
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : '계획을 저장하지 못했습니다.')
  return data
}
function result(value: unknown, mutation: WeeklyPlanMutation): StoredWeeklyPlan {
  const plan = parseStoredWeeklyPlan(value)
  if (plan.id !== (mutation.action === 'save' ? mutation.plan.id : mutation.id) || plan.version !== mutation.expectedVersion + 1 || plan.archived !== (mutation.action === 'archive') || (mutation.action === 'save' && JSON.stringify(weeklyPlanFields(plan)) !== JSON.stringify(weeklyPlanFields(mutation.plan)))) throw new Error('계획 저장 응답이 요청과 다릅니다. 같은 내용으로 재시도하세요.')
  return plan
}
export const serverWeeklyPlansRepository: WeeklyPlansRepository = {
  async list(patientId) {
    const id = assignmentId(patientId), data = await body(await fetch(`/api/center/weekly-plans?patientId=${encodeURIComponent(id)}`, { credentials: 'same-origin' }))
    if (!data || typeof data !== 'object' || !('plans' in data) || !Array.isArray(data.plans)) throw new Error('계획 목록 형식이 올바르지 않습니다.')
    return data.plans.map(value => { const plan = parseStoredWeeklyPlan(value); if (plan.patientId !== id || plan.archived) throw new Error('계획 대상과 상태를 확인하세요.'); return plan })
  },
  async mutate(input) { const mutation = parseWeeklyPlanMutation(input); return result(await body(await fetch('/api/center/weekly-plans', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) })), mutation) },
}
export function createDemoWeeklyPlansRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): WeeklyPlansRepository {
  function people() {
    try { const data = JSON.parse(storage.getItem(DEMO_OPERATIONS_STORAGE_KEY) || '{"people":[]}'); if (!Array.isArray(data.people)) throw new Error(); return data.people as { id: string; kind: string; archived?: boolean }[] }
    catch { throw new Error('시연 인물 자료를 읽지 못했습니다.') }
  }
  function patient(id: string) { if (!people().some(p => p.id === id && p.kind === 'patient' && !p.archived)) throw new Error('활성 수급자를 선택하세요.') }
  return {
    async list(patientId) { const id = assignmentId(patientId); patient(id); return structuredClone(readDemoWeeklyPlans(storage).plans.filter(plan => plan.patientId === id && !plan.archived)) },
    async mutate(input) {
      const mutation = parseWeeklyPlanMutation(input), ledger = readDemoWeeklyPlans(storage), payload = JSON.stringify(mutation), receipt = ledger.receipts[mutation.requestId]
      if (receipt) { if (receipt.payload !== payload) throw new Error('같은 요청 번호의 계획 내용이 다릅니다.'); return structuredClone(result(receipt.result, mutation)) }
      const id = mutation.action === 'save' ? mutation.plan.id : mutation.id, old = ledger.plans.find(plan => plan.id === id)
      if ((old?.version ?? 0) !== mutation.expectedVersion || old?.archived) throw new Error('계획이 변경·보관되었습니다. 다시 조회하세요.')
      let saved: StoredWeeklyPlan
      if (mutation.action === 'archive') { if (!old) throw new Error('계획을 찾지 못했습니다.'); saved = { ...old, archived: true, version: old.version + 1 } }
      else {
        patient(mutation.plan.patientId); const staff = people()
        if (!mutation.plan.entries.every(entry => entry.workerIds.every(workerId => staff.some(p => p.id === workerId && p.kind === 'worker' && !p.archived)))) throw new Error('현재 기관의 활성 제공자를 선택하세요.')
        checkWeeklyPlanTransition(old, mutation.plan)
        saved = { ...mutation.plan, version: mutation.expectedVersion + 1, archived: false }
      }
      ledger.plans = [saved, ...ledger.plans.filter(plan => plan.id !== id)]; ledger.receipts[mutation.requestId] = { payload, result: saved }
      storage.setItem(DEMO_WEEKLY_PLANS_KEY, JSON.stringify(ledger)); return structuredClone(saved)
    },
  }
}
