import { parseApplicationResult, parseOrigins, parsePlanApplication, reviewPlanApplication, type PlanApplicationInput, type PlanApplicationResult, type PlanApplicationRow, type PlanVisitOrigin } from '../../shared/centerPlanApplication'
import { parseCenterOperationMutation, type CenterVisit } from '../../shared/centerOperations'
import { parseStoredWeeklyPlan, type StoredWeeklyPlan } from '../../shared/centerWeeklyPlanStore'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
import { readDemoWeeklyPlans } from './weeklyPlanStorage'
import { assertMonthlyScheduleEditable } from './monthlyScheduleStorage'
export interface PlanApplicationRepository { review(plan: StoredWeeklyPlan): Promise<PlanApplicationRow[]>; apply(input: PlanApplicationInput): Promise<PlanApplicationResult> }
async function body(response: Response): Promise<unknown> { const data = await response.json(); if (!response.ok) throw new Error(data?.error || '계획 반영 실패'); return data }
export const serverPlanApplicationRepository: PlanApplicationRepository = {
  async review(plan) {
    const data = await body(await fetch(`/api/center/plan-application?planId=${plan.id}`, { credentials: 'same-origin' })) as { plan: unknown; visits: CenterVisit[]; origins: unknown }
    const fresh = parseStoredWeeklyPlan(data.plan)
    if (fresh.id !== plan.id || fresh.version !== plan.version || JSON.stringify(fresh) !== JSON.stringify(plan)) throw new Error('계획이 변경되었습니다. 계획을 다시 조회하세요.')
    if (!Array.isArray(data.visits)) throw new Error('일정 목록 조회 실패')
    return reviewPlanApplication(fresh, data.visits, parseOrigins(data.origins))
  },
  async apply(value) { const input = parsePlanApplication(value); return parseApplicationResult(await body(await fetch('/api/center/plan-application', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })), input) },
}
type State = { origins: (PlanVisitOrigin & { planId: string })[]; requests: Record<string, { payload: string; result: PlanApplicationResult }> }
export function createDemoPlanApplicationRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): PlanApplicationRepository {
  function read() {
    const data = JSON.parse(storage.getItem(DEMO_OPERATIONS_STORAGE_KEY) || '{}') as { people: { id: string; kind: string; archived?: boolean }[]; visits: CenterVisit[]; requests: unknown; planApplicationState?: State; monthScheduleState?: unknown }
    if (!Array.isArray(data.people) || !Array.isArray(data.visits) || !data.requests || typeof data.requests !== 'object') throw new Error('시연 업무 저장소를 읽지 못했습니다.')
    const state = data.planApplicationState ?? { origins: [], requests: {} }
    if (!Array.isArray(state.origins) || !state.requests || typeof state.requests !== 'object') throw new Error('시연 반영 이력 손상 · 기존 자료 유지')
    for (const origin of state.origins) { parseOrigins([origin]); if (typeof origin.planId !== 'string') throw new Error('시연 반영 이력 손상') }
    return { data, state }
  }
  function planFor(id: string, version: number) {
    const plan = readDemoWeeklyPlans(storage).plans.find(p => p.id === id && !p.archived)
    if (!plan || plan.version !== version) throw new Error('계획이 변경·보관되었습니다. 다시 조회하세요.')
    return plan
  }
  function eligible(plan: StoredWeeklyPlan, people: { id: string; kind: string; archived?: boolean }[]) {
    if (!people.some(p => p.id === plan.patientId && p.kind === 'patient' && !p.archived) || !plan.entries.every(e => e.workerIds.every(id => people.some(p => p.id === id && p.kind === 'worker' && !p.archived)))) throw new Error('계획 대상·제공자가 현재 기관에 없습니다.')
  }
  return {
    async review(value) { const { data, state } = read(), plan = planFor(value.id, value.version); eligible(plan, data.people); return reviewPlanApplication(plan, data.visits, state.origins.filter(o => o.planId === plan.id)) },
    async apply(value) {
      const input = parsePlanApplication(value), { data, state } = read(), payload = JSON.stringify(input), receipt = state.requests[input.requestId]
      if (receipt) { if (receipt.payload !== payload) throw new Error('동일 요청 번호의 내용이 다릅니다.'); return structuredClone(parseApplicationResult(receipt.result, input)) }
      const plan = planFor(input.planId, input.expectedVersion); eligible(plan, data.people)
      const rows = reviewPlanApplication(plan, data.visits, state.origins.filter(o => o.planId === plan.id))
      if (rows.some(r => r.disposition === 'conflict')) throw new Error('수급자 또는 제공자의 일정이 겹칩니다. 아무 일정도 반영하지 않았습니다.')
      const visitIds: string[] = [], mapped = new Map<string, string>()
      for (const row of rows) {
        if (row.disposition === 'linked') continue
        let visitId = row.existingVisitId ? mapped.get(`${row.date}:${row.existingVisitId}`) ?? row.existingVisitId : crypto.randomUUID()
        if (row.disposition === 'create') {
          visitId = crypto.randomUUID()
          const mutation = parseCenterOperationMutation({ action: 'upsertVisit', requestId: input.requestId, expectedVersion: 0, visit: { id: visitId, date: row.date, time: row.time, workerId: row.workerIds[0], workerIds: row.workerIds, patientId: row.patientId, service: row.service, minutes: row.minutes } })
          if (mutation.action !== 'upsertVisit') throw new Error('일정 입력 오류')
          assertMonthlyScheduleEditable(data.monthScheduleState, undefined, mutation.visit); data.visits.push({ ...mutation.visit, version: 1, archived: false }); visitIds.push(visitId); mapped.set(`${row.date}:${row.sourceEntryId}`, visitId)
        }
        state.origins.push({ planId: plan.id, entryId: row.sourceEntryId, date: row.date, visitId })
      }
      const result = { planId: plan.id, planVersion: plan.version, createdCount: visitIds.length, skippedCount: rows.length - visitIds.length, visitIds }
      state.requests[input.requestId] = { payload, result }; data.planApplicationState = state
      // One atomic localStorage write: no partially created month on failure.
      storage.setItem(DEMO_OPERATIONS_STORAGE_KEY, JSON.stringify(data)); return structuredClone(result)
    },
  }
}
