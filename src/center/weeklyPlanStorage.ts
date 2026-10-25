import { parseStoredWeeklyPlan, type StoredWeeklyPlan } from '../../shared/centerWeeklyPlanStore'
export const DEMO_WEEKLY_PLANS_KEY = 'gadream365:center-weekly-plans:demo:v1'
export interface DemoWeeklyPlanLedger { plans: StoredWeeklyPlan[]; receipts: Record<string, { payload: string; result: StoredWeeklyPlan }> }
export function readDemoWeeklyPlans(storage: Pick<Storage, 'getItem'>): DemoWeeklyPlanLedger {
  const raw = storage.getItem(DEMO_WEEKLY_PLANS_KEY)
  if (!raw) return { plans: [], receipts: {} }
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value.plans) || !value.receipts || typeof value.receipts !== 'object' || Array.isArray(value.receipts)) throw new Error()
    const plans = value.plans.map(parseStoredWeeklyPlan)
    if (new Set(plans.map((p: StoredWeeklyPlan) => p.id)).size !== plans.length) throw new Error()
    return { plans, receipts: value.receipts }
  } catch { throw new Error('시연 주간 계획을 읽지 못했습니다. 기존 자료는 유지됩니다.') }
}
export function hasDemoWeeklyPlanReference(storage: Pick<Storage, 'getItem'>, id: string): boolean {
  return readDemoWeeklyPlans(storage).plans.some(plan => !plan.archived && plan.entries.length && (plan.patientId === id || plan.entries.some(entry => entry.workerIds.includes(id))))
}
