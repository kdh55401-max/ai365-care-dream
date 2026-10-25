import type { IncomingMessage, ServerResponse } from 'node:http'
import { assignmentId, CenterAssignmentError } from '../../../shared/centerAssignments.js'
import { parseWeeklyPlanMutation, WeeklyPlanError } from '../../../shared/centerWeeklyPlanStore.js'
import { centerSession } from '../centerAuth.js'
import { assertCenterOrganizationReady } from '../centerDocumentStore.js'
import { loadWeeklyPlans, saveWeeklyPlan } from '../centerWeeklyPlanStore.js'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../http.js'
import { getSupabaseAdmin } from '../supabase.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST'); const actor = await centerSession(req)
    if (!actor || actor.status !== 'active' || !['admin', 'master'].includes(actor.role)) throw new ApiError(403, '승인된 기관 관리자만 계획에 접근할 수 있습니다.')
    if (req.method === 'POST' && req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new ApiError(403, '동일 출처에서 요청하세요.')
    let db: ReturnType<typeof getSupabaseAdmin>
    try { db = getSupabaseAdmin() } catch { throw new ApiError(503, '기관 서버 설정이 필요합니다.') }
    await assertCenterOrganizationReady(db, actor.organization_code)
    try {
      if (req.method === 'GET') sendJson(res, 200, { plans: await loadWeeklyPlans(db, actor.organization_code, assignmentId(new URL(req.url || '/', 'https://localhost').searchParams.get('patientId'))) })
      else sendJson(res, 200, await saveWeeklyPlan(db, actor.organization_code, actor.id, parseWeeklyPlanMutation(await readJsonBody(req))))
    } catch (error) { if (error instanceof WeeklyPlanError || error instanceof CenterAssignmentError) throw new ApiError(error.statusCode, error.message); throw error }
  })
}
