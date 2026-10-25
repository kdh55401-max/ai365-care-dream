import type { IncomingMessage, ServerResponse } from 'node:http'
import { checkedWeekReviewSaved, parseWeekReviewMutation, parseWeekReviewsMonth } from '../../../shared/centerWeekReviews.js'
import { centerSession } from '../centerAuth.js'
import { assertCenterOrganizationReady } from '../centerDocumentStore.js'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../http.js'
import { getSupabaseAdmin } from '../supabase.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST'); const actor = await centerSession(req)
    if (!actor || actor.status !== 'active' || !['admin', 'master'].includes(actor.role)) throw new ApiError(403, '승인된 기관 관리자만 주별 확인에 접근할 수 있습니다.')
    if (req.method === 'POST' && req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new ApiError(403, '동일 출처에서 요청하세요.')
    let db: ReturnType<typeof getSupabaseAdmin>
    try { db = getSupabaseAdmin() } catch { throw new ApiError(503, '센터 서버 설정이 필요합니다.') }
    await assertCenterOrganizationReady(db, actor.organization_code)
    let input, month = ''
    try { if (req.method === 'POST') input = parseWeekReviewMutation(await readJsonBody(req)); else month = String(new URL(req.url || '/', 'https://localhost').searchParams.get('month') || '') } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : '주별 확인 요청을 확인하세요.') }
    const result = input ? await db.rpc('save_center_week_review', { p_organization_code: actor.organization_code, p_actor_id: actor.id, p_mutation: input }) : await db.rpc('inspect_center_week_reviews', { p_organization_code: actor.organization_code, p_month: month })
    if (result.error) {
      const code = result.error.message?.match(/^CENTER_WEEK_REVIEW_(400|403|404|409|503)\b/)?.[1]
      throw new ApiError(code ? Number(code) : 503, code === '409' ? '주별 확인이나 수급자 상태가 변경되었습니다. 다시 조회하세요.' : code === '404' ? '수급자를 찾지 못했습니다.' : code === '400' ? '주별 확인 내용을 확인하세요.' : '주별 확인 저장소를 사용할 수 없습니다. 마이그레이션 적용 여부를 확인하세요.')
    }
    try {
      if (input) sendJson(res, 200, checkedWeekReviewSaved(result.data, input))
      else { const data = parseWeekReviewsMonth(result.data); if (data.month !== month) throw new Error(); sendJson(res, 200, data) }
    } catch { throw new ApiError(502, '주별 확인 응답을 확인하지 못했습니다. 다시 조회하세요.') }
  })
}
