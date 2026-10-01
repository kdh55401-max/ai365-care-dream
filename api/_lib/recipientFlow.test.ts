/** 관리자 수급자 등록 → 요양보호사 표시 → 기록 시작·제출 → 관리자 확인까지, 실제 서버 핸들러(api/…)를 수정 없이
 * 실제 Postgres 엔진(PGlite)과 실제 마이그레이션 위에서 돌려 권한(관리자 인증, 배정·활성 확인)과 저장 결과를 검증한다.
 * 이 환경에는 Supabase 자격증명이 없어 실제 운영 DB·네트워크 경로는 검증하지 않는다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { fakeRequest, fakeResponse, newTestDb, pgliteSupabase } from './testSupport/pgliteSupabase.js'

const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('./supabase.js', () => ({ getSupabaseAdmin: () => holder.client }))

import participants from '../admin/participants.js'
import adminReports from '../admin/reports.js'
import careSession from '../care/session.js'
import careReports from '../care/reports.js'
import { setAdminSessionCookie, setCareSessionCookie } from './auth.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8').replace(/create extension[^;]*;/gi, '')

let db: PGlite
let adminCookie = ''
const careCookies: Record<string, string> = {}
let seq = 0
const rid = () => `flow-req-${Date.now()}-${++seq}`

async function cookieFrom(setter: (res: never) => Promise<void>): Promise<string> {
  const r = fakeResponse()
  await setter(r.res as never)
  return r.headers['set-cookie'].split(';')[0]
}

async function call(handler: (req: never, res: never) => Promise<void>, method: string, url: string, cookie?: string, body?: unknown) {
  const r = fakeResponse()
  await handler(fakeRequest(method, url, cookie, body) as never, r.res as never)
  return r
}

const adminPost = (body: Record<string, unknown>, cookie = adminCookie) => call(participants, 'POST', '/api/admin/participants', cookie, body)
const adminView = (cookie = adminCookie) => call(participants, 'GET', '/api/admin/participants?view=recipients', cookie)
const session = (code: string) => call(careSession, 'GET', '/api/care/session', careCookies[code])
const startReport = (code: string, recipientCode: string, extra: Record<string, unknown> = {}) =>
  call(careReports, 'POST', '/api/care/reports', careCookies[code], { recipientCode, reportType: 'daily', inputMethod: 'text', ...extra })

beforeAll(async () => {
  process.env.CARE_PILOT_JWT_SECRET = 'test-secret-for-recipient-flow-0123456789abcdef'
  adminCookie = await cookieFrom((res) => setAdminSessionCookie(res))
  for (const c of ['C01', 'C02', 'C03']) careCookies[c] = await cookieFrom((res) => setCareSessionCookie(res, c))
})

beforeEach(async () => {
  db = newTestDb()
  await db.exec(read('db/schema.sql'))
  await db.exec(`insert into caregiver_assignments (caregiver_code, recipient_code) values ('C01', 'A01')`)
  await db.exec(read('db/migrations/2026-10-02-recipient-registration.sql'))
  holder.client = pgliteSupabase(db)
}, 60_000)

describe('관리자 인증', () => {
  it('로그인 없이 목록 조회·등록·수정 요청을 하면 401이고 아무것도 저장되지 않는다', async () => {
    expect((await adminView('')).status).toBe(401)
    expect((await adminPost({ op: 'recipient_register', displayName: '무인증', caregiverCodes: [], active: true, requestId: rid() }, '')).status).toBe(401)
    expect((await adminPost({ op: 'recipient_update', code: 'A01', displayName: '무인증', requestId: rid() }, '')).status).toBe(401)
    // 요양보호사 세션은 관리자 권한이 아니다.
    expect((await adminPost({ op: 'recipient_register', displayName: '보호사', requestId: rid() }, careCookies.C01)).status).toBe(401)
    expect((await db.query(`select 1 from recipients where code > 'A09' or display_name is not null`)).rows).toHaveLength(0)
  })

  it('다른 기관 주소로 부르면 403', async () => {
    expect((await call(participants, 'GET', '/api/admin/participants?view=recipients&org=other-center', adminCookie)).status).toBe(403)
  })
})

describe('등록 → 요양보호사 표시 → 기록 → 관리자 확인', () => {
  it('등록하면 목록에 남고, 담당 요양보호사에게만 표시되며, 그 수급자로 기록을 만들고 제출한 뒤 관리자가 수급자별로 볼 수 있다', async () => {
    const reg = await adminPost({ op: 'recipient_register', displayName: '햇살', caregiverCodes: ['C02'], active: true, requestId: rid() })
    expect(reg.status).toBe(200)
    const code = String(reg.json.code)
    expect(code).toBe('A10')

    // 새로 불러와도 남아 있다(= 새로고침 후 유지).
    const list = (await adminView()).json as { ready: boolean; recipients: Array<{ code: string; displayName: string | null; active: boolean; caregivers: string[] }> }
    expect(list.ready).toBe(true)
    expect(list.recipients.find((r) => r.code === code)).toMatchObject({ displayName: '햇살', active: true, caregivers: ['C02'] })
    // 기존 수급자는 그대로.
    expect(list.recipients.find((r) => r.code === 'A01')).toMatchObject({ caregivers: ['C01'], active: true })

    // 담당 요양보호사 C02에게 표시, 다른 요양보호사에게는 표시되지 않는다.
    expect((await session('C02')).json).toMatchObject({ recipientCodes: [code], recipients: [{ code, displayName: '햇살' }] })
    expect((await session('C03')).json).toMatchObject({ recipientCodes: [], recipients: [] })
    expect((await session('C01')).json).toMatchObject({ recipientCodes: ['A01'] })

    // 배정되지 않은 요양보호사가 코드를 직접 보내면 서버가 거부한다.
    expect((await startReport('C03', code)).status).toBe(403)
    expect((await startReport('C01', code)).status).toBe(403)
    expect((await db.query(`select 1 from reports where recipient_code = $1`, [code])).rows).toHaveLength(0)

    // 담당자는 기록을 시작하고 제출한다.
    const started = await startReport('C02', code)
    expect(started.status).toBe(201)
    const reportId = String((started.json.report as { id: string }).id)
    const submitted = await call(careReports, 'PATCH', '/api/care/reports', careCookies.C02, {
      id: reportId,
      rawInput: '오늘 식사를 잘 하셨어요.',
      caregiverFinalReport: { change: '식사량 평소와 같음', action: '', result: '', escalation: '' },
      submit: true,
      centerResponses: [],
    })
    expect(submitted.status).toBe(200)
    expect((submitted.json.report as { status: string }).status).toBe('submitted')

    // 관리자가 그 수급자의 기록으로 확인한다.
    const adminList = await call(adminReports, 'GET', '/api/admin/reports?source=live', adminCookie)
    expect(adminList.status).toBe(200)
    const rows = adminList.json.reports as Array<{ id: string; recipient_code: string; participant_code: string; status: string }>
    expect(rows.find((r) => r.id === reportId)).toMatchObject({ recipient_code: code, participant_code: 'C02', status: 'submitted' })
  })

  it('입력 오류·없는 요양보호사는 400이고 수급자도 배정도 남지 않는다', async () => {
    expect((await adminPost({ op: 'recipient_register', displayName: '  ', caregiverCodes: [], requestId: rid() })).status).toBe(400)
    expect((await adminPost({ op: 'recipient_register', displayName: '900101-1234567', caregiverCodes: [], requestId: rid() })).status).toBe(400)
    expect((await adminPost({ op: 'recipient_register', displayName: '실패', caregiverCodes: ['C01', 'C77'], requestId: rid() })).status).toBe(400)
    expect((await adminPost({ op: 'recipient_register', displayName: '실패', caregiverCodes: [], code: 'X1', requestId: rid() })).status).toBe(400)
    expect((await adminPost({ op: 'recipient_register', displayName: '실패', caregiverCodes: [], requestId: 'x' })).status).toBe(400)
    expect((await db.query<{ n: number }>('select count(*)::int as n from recipients')).rows[0].n).toBe(9)
    expect((await db.query<{ n: number }>('select count(*)::int as n from caregiver_assignments')).rows[0].n).toBe(1)
  })

  it('코드 중복은 409, 같은 요청 재전송은 한 번만 저장된다', async () => {
    expect((await adminPost({ op: 'recipient_register', displayName: '중복', caregiverCodes: [], code: 'A01', requestId: rid() })).status).toBe(409)
    const id = rid()
    const first = await adminPost({ op: 'recipient_register', displayName: '한 번', caregiverCodes: [], requestId: id })
    const again = await adminPost({ op: 'recipient_register', displayName: '한 번', caregiverCodes: [], requestId: id })
    expect(first.json.code).toBe(again.json.code)
    expect(again.json.duplicate).toBe(true)
    expect((await db.query(`select 1 from recipients where display_name = '한 번'`)).rows).toHaveLength(1)
  })
})

describe('배정 해제·비활성화·변경', () => {
  async function registerFor(caregiver: string) {
    const reg = await adminPost({ op: 'recipient_register', displayName: '바람', caregiverCodes: [caregiver], active: true, requestId: rid() })
    return String(reg.json.code)
  }

  it('배정을 해제하면 목록에서 사라지고 새 기록 시작이 차단되지만, 과거 기록의 수급자 연결은 유지된다', async () => {
    const code = await registerFor('C02')
    const started = await startReport('C02', code)
    expect(started.status).toBe(201)
    const reportId = String((started.json.report as { id: string }).id)

    expect((await adminPost({ op: 'recipient_update', code, caregiverCodes: [], requestId: rid() })).status).toBe(200)
    expect((await session('C02')).json).toMatchObject({ recipientCodes: [] })
    // 로그인 중이던 화면에서 새 기록을 시작해도 서버가 다시 확인해 거부한다.
    expect((await startReport('C02', code, { reportType: 'additional' })).status).toBe(403)
    const view = (await adminView()).json as { recipients: Array<{ code: string; caregivers: string[] }> }
    expect(view.recipients.find((r) => r.code === code)?.caregivers).toEqual([])
    const kept = (await db.query<{ recipient_code: string }>('select recipient_code from reports where id = $1', [reportId])).rows[0]
    expect(kept.recipient_code).toBe(code)
    // 배정 행은 삭제되지 않고 해제로 남는다.
    expect((await db.query(`select active from caregiver_assignments where recipient_code = $1 and caregiver_code = 'C02'`, [code])).rows).toEqual([{ active: false }])
  })

  it('담당자를 C02에서 C03으로 바꾸면 C03에게 표시되고 C02는 막힌다', async () => {
    const code = await registerFor('C02')
    expect((await adminPost({ op: 'recipient_update', code, caregiverCodes: ['C03'], requestId: rid() })).status).toBe(200)
    expect((await session('C03')).json).toMatchObject({ recipientCodes: [code] })
    expect((await startReport('C03', code)).status).toBe(201)
    expect((await startReport('C02', code)).status).toBe(403)
  })

  it('비활성화하면 담당자에게도 보이지 않고 새 기록이 차단되며, 다시 활성화하면 복구된다', async () => {
    const code = await registerFor('C02')
    expect((await adminPost({ op: 'recipient_update', code, active: false, requestId: rid() })).status).toBe(200)
    expect((await session('C02')).json).toMatchObject({ recipientCodes: [] })
    expect((await startReport('C02', code)).status).toBe(400)
    expect((await adminPost({ op: 'recipient_update', code, active: true, requestId: rid() })).status).toBe(200)
    expect((await session('C02')).json).toMatchObject({ recipientCodes: [code] })
    expect((await startReport('C02', code)).status).toBe(201)
  })

  it('표시명 수정이 저장되고 잘못된 표시명·없는 수급자는 거부된다', async () => {
    const code = await registerFor('C02')
    expect((await adminPost({ op: 'recipient_update', code, displayName: '바다', requestId: rid() })).status).toBe(200)
    expect((await session('C02')).json).toMatchObject({ recipients: [{ code, displayName: '바다' }] })
    expect((await adminPost({ op: 'recipient_update', code, displayName: '', requestId: rid() })).status).toBe(400)
    expect((await adminPost({ op: 'recipient_update', code: 'A88', displayName: 'x', requestId: rid() })).status).toBe(404)
    expect((await adminPost({ op: 'recipient_update', code: 'A01', caregiverCodes: ['C77'], requestId: rid() })).status).toBe(400)
  })

  it('먼저 바뀐 뒤 옛 값으로 저장하면 409로 거부한다', async () => {
    const code = await registerFor('C02')
    const stale = ((await adminView()).json as { recipients: Array<{ code: string; updatedAt: string }> }).recipients.find((r) => r.code === code)!.updatedAt
    expect((await adminPost({ op: 'recipient_update', code, displayName: '먼저', expectedUpdatedAt: stale, requestId: rid() })).status).toBe(200)
    expect((await adminPost({ op: 'recipient_update', code, displayName: '나중', expectedUpdatedAt: stale, requestId: rid() })).status).toBe(409)
  })
})

describe('기존 데이터 호환', () => {
  it('기존 수급자·배정으로 기록 흐름이 그대로 동작한다', async () => {
    expect((await session('C01')).json).toMatchObject({ recipientCodes: ['A01'], recipients: [{ code: 'A01', displayName: null }] })
    expect((await startReport('C01', 'A01')).status).toBe(201)
  })

  it('마이그레이션 전 DB에서도 요양보호사 화면은 그대로 동작하고 관리자 화면은 준비 중으로 안내한다', async () => {
    const bare = newTestDb()
    await bare.exec(read('db/schema.sql'))
    await bare.exec(`insert into caregiver_assignments (caregiver_code, recipient_code) values ('C01', 'A01')`)
    holder.client = pgliteSupabase(bare)
    expect((await session('C01')).json).toMatchObject({ recipientCodes: ['A01'] })
    expect((await adminView()).json).toMatchObject({ ready: false })
    const blocked = await adminPost({ op: 'recipient_register', displayName: '준비전', caregiverCodes: [], requestId: rid() })
    expect(blocked.status).toBe(503)
  })
})
