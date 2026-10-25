import type { IncomingMessage, ServerResponse } from 'node:http'
import { CenterDocumentError, parseCenterDocumentMutation } from '../../../shared/centerDocuments.js'
import { centerSession } from '../centerAuth.js'
import { assertCenterOrganizationReady, loadCenterDocuments, mutateCenterDocument } from '../centerDocumentStore.js'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../http.js'
import { getSupabaseAdmin } from '../supabase.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST')
    const actor = await centerSession(req)
    if (!actor || actor.status !== 'active' || (actor.role !== 'admin' && actor.role !== 'master')) throw new ApiError(403, '승인된 기관 관리자만 문서 업무를 사용할 수 있습니다.')
    if (req.method === 'POST' && req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new ApiError(403, '동일 출처에서 요청하세요.')
    let db: ReturnType<typeof getSupabaseAdmin>
    try { db = getSupabaseAdmin() } catch { throw new ApiError(503, '센터 문서 서버 설정이 필요합니다.') }
    await assertCenterOrganizationReady(db, actor.organization_code)
    if (req.method === 'GET') { sendJson(res, 200, { documents: await loadCenterDocuments(db, actor.organization_code) }); return }
    let mutation
    // 80,000 Korean characters can exceed the generic 200 KB request limit.
    // Raise only this bounded document endpoint, preserving other API limits.
    try { mutation = parseCenterDocumentMutation(await readJsonBody(req, 500_000)) }
    catch (error) { if (error instanceof CenterDocumentError) throw new ApiError(error.statusCode, error.message); throw error }
    // Patient UUIDs are checked against the active institution registry inside the SQL transaction.
    if (mutation.action !== 'confirm' && mutation.subjectKind === 'worker') throw new ApiError(503, '직원 대상 문서 저장은 아직 연결 전입니다.')
    sendJson(res, 200, { document: await mutateCenterDocument(db, actor.organization_code, actor.id, mutation) })
  })
}
