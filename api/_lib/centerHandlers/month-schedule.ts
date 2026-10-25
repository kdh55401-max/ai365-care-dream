import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseMonthMutation, parseMonthState, scheduleMonth } from '../../../shared/centerMonthSchedule.js'
import { centerSession } from '../centerAuth.js'
import { assertCenterOrganizationReady } from '../centerDocumentStore.js'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../http.js'
import { getSupabaseAdmin } from '../supabase.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST'); const actor = await centerSession(req)
    if (!actor || actor.status !== 'active' || !['admin', 'master'].includes(actor.role)) throw new ApiError(403, '승인된 기관 관리자만 월 일정을 검토할 수 있습니다.')
    if (req.method === 'POST' && req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new ApiError(403, '동일 출처에서 요청하세요.')
    let db: ReturnType<typeof getSupabaseAdmin>
    try { db = getSupabaseAdmin() } catch { throw new ApiError(503, '센터 서버 설정이 필요합니다.') }
    await assertCenterOrganizationReady(db, actor.organization_code)
    let input, month
    try { if (req.method === 'POST') { input = parseMonthMutation(await readJsonBody(req)); month = input.month } else month = scheduleMonth(new URL(req.url || '/', 'https://localhost').searchParams.get('month')) } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : '월 일정 입력 오류') }
    const result = input ? await db.rpc('set_center_month_schedule_lock', { p_organization_code: actor.organization_code, p_actor_id: actor.id, p_mutation: input }) : await db.rpc('inspect_center_month_schedule', { p_organization_code: actor.organization_code, p_month: month })
    if (result.error) {
      const code = result.error.message?.match(/^CENTER_MONTH_(400|403|409|503)\b/)?.[1]
      throw new ApiError(code ? Number(code) : 503, code === '409' ? '일정 또는 잠금 상태가 바뀌었습니다. 다시 조회하세요.' : '월 일정 저장소·입력을 확인하세요.')
    }
    try {
      const state = parseMonthState(result.data)
      if (state.month !== month || (input && (state.version !== input.expectedVersion + 1 || state.locked !== input.locked || JSON.stringify(state.snapshot) !== JSON.stringify(input.snapshot)))) throw new Error()
      sendJson(res, 200, state)
    } catch { throw new ApiError(503, '검토 응답 확인 실패 · 같은 요청으로 재시도하세요.') }
  })
}
