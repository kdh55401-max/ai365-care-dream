import type { IncomingMessage, ServerResponse } from 'node:http'
import { assignmentId } from '../../../shared/centerAssignments.js'
import { parseApplicationResult, parseOrigins, parsePlanApplication } from '../../../shared/centerPlanApplication.js'
import { centerSession } from '../centerAuth.js'
import { assertCenterOrganizationReady } from '../centerDocumentStore.js'
import { loadCenterOperations } from '../centerOperationStore.js'
import { loadWeeklyPlans } from '../centerWeeklyPlanStore.js'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../http.js'
import { getSupabaseAdmin } from '../supabase.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST'); const actor = await centerSession(req)
    if (!actor || actor.status !== 'active' || !['admin', 'master'].includes(actor.role)) throw new ApiError(403, '승인된 기관 관리자만 일정을 반영할 수 있습니다.')
    if (req.method === 'POST' && req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new ApiError(403, '동일 출처에서 요청하세요.')
    let db: ReturnType<typeof getSupabaseAdmin>
    try { db = getSupabaseAdmin() } catch { throw new ApiError(503, '기관 서버 설정이 필요합니다.') }
    await assertCenterOrganizationReady(db, actor.organization_code)
    if (req.method === 'GET') {
      let planId: string
      try { planId = assignmentId(new URL(req.url || '/', 'https://localhost').searchParams.get('planId')) } catch { throw new ApiError(400, '계획을 선택하세요.') }
      const row = await db.from('center_weekly_plans').select('patient_id').eq('organization_code', actor.organization_code).eq('id', planId).eq('archived', false).maybeSingle()
      if (row.error) throw new ApiError(503, '계획 저장소 조회 실패')
      if (!row.data) throw new ApiError(404, '현재 기관의 계획을 찾지 못했습니다.')
      const plan = (await loadWeeklyPlans(db, actor.organization_code, row.data.patient_id)).find(p => p.id === planId)
      if (!plan) throw new ApiError(409, '계획이 변경되었습니다. 다시 조회하세요.')
      const history: { entry_id: string; visit_date: string; visit_id: string }[] = []
      for (let offset = 0; ; offset += 500) {
        const origins = await db.from('center_plan_visit_origins').select('entry_id,visit_date,visit_id').eq('organization_code', actor.organization_code).eq('plan_id', planId).order('visit_date').order('entry_id').range(offset, offset + 499)
        if (origins.error || !Array.isArray(origins.data)) throw new ApiError(503, '반영 이력을 모두 조회하지 못했습니다.')
        history.push(...origins.data)
        if (origins.data.length < 500) break
        if (history.length >= 10000) throw new ApiError(503, '반영 이력 조회 한도를 넘었습니다.')
      }
      const snapshot = await loadCenterOperations(db, actor.organization_code)
      sendJson(res, 200, { plan, visits: snapshot.visits, origins: parseOrigins(history.map(o => ({ entryId: o.entry_id, date: o.visit_date, visitId: o.visit_id }))) }); return
    }
    let input
    try { input = parsePlanApplication(await readJsonBody(req)) } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : '반영 요청 오류') }
    const result = await db.rpc('apply_center_weekly_plan', { p_organization_code: actor.organization_code, p_actor_id: actor.id, p_mutation: input })
    if (result.error) {
      const monthError = result.error.message?.match(/^CENTER_MONTH_(409|503)\b/)?.[1]
      if (monthError) throw new ApiError(Number(monthError), '센터 검토 잠금 상태를 확인하고 해당 월의 잠금을 해제하세요.')
      const code = result.error.message?.match(/^CENTER_APPLY_(400|403|404|409|503)\b/)?.[1]
      throw new ApiError(code ? Number(code) : 503, code === '409' ? '계획 버전 또는 수급자·제공자 일정이 충돌합니다. 반영 내역을 다시 조회하세요.' : '계획 반영 저장소·대상·제공자를 확인하세요. 결과가 불확실하면 같은 요청으로 재시도하세요.')
    }
    try { sendJson(res, 200, parseApplicationResult(result.data, input)) } catch { throw new ApiError(503, '반영 응답을 확인하지 못했습니다. 같은 요청으로 재시도하세요.') }
  })
}
