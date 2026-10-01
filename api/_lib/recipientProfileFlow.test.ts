/** 관리자 수급자 인적사항: 실제 서버 핸들러(api/admin/participants.ts)를 실제 Postgres 엔진(PGlite)·실제 마이그레이션 위에서 돌려
 * 인증, 입력 검사, 마이그레이션 적용 전 안내, 인적사항 조회를 확인한다. 운영 DB·네트워크 경로는 검증하지 않는다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { fakeRequest, fakeResponse, newTestDb, pgliteSupabase } from './testSupport/pgliteSupabase.js'

const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('./supabase.js', () => ({ getSupabaseAdmin: () => holder.client }))

import participants from '../admin/participants.js'
import { setAdminSessionCookie } from './auth.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8').replace(/create extension[^;]*;/gi, '')

let db: PGlite
let adminCookie = ''
let seq = 0
const rid = () => `profile-req-${Date.now()}-${++seq}`

async function call(method: string, url: string, cookie?: string, body?: unknown) {
  const r = fakeResponse()
  await participants(fakeRequest(method, url, cookie, body) as never, r.res as never)
  return r
}
type Row = { code: string; displayName: string | null; caregivers: string[]; profile: Record<string, string> }
const rowsOf = (r: { json: unknown }) => (r.json as { recipients: Row[] }).recipients
const view = () => call('GET', '/api/admin/participants?view=recipients', adminCookie)
const post = (body: Record<string, unknown>, cookie = adminCookie) => call('POST', '/api/admin/participants', cookie, body)

const PROFILE = { fullName: '가나다', birthDate: '1956-02-24', ltcNumber: 'l0000000001001', ltcGrade: '4등급', ltcValidFrom: '2025-02-25', ltcValidTo: '2029-02-24', address: '가상시 가상구 1', phone: '051-000-0000' }

beforeAll(async () => {
  process.env.CARE_PILOT_JWT_SECRET = 'test-secret-for-recipient-profile-0123456789abcdef'
  const r = fakeResponse()
  await setAdminSessionCookie(r.res as never)
  adminCookie = r.headers['set-cookie'].split(';')[0]
})

beforeEach(async () => {
  db = newTestDb()
  await db.exec(read('db/schema.sql'))
  await db.exec(read('db/migrations/2026-10-02-recipient-registration.sql'))
  holder.client = pgliteSupabase(db)
}, 60_000)

describe('인적사항 마이그레이션 적용 전', () => {
  it('목록은 보이되 profileReady:false로 알리고, 인적사항 저장은 적용 안내와 함께 막힌다', async () => {
    const v = await view()
    expect(v.status).toBe(200)
    expect(v.json).toMatchObject({ ready: true, profileReady: false })
    expect(rowsOf(v)[0].profile.ltcNumber).toBe('')
    const saved = await post({ op: 'recipient_register', displayName: '가나다', caregiverCodes: [], requestId: rid(), profile: PROFILE })
    expect(saved.status).toBe(503)
    expect((saved.json as { error: string }).error).toContain('2026-10-03')
    // 인적사항 없이 이름만 저장하는 기존 경로는 그대로 된다.
    const plain = await post({ op: 'recipient_register', displayName: '나다라', caregiverCodes: [], requestId: rid() })
    expect(plain.status).toBe(200)
  })
})

describe('인적사항 마이그레이션 적용 후', () => {
  beforeEach(async () => {
    await db.exec(read('db/migrations/2026-10-03-erp-recipient-profile.sql'))
  })

  it('관리자 로그인 없이는 인적사항을 읽거나 쓸 수 없다', async () => {
    expect((await call('GET', '/api/admin/participants?view=recipients')).status).toBe(401)
    expect((await post({ op: 'recipient_register', displayName: '가나다', requestId: rid(), profile: PROFILE }, '')).status).toBe(401)
  })

  it('등록하면 인정번호가 정리되어 저장되고 목록에서 읽힌다', async () => {
    const res = await post({ op: 'recipient_register', displayName: '가나다', caregiverCodes: ['C02'], requestId: rid(), profile: PROFILE })
    expect(res.status).toBe(200)
    const body = (await view()).json as { profileReady: boolean }
    expect(body.profileReady).toBe(true)
    const row = rowsOf(await view()).find((r) => r.code === (res.json as { code: string }).code)
    expect(row?.profile).toMatchObject({ fullName: '가나다', ltcNumber: 'L0000000001-001', ltcGrade: '4등급', ltcValidTo: '2029-02-24' })
    expect(row?.caregivers).toEqual(['C02'])
  })

  it('형식 오류는 400, 인정번호 중복은 409로 사유를 알려 주고 아무것도 저장하지 않는다', async () => {
    const badFormat = await post({ op: 'recipient_register', displayName: '가나다', requestId: rid(), profile: { ...PROFILE, ltcNumber: 'L123' } })
    expect(badFormat.status).toBe(400)
    expect((badFormat.json as { error: string }).error).toContain('장기요양인정번호')
    const badType = await post({ op: 'recipient_register', displayName: '가나다', requestId: rid(), profile: { ...PROFILE, phone: 12345 } })
    expect(badType.status).toBe(400)
    expect((await post({ op: 'recipient_register', displayName: '가나다', requestId: rid(), profile: PROFILE })).status).toBe(200)
    const dup = await post({ op: 'recipient_register', displayName: '다른이', requestId: rid(), profile: { ...PROFILE, fullName: '다른이' } })
    expect(dup.status).toBe(409)
    expect((dup.json as { error: string }).error).toContain('이미 등록된')
    expect(rowsOf(await view()).filter((r) => r.displayName === '다른이')).toHaveLength(0)
  })

  it('수정은 보낸 항목만 바꾼다', async () => {
    const created = (await post({ op: 'recipient_register', displayName: '가나다', requestId: rid(), profile: PROFILE })).json as { code: string }
    const upd = await post({ op: 'recipient_update', code: created.code, requestId: rid(), profile: { ltcGrade: '3등급' } })
    expect(upd.status).toBe(200)
    const row = rowsOf(await view()).find((r) => r.code === created.code)
    expect(row?.profile).toMatchObject({ ltcGrade: '3등급', ltcNumber: 'L0000000001-001', fullName: '가나다' })
  })
})
