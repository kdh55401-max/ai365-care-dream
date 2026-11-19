/** 연구 자료(기준일·동의·고수준 태그·사전 기록)와 연구용 내보내기를 실제 서버 핸들러 + PGlite + 실제 마이그레이션 위에서 확인한다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { fakeRequest, fakeResponse, newTestDb, pgliteSupabase } from './testSupport/pgliteSupabase.js'

const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('./supabase.js', () => ({ getSupabaseAdmin: () => holder.client }))

import participants from '../admin/participants.js'
import exportHandler from '../admin/export.js'
import { setAdminSessionCookie, setCareSessionCookie } from './auth.js'
import { researchExport } from './researchData.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8').replace(/create extension[^;]*;/gi, '')

let db: PGlite
let adminCookie = ''
let careCookie = ''

async function call(handler: (req: never, res: never) => Promise<void>, method: string, url: string, cookie: string, body?: unknown) {
  const r = fakeResponse()
  await handler(fakeRequest(method, url, cookie, body) as never, r.res as never)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, body: r.json as any }
}
const post = (body: Record<string, unknown>, cookie = adminCookie) => call(participants, 'POST', '/api/admin/participants', cookie, body)

beforeAll(async () => {
  process.env.CARE_PILOT_JWT_SECRET = 'test-secret-for-research-data-0123456789abcdef'
  const a = fakeResponse(); await setAdminSessionCookie(a.res as never); adminCookie = a.headers['set-cookie'].split(';')[0]
  const c = fakeResponse(); await setCareSessionCookie(c.res as never, 'C01'); careCookie = c.headers['set-cookie'].split(';')[0]
})

beforeEach(async () => {
  db = newTestDb()
  await db.exec(read('db/schema.sql'))
  await db.exec(read('db/migrations/2026-11-19-research-daily-weekly.sql'))
  await db.exec(`insert into participants (code, pin_hash) values ('C01', 'x'), ('C02', 'x') on conflict do nothing`)
  await db.exec(`insert into recipients (code) values ('A01'), ('A02') on conflict do nothing`)
  await db.exec(`insert into reports (participant_code, recipient_code, report_type, report_date, status, raw_input, submitted_at, transcript_only, completion_seconds)
    values ('C01', 'A01', 'daily', '2026-11-19', 'submitted', '평소와 같았어요', now(), true, 30),
           ('C02', 'A02', 'daily', '2026-11-19', 'submitted', '기침', now(), true, 20),
           ('C01', 'A01', 'daily', '2026-11-18', 'submitted', '예전 60초 보고', now(), false, 50)`)
  holder.client = pgliteSupabase(db)
}, 60_000)

describe('연구 자료 관리', () => {
  it('요양보호사 세션으로는 연구 자료를 보거나 바꿀 수 없다', async () => {
    expect((await call(participants, 'GET', '/api/admin/participants?view=research', careCookie)).status).toBe(401)
    expect((await post({ op: 'research_cutoff', cutoffDate: '2026-12-01' }, careCookie)).status).toBe(401)
    expect((await call(exportHandler, 'GET', '/api/admin/export?type=research_daily', careCookie)).status).toBe(401)
  })

  it('기준일·동의·사전 기록을 저장하고 화면 자료로 돌려준다', async () => {
    const empty = await call(participants, 'GET', '/api/admin/participants?view=research', adminCookie)
    expect(empty.body.cutoffDate).toBeNull()
    expect(empty.body.participants.slice(0, 2).map((p: { caregiver_code: string; consented: boolean }) => [p.caregiver_code, p.consented])).toEqual([['C01', false], ['C02', false]])

    expect((await post({ op: 'research_cutoff', cutoffDate: '2026-02-30' })).status).toBe(400)
    expect((await post({ op: 'research_cutoff', cutoffDate: '2026-12-01' })).body).toEqual({ cutoffDate: '2026-12-01' })
    expect((await post({ op: 'research_cutoff', cutoffDate: '2026-11-19' })).body).toEqual({ cutoffDate: '2026-11-19' })
    expect((await post({ op: 'research_participant', code: 'C01', consented: true, consentDate: '2026-11-01', highBaseline: true, note: '' })).status).toBe(200)
    expect((await post({ op: 'research_participant', code: 'C99' })).status).toBe(404)
    const added = await post({ op: 'research_pre_add', caregiverCode: 'C01', recipientCode: 'a01', recordDate: '2026-10-05', recordText: '식사량 감소', writingSeconds: 300, source: 'easycare' })
    expect(added.body.preRecord).toMatchObject({ caregiver_code: 'C01', recipient_code: 'A01', record_date: '2026-10-05', writing_seconds: 300, source: 'easycare' })
    expect((await post({ op: 'research_pre_add', caregiverCode: 'C01', recipientCode: 'A99', recordDate: '2026-10-05', recordText: 'x' })).status).toBe(404)

    const view = await call(participants, 'GET', '/api/admin/participants?view=research', adminCookie)
    expect(view.body.cutoffDate).toBe('2026-11-19')
    expect(view.body.participants[0]).toMatchObject({ caregiver_code: 'C01', consented: true, consent_date: '2026-11-01', high_baseline: true })
    expect(view.body.preRecords).toHaveLength(1)

    expect((await post({ op: 'research_pre_hide', id: added.body.preRecord.id })).body).toEqual({ ok: true })
    expect((await call(participants, 'GET', '/api/admin/participants?view=research', adminCookie)).body.preRecords).toHaveLength(0)
  })
})

describe('연구용 내보내기', () => {
  it('동의한 요양보호사의 연구 흐름 기록만, 기준일로 사전·사후를 나눠 내보낸다', async () => {
    await post({ op: 'research_participant', code: 'C01', consented: true, consentDate: null, highBaseline: false, note: '' })
    await post({ op: 'research_cutoff', cutoffDate: '2026-11-19' })
    await post({ op: 'research_pre_add', caregiverCode: 'C01', recipientCode: 'A01', recordDate: '2026-10-05', recordText: '식사량 감소', source: 'paper' })
    await post({ op: 'research_pre_add', caregiverCode: 'C02', recipientCode: 'A02', recordDate: '2026-10-05', recordText: '동의 안 한 사람 기록', source: 'paper' })

    const daily = await researchExport(holder.client as never, 'research_daily')
    expect(daily.rows).toHaveLength(1) // C02(미동의)와 예전 60초 보고(transcript_only=false)는 빠짐
    expect(daily.rows[0].slice(1, 6)).toEqual(['사후', '기준일 2026-11-19', 'C01', 'A01', '2026-11-19'])

    const pre = await researchExport(holder.client as never, 'research_pre')
    expect(pre.rows).toHaveLength(1)
    expect(pre.rows[0].slice(1, 4)).toEqual(['사전', '기준일 2026-11-19', 'C01'])

    const weekly = await researchExport(holder.client as never, 'research_weekly')
    expect(weekly.rows).toHaveLength(0)

    const r = fakeResponse()
    await exportHandler(fakeRequest('GET', '/api/admin/export?type=research_pre', adminCookie) as never, r.res as never)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('text/csv')
  })
})
