import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), ready: vi.fn(), rpc: vi.fn() }))
vi.mock('../centerAuth.js', () => ({ centerSession: m.session }))
vi.mock('../centerDocumentStore.js', () => ({ assertCenterOrganizationReady: m.ready }))
vi.mock('../supabase.js', () => ({ getSupabaseAdmin: () => ({ rpc: m.rpc }) }))
import handler from './patient-rates.js'
const id = '00000000-0000-4000-8000-000000000001', actor = { id: 'fake-admin', role: 'admin', status: 'active', organization_code: 'TEST' }
const rate = { id, effectiveDate: '2026-10-03', rateCode: '01', note: '' }, input = { action: 'save', requestId: id, patientId: id, expectedVersion: 0, rate }, state = { patientId: id, version: 1, entries: [{ ...rate, archived: false }] }
function req(data?: unknown, site?: string) { const r = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []) as IncomingMessage; r.method = data ? 'POST' : 'GET'; r.url = `/api/center/patient-rates?patientId=${id}&organizationCode=OTHER`; r.headers = site ? { 'sec-fetch-site': site } : {}; return r }
function res() { return { statusCode: 200, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse }
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue(actor); m.ready.mockResolvedValue(undefined); m.rpc.mockResolvedValue({ data: { state }, error: null }) })
it('조회·저장의 기관은 승인된 세션으로 제한하고 저장 응답을 확인한다', async () => {
  m.rpc.mockResolvedValueOnce({ data: state, error: null }); await handler(req(), res())
  expect(m.rpc).toHaveBeenCalledWith('inspect_center_patient_rate', { p_organization_code: 'TEST', p_patient_id: id })
  const r = res(); await handler(req(input), r); expect(r.statusCode).toBe(200)
  expect(m.rpc).toHaveBeenCalledWith('save_center_patient_rate', { p_organization_code: 'TEST', p_actor_id: actor.id, p_mutation: input })
  m.rpc.mockResolvedValue({ data: { state: { ...state, version: 9 } }, error: null }); const bad = res(); await handler(req(input), bad); expect(bad.statusCode).toBe(503)
})
it('미승인·다른 역할·교차출처·기관 주입을 저장 전에 거절한다', async () => {
  for (const session of [null, { ...actor, role: 'caregiver' }, { ...actor, status: 'pending' }]) { m.session.mockResolvedValue(session); const r = res(); await handler(req(input), r); expect(r.statusCode).toBe(403) }
  m.session.mockResolvedValue(actor)
  const cross = res(); await handler(req(input, 'cross-site'), cross); expect(cross.statusCode).toBe(403)
  const injected = res(); await handler(req({ ...input, organizationCode: 'OTHER' }), injected); expect(injected.statusCode).toBe(400)
  expect(m.rpc).not.toHaveBeenCalled()
})
it('기본정보 버전 충돌과 미적용 저장소는 성공으로 바꾸지 않는다', async () => {
  m.rpc.mockResolvedValue({ error: { message: 'CENTER_RATE_409 person version' } }); const conflict = res(); await handler(req(input), conflict); expect(conflict.statusCode).toBe(409)
  m.rpc.mockResolvedValue({ error: { message: 'missing function' } }); const missing = res(); await handler(req(input), missing); expect(missing.statusCode).toBe(503)
})
