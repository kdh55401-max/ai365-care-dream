/** 담당 요양보호사 변경 → 직원변경 상담일지 대상 생성 → 초안 → 확정(잠금)을, 실제 서버 핸들러(api/admin/participants.ts)를 수정 없이
 * 실제 Postgres 엔진(PGlite)과 실제 마이그레이션(2026-10-02, 2026-10-03) 위에서 돌려 검증한다.
 * 이 환경에는 Supabase 자격증명이 없어 실제 운영 DB·네트워크 경로는 검증하지 않는다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
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
let seq = 0
const rid = () => `note-req-${Date.now()}-${++seq}`

async function cookieFrom(setter: (res: never) => Promise<void>): Promise<string> {
  const r = fakeResponse()
  await setter(r.res as never)
  return r.headers['set-cookie'].split(';')[0]
}

async function call(method: string, url: string, cookie?: string, body?: unknown) {
  const r = fakeResponse()
  await participants(fakeRequest(method, url, cookie, body) as never, r.res as never)
  return r
}

const post = (body: Record<string, unknown>, cookie = adminCookie) => call('POST', '/api/admin/participants', cookie, body)
const notes = async (cookie = adminCookie) => call('GET', '/api/admin/participants?view=staff_notes', cookie)

interface NoteItem {
  changeLogId: number
  recipientCode: string
  fromCaregivers: string[]
  toCaregivers: string[]
  note: null | { status: string; reason: string; content: string; counselMethod: string | null; changedOn: string; updatedAt: string; confirmedAt: string | null }
}
const items = async () => ((await notes()).json as { ready: boolean; items: NoteItem[] }).items

const full = {
  reason: '근무시간 조정',
  counselMethod: 'phone',
  counseleeRelation: '보호자(자녀)',
  content: '전화로 담당 변경을 안내했고 보호자가 동의한다고 답했습니다.',
}
const save = (changeLogId: number, extra: Record<string, unknown> = {}) =>
  post({ op: 'staff_note_save', changeLogId, changedOn: '2026-10-01', confirm: false, ...extra })

/** A10을 C02 담당으로 등록한 뒤 C03으로 바꿔 "담당 해제" 변경 이력 1건을 만든다. */
async function makeChange(): Promise<number> {
  const reg = await post({ op: 'recipient_register', displayName: '햇살', caregiverCodes: ['C02'], active: true, requestId: rid() })
  expect(reg.status).toBe(200)
  const upd = await post({ op: 'recipient_update', code: String(reg.json.code), caregiverCodes: ['C03'], requestId: rid() })
  expect(upd.status).toBe(200)
  const list = await items()
  expect(list).toHaveLength(1)
  return list[0].changeLogId
}

beforeAll(async () => {
  process.env.CARE_PILOT_JWT_SECRET = 'test-secret-for-staff-note-flow-0123456789abcdef'
  adminCookie = await cookieFrom((res) => setAdminSessionCookie(res))
  careCookie = await cookieFrom((res) => setCareSessionCookie(res, 'C01'))
})

async function freshDb(withNotesMigration: boolean) {
  db = newTestDb()
  await db.exec(read('db/schema.sql'))
  await db.exec(`insert into caregiver_assignments (caregiver_code, recipient_code) values ('C01', 'A01')`)
  await db.exec(read('db/migrations/2026-10-02-recipient-registration.sql'))
  if (withNotesMigration) await db.exec(read('db/migrations/2026-10-03-staff-change-notes.sql'))
  holder.client = pgliteSupabase(db)
}

beforeEach(async () => {
  await freshDb(true)
}, 60_000)

describe('권한', () => {
  it('로그인 없이는 조회·저장이 401이고 아무것도 저장되지 않는다', async () => {
    const id = await makeChange()
    expect((await notes('')).status).toBe(401)
    expect((await post({ op: 'staff_note_save', changeLogId: id, changedOn: '2026-10-01', confirm: false }, '')).status).toBe(401)
    expect((await db.query(`select 1 from staff_change_notes`)).rows).toHaveLength(0)
    // 요양보호사 세션은 관리자 권한이 아니다.
    expect((await notes(careCookie)).status).toBe(401)
    expect((await post({ op: 'staff_note_save', changeLogId: id, changedOn: '2026-10-01', confirm: false }, careCookie)).status).toBe(401)
  })
})

describe('마이그레이션 전', () => {
  it('상담일지 표가 없으면 ready:false(가짜 빈 목록 아님)이고 기존 수급자 관리는 그대로 된다', async () => {
    await freshDb(false)
    const r = await notes()
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ ready: false, items: [] })
    // 기존 담당 변경은 막히지 않는다.
    const reg = await post({ op: 'recipient_register', displayName: '햇살', caregiverCodes: ['C02'], active: true, requestId: rid() })
    expect(reg.status).toBe(200)
    expect((await post({ op: 'recipient_update', code: String(reg.json.code), caregiverCodes: ['C03'], requestId: rid() })).status).toBe(200)
    // 저장 시도는 503(준비 안 됨)이지 500이 아니다.
    const s = await save(1)
    expect([503, 404]).toContain(s.status)
  })
})

describe('일지 대상', () => {
  it('담당이 해제된 변경만 대상이 된다(등록·추가만·표시명 변경은 아님)', async () => {
    expect(await items()).toHaveLength(0)
    const reg = await post({ op: 'recipient_register', displayName: '햇살', caregiverCodes: ['C02'], active: true, requestId: rid() })
    const code = String(reg.json.code)
    expect(await items()).toHaveLength(0) // 등록
    await post({ op: 'recipient_update', code, displayName: '햇살2', requestId: rid() })
    expect(await items()).toHaveLength(0) // 표시명만
    await post({ op: 'recipient_update', code, caregiverCodes: ['C02', 'C04'], requestId: rid() })
    expect(await items()).toHaveLength(0) // 담당 추가만
    await post({ op: 'recipient_update', code, caregiverCodes: ['C04'], requestId: rid() })
    const list = await items()
    expect(list).toHaveLength(1) // C02 해제
    expect(list[0]).toMatchObject({ recipientCode: code, fromCaregivers: ['C02'], toCaregivers: [], note: null })
  })

  it('교체(C02→C03)는 전/후 담당이 함께 기록되고, 후임 없는 해제는 후임이 비어 있다', async () => {
    const id = await makeChange()
    const [it0] = await items()
    expect(it0).toMatchObject({ changeLogId: id, fromCaregivers: ['C02'], toCaregivers: ['C03'] })
  })

  it('담당 추가만 한 변경에는 일지를 쓸 수 없다(404)', async () => {
    const reg = await post({ op: 'recipient_register', displayName: '햇살', caregiverCodes: [], active: true, requestId: rid() })
    await post({ op: 'recipient_update', code: String(reg.json.code), caregiverCodes: ['C02'], requestId: rid() })
    const logId = Number((await db.query<{ id: number }>(`select id from recipient_admin_log where event_type = 'updated'`)).rows[0].id)
    expect((await save(logId)).status).toBe(404)
    expect((await save(99999)).status).toBe(404)
  })
})

describe('초안 → 확정', () => {
  it('빈 초안도 저장되고 다시 불러오면 작성 중으로 남으며, 이어서 수정할 수 있다', async () => {
    const id = await makeChange()
    const first = await save(id)
    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({ changeLogId: id, status: 'draft' })
    const [draft] = await items()
    expect(draft.note).toMatchObject({ status: 'draft', reason: '', content: '', counselMethod: null, changedOn: '2026-10-01', confirmedAt: null })
    expect(draft.note!.updatedAt).toBeTruthy()

    const second = await save(id, { ...full, expectedUpdatedAt: draft.note!.updatedAt })
    expect(second.status).toBe(200)
    expect((await items())[0].note).toMatchObject({ status: 'draft', reason: full.reason, counselMethod: 'phone' })
  })

  it('다른 곳에서 먼저 고친 뒤 옛 화면에서 저장하면 409로 막힌다(덮어쓰지 않음)', async () => {
    const id = await makeChange()
    const first = await save(id, { reason: '처음' })
    const stale = String(first.json.updatedAt)
    expect((await save(id, { reason: '다른 관리자', expectedUpdatedAt: stale })).status).toBe(200)
    const conflict = await save(id, { reason: '옛 화면', expectedUpdatedAt: stale })
    expect(conflict.status).toBe(409)
    expect((await items())[0].note!.reason).toBe('다른 관리자')
    // 일지가 있는데 expectedUpdatedAt 없이 저장해도 409.
    expect((await save(id, { reason: '검사 없이' })).status).toBe(409)
  })

  it('확정은 필수 항목이 비어 있으면 400이고 초안 상태가 유지된다', async () => {
    const id = await makeChange()
    for (const missing of ['reason', 'counselMethod', 'counseleeRelation', 'content'] as const) {
      const r = await save(id, { ...full, [missing]: '', confirm: true })
      expect(r.status).toBe(400)
    }
    expect(await items().then((l) => l[0].note)).toBeNull() // 실패한 확정이 일지를 만들지 않았다
  })

  it('확정하면 확정 시각이 남고, 이후 수정·재확정은 409이며 DB도 직접 수정·삭제를 거부한다', async () => {
    const id = await makeChange()
    const draft = await save(id, { reason: '초안' })
    const done = await save(id, { ...full, confirm: true, expectedUpdatedAt: String(draft.json.updatedAt) })
    expect(done.status).toBe(200)
    expect(done.json).toMatchObject({ status: 'confirmed' })
    const [row] = await items()
    expect(row.note).toMatchObject({ status: 'confirmed', reason: full.reason, content: full.content })
    expect(row.note!.confirmedAt).toBeTruthy()

    expect((await save(id, { ...full, reason: '바꾸기', expectedUpdatedAt: row.note!.updatedAt })).status).toBe(409)
    expect((await save(id, { ...full, confirm: true, expectedUpdatedAt: row.note!.updatedAt })).status).toBe(409)
    await expect(db.query(`update staff_change_notes set reason = '직접 수정' where change_log_id = $1`, [id])).rejects.toThrow(/확정된 상담일지/)
    await expect(db.query(`delete from staff_change_notes where change_log_id = $1`, [id])).rejects.toThrow(/확정된 상담일지/)
    expect((await items())[0].note!.reason).toBe(full.reason)
  })

  it('한 변경에는 일지가 하나만 생긴다(동시에 처음 저장해도 1건)', async () => {
    const id = await makeChange()
    const [a, b] = await Promise.all([save(id, { reason: 'A' }), save(id, { reason: 'B' })])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect((await db.query(`select 1 from staff_change_notes where change_log_id = $1`, [id])).rows).toHaveLength(1)
  })
})

describe('입력 검사(서버)', () => {
  it('미래 날짜·잘못된 날짜·잘못된 상담 방법·식별번호처럼 보이는 대상자를 거부한다', async () => {
    const id = await makeChange()
    expect((await save(id, { changedOn: '2999-01-01' })).status).toBe(400)
    expect((await save(id, { changedOn: '2026-13-40' })).status).toBe(400)
    expect((await save(id, { counselMethod: 'fax' })).status).toBe(400)
    expect((await save(id, { counseleeRelation: '010-1234-5678' })).status).toBe(400)
    expect((await save(id, { content: 'ㄱ'.repeat(2100) })).status).toBe(400)
    expect((await save(0)).status).toBe(400)
    expect((await db.query(`select 1 from staff_change_notes`)).rows).toHaveLength(0)
  })
})

describe('감사 기록', () => {
  it('저장·확정 사실만 남기고 일지 내용은 남기지 않는다', async () => {
    const id = await makeChange()
    await save(id, { ...full, confirm: true })
    const rows = (await db.query<{ action: string; target: string | null; detail: unknown }>(`select action, target, detail from admin_audit_log where action like 'staff_note%'`)).rows
    expect(rows).toEqual([{ action: 'staff_note_confirm', target: String(id), detail: null }])
    expect(JSON.stringify(rows)).not.toContain(full.content)
  })
})
