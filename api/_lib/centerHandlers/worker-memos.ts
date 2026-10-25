import type { IncomingMessage, ServerResponse } from 'node:http'
import { assignmentId } from '../../../shared/centerAssignments.js'
import { checkedWorkerMemoResult, parseWorkerMemoMutation, parseWorkerMemosState } from '../../../shared/centerWorkerMemos.js'
import { centerSession } from '../centerAuth.js'
import { assertCenterOrganizationReady } from '../centerDocumentStore.js'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../http.js'
import { getSupabaseAdmin } from '../supabase.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST'); const actor = await centerSession(req)
    if (!actor || actor.status !== 'active' || !['admin', 'master'].includes(actor.role)) throw new ApiError(403, '승인된 기관 관리자만 관리기록에 접근할 수 있습니다.')
    if (req.method === 'POST' && req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new ApiError(403, '동일 출처에서 요청하세요.')
    let db: ReturnType<typeof getSupabaseAdmin>
    try { db = getSupabaseAdmin() } catch { throw new ApiError(503, '센터 서버 설정이 필요합니다.') }
    await assertCenterOrganizationReady(db, actor.organization_code)
    let input, workerId
    try { if (req.method === 'POST') { input = parseWorkerMemoMutation(await readJsonBody(req)); workerId = input.workerId } else workerId = assignmentId(new URL(req.url || '/', 'https://localhost').searchParams.get('workerId')) } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : '관리기록 입력 오류') }
    const result = input ? await db.rpc('save_center_worker_memo', { p_organization_code: actor.organization_code, p_actor_id: actor.id, p_mutation: input }) : await db.rpc('inspect_center_worker_memo', { p_organization_code: actor.organization_code, p_worker_id: workerId })
    if (result.error) { const code = result.error.message?.match(/^CENTER_WORKER_MEMO_(400|403|404|409|503)\b/)?.[1]; throw new ApiError(code ? Number(code) : 503, code === '409' ? '관리기록이나 직원 상태가 변경되었습니다. 다시 조회하세요.' : '관리기록 저장소와 대상·입력값을 확인하세요.') }
    try { const data = input ? checkedWorkerMemoResult(result.data, input) : parseWorkerMemosState(result.data); const id = 'state' in data ? data.state.workerId : data.workerId; if (id !== workerId) throw new Error(); sendJson(res, 200, data) } catch { throw new ApiError(503, '관리기록 저장 응답 미확인 · 같은 요청으로 재시도하세요.') }
  })
}
