import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCenterAssignment, type CenterAssignment, type CenterAssignmentMutation } from '../../shared/centerAssignments.js'
import { ApiError } from './http.js'
function storeError(error: { message?: string }): never {
  const code = error.message?.match(/^CENTER_ASSIGN_(400|403|404|409)\b/)?.[1]
  throw new ApiError(code ? Number(code) : 503, code === '409' ? '담당 배정이 변경되었습니다. 새로 조회한 뒤 다시 선택하세요.' : code === '400' ? '현재 기관의 활성 직원과 수급자를 선택하세요.' : code === '404' ? '해당 수급자를 찾지 못했습니다.' : code === '403' ? '현재 기관에서 담당 배정을 사용할 수 없습니다.' : '담당 배정 저장소가 준비되지 않았거나 응답하지 않습니다.')
}
export async function loadCenterAssignment(db: SupabaseClient, org: string, patientId: string): Promise<CenterAssignment> {
  const patient = await db.from('center_people').select('id').eq('organization_code', org).eq('id', patientId).eq('kind', 'patient').eq('archived', false).maybeSingle()
  if (patient.error) storeError(patient.error)
  if (!patient.data) throw new ApiError(404, '현재 기관의 활성 수급자를 찾지 못했습니다.')
  const { data, error } = await db.from('center_patient_assignments').select('patient_id,worker_ids,version').eq('organization_code', org).eq('patient_id', patientId).maybeSingle()
  if (error) storeError(error)
  try { return parseCenterAssignment(data ? { patientId: data.patient_id, workerIds: data.worker_ids, version: data.version } : { patientId, workerIds: [], version: 0 }) }
  catch { throw new ApiError(503, '담당 배정 응답을 확인하지 못했습니다.') }
}
export async function saveCenterAssignment(db: SupabaseClient, org: string, actorId: string, mutation: CenterAssignmentMutation): Promise<CenterAssignment> {
  const { data, error } = await db.rpc('save_center_assignment', { p_organization_code: org, p_actor_id: actorId, p_mutation: mutation })
  if (error) storeError(error)
  try {
    const assignment = parseCenterAssignment(data)
    if (assignment.patientId !== mutation.patientId || assignment.version !== mutation.expectedVersion + 1 || JSON.stringify(assignment.workerIds) !== JSON.stringify(mutation.workerIds)) throw new Error()
    return assignment
  } catch { throw new ApiError(503, '저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도하세요.') }
}
