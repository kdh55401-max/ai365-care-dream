import type { SupabaseClient } from '@supabase/supabase-js'
import { parseStoredWeeklyPlan, weeklyPlanFields, type StoredWeeklyPlan, type WeeklyPlanMutation } from '../../shared/centerWeeklyPlanStore.js'
import { ApiError } from './http.js'
function storeError(error: { message?: string }): never {
  const code = error.message?.match(/^CENTER_PLAN_(400|403|404|409)\b/)?.[1]
  throw new ApiError(code ? Number(code) : 503, code === '409' ? '계획이 변경·보관되었습니다. 다시 조회하세요.' : code === '400' ? '계획의 요일·시간 중복과 활성 제공자를 확인하세요.' : code === '404' ? '해당 계획을 찾지 못했습니다.' : code === '403' ? '현재 기관에서 계획을 사용할 수 없습니다.' : '주간 계획 저장소가 준비되지 않았거나 응답하지 않습니다.')
}
export async function loadWeeklyPlans(db: SupabaseClient, org: string, patientId: string): Promise<StoredWeeklyPlan[]> {
  const person = await db.from('center_people').select('id').eq('organization_code', org).eq('id', patientId).eq('kind', 'patient').eq('archived', false).maybeSingle()
  if (person.error) storeError(person.error)
  if (!person.data) throw new ApiError(404, '현재 기관의 활성 수급자를 찾지 못했습니다.')
  const { data, error } = await db.from('center_weekly_plans').select('id,organization_code,patient_id,month,note,entries,version,archived').eq('organization_code', org).eq('patient_id', patientId).eq('archived', false).order('updated_at', { ascending: false }).order('id').range(0, 500)
  if (error) storeError(error)
  if (!Array.isArray(data) || data.length > 500) throw new ApiError(503, '계획 목록을 모두 조회하지 못했습니다.')
  try { return data.map(row => { if (row.organization_code !== org || row.patient_id !== patientId) throw new Error(); return parseStoredWeeklyPlan({ ...row, patientId: row.patient_id }) }) }
  catch { throw new ApiError(503, '계획 목록의 대상과 형식을 확인하지 못했습니다.') }
}
export async function saveWeeklyPlan(db: SupabaseClient, org: string, actor: string, mutation: WeeklyPlanMutation): Promise<StoredWeeklyPlan> {
  const { data, error } = await db.rpc('save_center_weekly_plan', { p_organization_code: org, p_actor_id: actor, p_mutation: mutation })
  if (error) storeError(error)
  try { const plan = parseStoredWeeklyPlan(data); if (plan.id !== (mutation.action === 'save' ? mutation.plan.id : mutation.id) || plan.version !== mutation.expectedVersion + 1 || plan.archived !== (mutation.action === 'archive') || (mutation.action === 'save' && JSON.stringify(weeklyPlanFields(plan)) !== JSON.stringify(weeklyPlanFields(mutation.plan)))) throw new Error(); return plan }
  catch { throw new ApiError(503, '계획 저장 응답을 확인하지 못했습니다. 같은 내용으로 재시도하세요.') }
}
