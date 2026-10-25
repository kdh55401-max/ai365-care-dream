import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), ready: vi.fn(), rpc: vi.fn() }))
vi.mock('../centerAuth.js', () => ({ centerSession: m.session }))
vi.mock('../centerDocumentStore.js', () => ({ assertCenterOrganizationReady: m.ready }))
vi.mock('../supabase.js', () => ({ getSupabaseAdmin: () => ({ rpc: m.rpc }) }))
import handler from './plan-application.js'
const id = '00000000-0000-4000-8000-000000000001', actor = { id: 'fake-admin', role: 'admin', status: 'active', organization_code: 'TEST' }, input = { requestId: id, planId: id, expectedVersion: 2 }
function req(data: unknown = input, site?: string) { const r = Readable.from([Buffer.from(JSON.stringify(data))]) as IncomingMessage; r.method = 'POST'; r.url = '/api/center/plan-application?organizationCode=OTHER'; r.headers = site ? { 'sec-fetch-site': site } : {}; return r }
function res() { return { statusCode: 200, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse }
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue(actor); m.ready.mockResolvedValue(undefined); m.rpc.mockResolvedValue({ data: { planId: id, planVersion: 2, createdCount: 0, skippedCount: 4, visitIds: [] }, error: null }) })
it('기관·작성자는 승인된 세션에서 정하고 RPC 결과를 검증한다', async () => {
  const response = res(); await handler(req(), response); expect(response.statusCode).toBe(200)
  expect(m.rpc).toHaveBeenCalledWith('apply_center_weekly_plan', { p_organization_code: 'TEST', p_actor_id: actor.id, p_mutation: input })
  m.rpc.mockResolvedValue({ data: { planId: id, planVersion: 1, createdCount: 0, skippedCount: 4, visitIds: [] }, error: null })
  const malformed = res(); await handler(req(), malformed); expect(malformed.statusCode).toBe(503)
})
it('미승인·잘못된 역할·교차출처·기관 주입은 저장 전에 거절한다', async () => {
  for (const session of [null, { ...actor, role: 'caregiver' }, { ...actor, status: 'pending' }]) { m.session.mockResolvedValue(session); const r = res(); await handler(req(), r); expect(r.statusCode).toBe(403) }
  m.session.mockResolvedValue(actor)
  const cross = res(); await handler(req(input, 'cross-site'), cross); expect(cross.statusCode).toBe(403)
  const injected = res(); await handler(req({ ...input, organizationCode: 'OTHER' }), injected); expect(injected.statusCode).toBe(400)
  expect(m.rpc).not.toHaveBeenCalled()
})
it('충돌과 저장소 미준비를 성공으로 바꾸지 않는다', async () => {
  m.rpc.mockResolvedValue({ error: { message: 'CENTER_APPLY_409 time conflict' } })
  const conflict = res(); await handler(req(), conflict); expect(conflict.statusCode).toBe(409)
  m.rpc.mockResolvedValue({ error: { message: 'function not found' } })
  const missing = res(); await handler(req(), missing); expect(missing.statusCode).toBe(503)
})
