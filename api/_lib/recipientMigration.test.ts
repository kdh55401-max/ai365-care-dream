/** db/migrations/2026-10-02-recipient-registration.sql 을 기본 스키마 위에 실제 Postgres 엔진(PGlite)으로 실행해
 * 등록·배정의 원자성, 코드 자동 번호, 중복 방지, 배정 이력 보존, 과거 보고 불변을 확인한다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8').replace(/create extension[^;]*;/gi, '')

let db: PGlite
let seq = 0
const rid = () => `req-${Date.now()}-${++seq}`

type Result = { status: string; code?: string; message?: string }
async function register(p: Record<string, unknown>): Promise<Result> {
  return (await db.query<{ r: Result }>('select recipient_register($1::jsonb) as r', [JSON.stringify({ request_id: rid(), ...p })])).rows[0].r
}
async function update(p: Record<string, unknown>): Promise<Result> {
  return (await db.query<{ r: Result }>('select recipient_update($1::jsonb) as r', [JSON.stringify({ request_id: rid(), ...p })])).rows[0].r
}
async function assigned(recipient: string): Promise<Array<{ c: string; active: boolean }>> {
  return (await db.query<{ c: string; active: boolean }>('select caregiver_code as c, active from caregiver_assignments where recipient_code = $1 order by caregiver_code', [recipient])).rows
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(read('db/schema.sql'))
  await db.exec(`insert into caregiver_assignments (caregiver_code, recipient_code) values ('C01', 'A01')`)
  await db.exec(`insert into reports (participant_code, recipient_code, report_type, report_date, status) values ('C01', 'A01', 'daily', '2026-10-01', 'submitted')`)
  await db.exec(read('db/migrations/2026-10-02-recipient-registration.sql'))
  await db.exec(read('db/migrations/2026-10-02-recipient-registration.sql')) // 다시 실행해도 안전
}, 60_000)

describe('수급자 등록 마이그레이션', () => {
  it('기존 수급자·배정·보고를 그대로 두고 표시명은 비어 있다', async () => {
    const r = await db.query<{ code: string; display_name: string | null; active: boolean }>('select code, display_name, active from recipients order by code')
    expect(r.rows).toHaveLength(9)
    expect(r.rows.every((x) => x.display_name === null && x.active)).toBe(true)
    expect(await assigned('A01')).toEqual([{ c: 'C01', active: true }])
  })

  it('등록은 다음 A 코드를 자동으로 주고 배정까지 한 번에 저장한다', async () => {
    const res = await register({ display_name: '햇살', caregiver_codes: ['C02', 'C03'] })
    expect(res).toMatchObject({ status: 'ok', code: 'A10' })
    expect(await assigned('A10')).toEqual([{ c: 'C02', active: true }, { c: 'C03', active: true }])
    const row = (await db.query<{ display_name: string; active: boolean }>(`select display_name, active from recipients where code = 'A10'`)).rows[0]
    expect(row).toEqual({ display_name: '햇살', active: true })
  })

  it('담당자 없이도 등록되고, 같은 요청을 다시 보내면 한 건만 저장된다', async () => {
    const id = rid()
    const first = await register({ request_id: id, display_name: '미배정', caregiver_codes: [] })
    expect(first.status).toBe('ok')
    const again = await register({ request_id: id, display_name: '미배정', caregiver_codes: [] })
    expect(again).toMatchObject({ status: 'duplicate', code: first.code })
    expect((await db.query(`select 1 from recipients where display_name = '미배정'`)).rows).toHaveLength(1)
    expect(await assigned(first.code!)).toEqual([])
  })

  it('없는·사용 중지된 요양보호사가 하나라도 있으면 수급자도 남지 않는다', async () => {
    const before = (await db.query<{ n: number }>('select count(*)::int as n from recipients')).rows[0].n
    expect((await register({ display_name: '실패', caregiver_codes: ['C01', 'C99'] })).status).toBe('invalid_caregiver')
    await db.exec(`update participants set active = false where code = 'C09'`)
    expect((await register({ display_name: '실패2', caregiver_codes: ['C09'] })).status).toBe('invalid_caregiver')
    expect((await db.query<{ n: number }>('select count(*)::int as n from recipients')).rows[0].n).toBe(before)
    expect((await db.query(`select 1 from caregiver_assignments where recipient_code not in (select code from recipients)`)).rows).toHaveLength(0)
  })

  it('표시명이 비었거나 너무 길면 거부한다', async () => {
    expect((await register({ display_name: '   ' })).status).toBe('invalid')
    expect((await register({ display_name: 'ㄱ'.repeat(31) })).status).toBe('invalid')
  })

  it('직접 지정한 코드가 이미 있으면 거부하고, 형식이 틀리면 거부한다', async () => {
    expect((await register({ display_name: '중복', code: 'A01' })).status).toBe('duplicate_code')
    expect((await register({ display_name: '형식', code: 'B01' })).status).toBe('invalid')
    expect(await register({ display_name: '지정', code: 'A50' })).toMatchObject({ status: 'ok', code: 'A50' })
  })

  it('동시에 여러 건을 등록해도 코드가 겹치지 않는다', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => register({ display_name: `동시${i}`, caregiver_codes: ['C04'] })))
    expect(results.every((r) => r.status === 'ok')).toBe(true)
    const codes = results.map((r) => r.code)
    expect(new Set(codes).size).toBe(6)
  })
})

describe('수급자 수정·배정 변경', () => {
  it('담당자를 바꿔도 배정 행을 지우지 않고 해제로 남기며, 과거 보고의 수급자 연결은 그대로다', async () => {
    expect((await update({ code: 'A01', caregiver_codes: ['C02'] })).status).toBe('ok')
    expect(await assigned('A01')).toEqual([{ c: 'C01', active: false }, { c: 'C02', active: true }])
    const rep = (await db.query<{ recipient_code: string; participant_code: string }>(`select recipient_code, participant_code from reports`)).rows
    expect(rep).toEqual([{ recipient_code: 'A01', participant_code: 'C01' }])
    // 다시 맡기면 같은 행이 되살아난다(중복 행 없음).
    expect((await update({ code: 'A01', caregiver_codes: ['C01', 'C02'] })).status).toBe('ok')
    expect(await assigned('A01')).toEqual([{ c: 'C01', active: true }, { c: 'C02', active: true }])
  })

  it('전부 해제하면 담당자 미배정이 되고, 표시명·활성 상태를 바꿀 수 있다', async () => {
    expect((await update({ code: 'A02', caregiver_codes: [], display_name: '바람', active: false })).status).toBe('ok')
    const row = (await db.query<{ display_name: string; active: boolean }>(`select display_name, active from recipients where code = 'A02'`)).rows[0]
    expect(row).toEqual({ display_name: '바람', active: false })
  })

  it('보내지 않은 항목은 바꾸지 않는다', async () => {
    await update({ code: 'A03', display_name: '구름', caregiver_codes: ['C05'] })
    expect((await update({ code: 'A03', active: false })).status).toBe('ok')
    const row = (await db.query<{ display_name: string }>(`select display_name from recipients where code = 'A03'`)).rows[0]
    expect(row.display_name).toBe('구름')
    expect(await assigned('A03')).toEqual([{ c: 'C05', active: true }])
  })

  it('먼저 바뀐 뒤 옛 화면에서 저장하면 충돌로 거부하고, 같은 요청 재시도는 한 번만 반영한다', async () => {
    const stamp = (await db.query<{ t: string }>(`select updated_at::text as t from recipients where code = 'A04'`)).rows[0].t
    const id = rid()
    expect((await update({ request_id: id, code: 'A04', display_name: '첫째', expected_updated_at: stamp })).status).toBe('ok')
    expect((await update({ request_id: id, code: 'A04', display_name: '첫째', expected_updated_at: stamp })).status).toBe('duplicate')
    expect((await update({ code: 'A04', display_name: '둘째', expected_updated_at: stamp })).status).toBe('conflict')
    expect((await db.query<{ display_name: string }>(`select display_name from recipients where code = 'A04'`)).rows[0].display_name).toBe('첫째')
  })

  it('없는 수급자·사용 중지된 요양보호사 배정은 거부하고 아무것도 바꾸지 않는다', async () => {
    expect((await update({ code: 'A99', display_name: 'x' })).status).toBe('not_found')
    expect((await update({ code: 'A05', display_name: '변경시도', caregiver_codes: ['C09'] })).status).toBe('invalid_caregiver')
    const row = (await db.query<{ display_name: string | null }>(`select display_name from recipients where code = 'A05'`)).rows[0]
    expect(row.display_name).toBeNull()
  })

  it('이력은 수정·삭제할 수 없다', async () => {
    await expect(db.exec(`delete from recipient_admin_log`)).rejects.toThrow(/추가만/)
    const log = (await db.query<{ n: number }>('select count(*)::int as n from recipient_admin_log')).rows[0].n
    expect(log).toBeGreaterThan(0)
  })
})
