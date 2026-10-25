import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), ready: vi.fn(), load: vi.fn(), save: vi.fn(), db: {} }))
vi.mock('../centerAuth.js', () => ({ centerSession: m.session }))
vi.mock('../centerDocumentStore.js', () => ({ assertCenterOrganizationReady: m.ready }))
vi.mock('../centerAssignmentStore.js', () => ({ loadCenterAssignment: m.load, saveCenterAssignment: m.save }))
vi.mock('../supabase.js', () => ({ getSupabaseAdmin: () => m.db }))
import handler from './assignments.js'
const id = '00000000-0000-4000-8000-000000000001', actor = { id: 'fake-admin', role: 'admin', status: 'active', organization_code: 'TEST' }
const input = { patientId: id, workerIds: [], expectedVersion: 0, requestId: id }
function req(method = 'GET', data?: unknown, site?: string) { const r = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []) as IncomingMessage; r.method = method; r.url = `/api/center/assignments?patientId=${id}&organizationCode=OTHER`; r.headers = site ? { 'sec-fetch-site': site } : {}; return r }
function res() { return { statusCode: 200, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse }
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue(actor); m.ready.mockResolvedValue(undefined); m.load.mockResolvedValue({ patientId: id, workerIds: [], version: 0 }); m.save.mockResolvedValue({ patientId: id, workerIds: [], version: 1 }) })
it('조회·저장의 기관은 요청 주소가 아니라 승인된 세션에서 정한다', async () => {
  await handler(req(), res()); expect(m.load).toHaveBeenCalledWith(m.db, 'TEST', id)
  await handler(req('POST', input), res()); expect(m.save).toHaveBeenCalledWith(m.db, 'TEST', actor.id, input)
})
it('미승인·다른 역할·교차 출처와 기관 주입을 거절한다', async () => {
  for (const value of [null, { ...actor, role: 'caregiver' }, { ...actor, status: 'pending' }]) { m.session.mockResolvedValue(value); const r = res(); await handler(req('POST', input), r); expect(r.statusCode).toBe(403) }
  m.session.mockResolvedValue(actor)
  const cross = res(); await handler(req('POST', input, 'cross-site'), cross); expect(cross.statusCode).toBe(403)
  const injected = res(); await handler(req('POST', { ...input, organizationCode: 'OTHER' }), injected); expect(injected.statusCode).toBe(400)
  expect(m.save).not.toHaveBeenCalled()
})
