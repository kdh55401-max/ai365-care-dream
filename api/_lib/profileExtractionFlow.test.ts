/** 서류 읽기 서버 경로(api/admin/participants.ts?op=extract_profile): 관리자 인증, 파일 형식·크기 검사, AI 응답 검증, 토큰 기록, 감사 기록에 개인정보가 남지 않는지.
 * 실제 Gemini는 부르지 않는다(fetch를 가짜로 대체) — 실제 AI의 읽기 정확도는 이 테스트로 확인되지 않는다. */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fakeRequest, fakeResponse, newTestDb, pgliteSupabase } from './testSupport/pgliteSupabase.js'

const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('./supabase.js', () => ({ getSupabaseAdmin: () => holder.client }))

import participants from '../admin/participants.js'
import { setAdminSessionCookie, setCareSessionCookie } from './auth.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8').replace(/create extension[^;]*;/gi, '')

let db: PGlite
let adminCookie = ''
let careCookie = ''
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

async function cookieFrom(setter: (res: never) => Promise<void>) {
  const r = fakeResponse()
  await setter(r.res as never)
  return r.headers['set-cookie'].split(';')[0]
}
async function extract(body: Buffer, cookie = adminCookie, headers: Record<string, string> = {}) {
  const r = fakeResponse()
  const req = fakeRequest('POST', '/api/admin/participants?op=extract_profile', cookie, undefined) as unknown as AsyncIterable<Buffer> & { headers: Record<string, string> }
  req.headers = { ...req.headers, ...headers }
  ;(req as { [Symbol.asyncIterator]: () => AsyncIterator<Buffer> })[Symbol.asyncIterator] = async function* () {
    yield body
  }
  await participants(req as never, r.res as never)
  return r
}

const aiAnswer = (obj: Record<string, string>, usage = { promptTokenCount: 1200, candidatesTokenCount: 80 }) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: usage }), { status: 200 })
const FULL = { docKind: 'ltc_certificate', fullName: '가상인', birthDate: '1950-01-01', ltcNumber: 'L0000000099-001', ltcGrade: '4등급', ltcValidFrom: '2025-02-25', ltcValidTo: '2029-02-24', address: '', phone: '' }

beforeAll(async () => {
  process.env.CARE_PILOT_JWT_SECRET = 'test-secret-for-profile-extraction-0123456789abcdef'
  process.env.GEMINI_API_KEY = 'test-key'
  adminCookie = await cookieFrom((res) => setAdminSessionCookie(res))
  careCookie = await cookieFrom((res) => setCareSessionCookie(res, 'C01'))
})
beforeEach(async () => {
  db = newTestDb()
  await db.exec(read('db/schema.sql'))
  holder.client = pgliteSupabase(db)
}, 60_000)
afterEach(() => vi.unstubAllGlobals())

describe('서류 읽기 API', () => {
  it('관리자 로그인 없이는 서류를 AI에 보내지 않는다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await extract(PNG, '')).status).toBe(401)
    expect((await extract(PNG, careCookie)).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PDF·JPG·PNG가 아니면 AI를 부르지 않고 거부한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await extract(Buffer.from('plain text file'))
    expect(r.status).toBe(400)
    expect((r.json as { error: string }).error).toContain('PDF·JPG·PNG')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('4MB를 넘는 파일은 413으로 끊는다', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const big = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)])
    expect((await extract(big)).status).toBe(413)
  })

  it('AI가 읽은 값을 검증해 돌려주고 토큰을 알리며, 감사 기록에는 서류 내용이 남지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(aiAnswer(FULL))
    vi.stubGlobal('fetch', fetchMock)
    const r = await extract(PNG, adminCookie, { 'x-file-name': encodeURIComponent('인정서.png') })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ fileName: '인정서.png', docKind: 'ltc_certificate', usage: { promptTokens: 1200, outputTokens: 80 }, rejected: [] })
    expect((r.json as { fields: Record<string, string> }).fields).toMatchObject({ fullName: '가상인', ltcNumber: 'L0000000099-001', ltcGrade: '4등급' })
    // 서류 파일이 AI 요청에 실려 갔고, 지시문(프롬프트)은 시스템 지침에 있다.
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(sent.contents[0].parts[0].inlineData.mimeType).toBe('image/png')
    expect(sent.generationConfig.temperature).toBe(0)
    const audit = (await db.query<{ action: string; detail: Record<string, unknown> }>(`select action, detail from admin_audit_log where action = 'extract_profile'`)).rows
    expect(audit).toHaveLength(1)
    expect(audit[0].detail).toMatchObject({ docKind: 'ltc_certificate', promptTokens: 1200, outputTokens: 80 })
    expect(JSON.stringify(audit)).not.toContain('가상인')
    expect(JSON.stringify(audit)).not.toContain('L0000000099')
  })

  it('AI가 형식이 틀린 값을 주면 채우지 않고 사유를 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(aiAnswer({ ...FULL, ltcNumber: 'L12', ltcGrade: '7등급' })))
    const r = await extract(PNG)
    const body = r.json as { fields: Record<string, string>; rejected: Array<{ field: string }> }
    expect(body.fields.ltcNumber).toBeUndefined()
    expect(body.rejected.map((x) => x.field).sort()).toEqual(['ltcGrade', 'ltcNumber'])
  })

  it('AI 호출 실패는 502로 알리고 아무것도 저장하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    const r = await extract(PNG)
    expect(r.status).toBe(502)
    expect((await db.query(`select 1 from recipients where full_name is not null`).catch(() => ({ rows: [] }))).rows).toHaveLength(0)
  })
})
