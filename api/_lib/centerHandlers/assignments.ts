import type { IncomingMessage, ServerResponse } from 'node:http'
import { assignmentId, CenterAssignmentError, parseCenterAssignmentMutation } from '../../../shared/centerAssignments.js'
import { centerSession } from '../centerAuth.js'
import { assertCenterOrganizationReady } from '../centerDocumentStore.js'
import { loadCenterAssignment, saveCenterAssignment } from '../centerAssignmentStore.js'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../http.js'
import { getSupabaseAdmin } from '../supabase.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST')
    const actor = await centerSession(req)
    if (!actor || actor.status !== 'active' || !['admin', 'master'].includes(actor.role)) throw new ApiError(403, '승인된 기관 관리자만 담당 배정을 변경할 수 있습니다.')
    if (req.method === 'POST' && req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new ApiError(403, '동일 출처에서 요청하세요.')
    let db: ReturnType<typeof getSupabaseAdmin>
    try { db = getSupabaseAdmin() } catch { throw new ApiError(503, '기관 업무 서버 설정이 필요합니다.') }
    await assertCenterOrganizationReady(db, actor.organization_code)
    try {
      if (req.method === 'GET') {
        const patientId = assignmentId(new URL(req.url || '/', 'https://localhost').searchParams.get('patientId'))
        sendJson(res, 200, await loadCenterAssignment(db, actor.organization_code, patientId))
      } else sendJson(res, 200, await saveCenterAssignment(db, actor.organization_code, actor.id, parseCenterAssignmentMutation(await readJsonBody(req))))
    } catch (error) { if (error instanceof CenterAssignmentError) throw new ApiError(error.statusCode, error.message); throw error }
  })
}
