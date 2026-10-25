import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), ready: vi.fn(), rpc: vi.fn() }))
vi.mock('../centerAuth.js', () => ({ centerSession: m.session }))
vi.mock('../centerDocumentStore.js', () => ({ assertCenterOrganizationReady: m.ready }))
vi.mock('../supabase.js', () => ({ getSupabaseAdmin: () => ({ rpc: m.rpc }) }))
import handler from './month-schedule.js'
const id = '00000000-0000-4000-8000-000000000001', actor = { id: 'fake-admin', role: 'admin', status: 'active', organization_code: 'TEST' }, input = { requestId: id, month: '2026-10', expectedVersion: 0, locked: true, snapshot: [{ id, version: 1 }] }
function req(data?: unknown, site?: string) { const r = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []) as IncomingMessage; r.method = data ? 'POST' : 'GET'; r.url = '/api/center/month-schedule?month=2026-10&organizationCode=OTHER'; r.headers = site ? { 'sec-fetch-site': site } : {}; return r }
function res() { return { statusCode: 200, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse }
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue(actor); m.ready.mockResolvedValue(undefined); m.rpc.mockResolvedValue({ data: { month: '2026-10', version: 1, locked: true, snapshot: input.snapshot }, error: null }) })
it('기관·작성자는 세션에서 정하며 조회·저장 결과를 검증한다', async () => {
  await handler(req(), res()); expect(m.rpc).toHaveBeenCalledWith('inspect_center_month_schedule', { p_organization_code: 'TEST', p_month: '2026-10' })
  await handler(req(input), res()); expect(m.rpc).toHaveBeenCalledWith('set_center_month_schedule_lock', { p_organization_code: 'TEST', p_actor_id: actor.id, p_mutation: input })
  m.rpc.mockResolvedValue({ data: { month: '2026-11', version: 1, locked: true, snapshot: input.snapshot }, error: null })
  const bad = res(); await handler(req(input), bad); expect(bad.statusCode).toBe(503)
})
it('미승인·다른 역할·교차출처·기관 주입은 저장 전에 차단한다', async () => {
  for (const session of [null, { ...actor, role: 'caregiver' }, { ...actor, status: 'pending' }]) { m.session.mockResolvedValue(session); const r = res(); await handler(req(input), r); expect(r.statusCode).toBe(403) }
  m.session.mockResolvedValue(actor)
  const cross = res(); await handler(req(input, 'cross-site'), cross); expect(cross.statusCode).toBe(403)
  const injected = res(); await handler(req({ ...input, organizationCode: 'OTHER' }), injected); expect(injected.statusCode).toBe(400)
  expect(m.rpc).not.toHaveBeenCalled()
})
it('일정 변경 충돌과 미적용 저장소는 성공으로 바꾸지 않는다', async () => {
  m.rpc.mockResolvedValue({ error: { message: 'CENTER_MONTH_409 stale schedule' } }); const conflict = res(); await handler(req(input), conflict); expect(conflict.statusCode).toBe(409)
  m.rpc.mockResolvedValue({ error: { message: 'function missing' } }); const missing = res(); await handler(req(), missing); expect(missing.statusCode).toBe(503)
})
