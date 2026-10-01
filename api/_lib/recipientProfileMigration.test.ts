/** db/migrations/2026-10-03-erp-recipient-profile.sql 을 실제 Postgres 엔진(PGlite)에서 실행해, 인적사항 저장이
 * 등록·배정과 한 트랜잭션인지, 인정번호 중복·형식 오류가 전체를 취소하는지, 이력에 값이 남지 않는지 확인한다. */
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
const call = async (fn: string, p: Record<string, unknown>): Promise<Result> =>
  (await db.query<{ r: Result }>(`select ${fn}($1::jsonb) as r`, [JSON.stringify({ request_id: rid(), ...p })])).rows[0].r

beforeAll(async () => {
  db = new PGlite()
  await db.exec(read('db/schema.sql'))
  await db.exec(read('db/migrations/2026-10-02-recipient-registration.sql'))
  await db.exec(read('db/migrations/2026-10-03-erp-recipient-profile.sql'))
  await db.exec(read('db/migrations/2026-10-03-erp-recipient-profile.sql')) // 다시 실행해도 안전
}, 60_000)

const PROFILE = { full_name: '가나다', birth_date: '1956-02-24', ltc_number: 'L0000000001-001', ltc_grade: '4등급', ltc_valid_from: '2025-02-25', ltc_valid_to: '2029-02-24', address: '가상시 가상구 1', phone: '051-000-0000' }

describe('수급자 인적사항 마이그레이션', () => {
  it('등록과 인적사항·배정이 함께 저장되고, 기존 수급자는 인적사항이 비어 있다', async () => {
    expect((await db.query(`select 1 from recipients where code = 'A01' and ltc_number is null and full_name is null`)).rows).toHaveLength(1)
    const res = await call('recipient_register_erp', { display_name: '가나다', caregiver_codes: ['C02'], profile: PROFILE })
    expect(res).toMatchObject({ status: 'ok', code: 'A10' })
    const row = (await db.query<Record<string, string>>(`select full_name, ltc_number, ltc_grade, to_char(ltc_valid_to, 'YYYY-MM-DD') as valid_to from recipients where code = 'A10'`)).rows[0]
    expect(row).toEqual({ full_name: '가나다', ltc_number: 'L0000000001-001', ltc_grade: '4등급', valid_to: '2029-02-24' })
    expect((await db.query(`select 1 from caregiver_assignments where recipient_code = 'A10' and caregiver_code = 'C02' and active`)).rows).toHaveLength(1)
  })

  it('같은 장기요양인정번호는 다시 등록할 수 없고, 그때 수급자·배정도 남지 않는다', async () => {
    const before = (await db.query(`select count(*)::int as n from recipients`)).rows[0] as { n: number }
    const res = await call('recipient_register_erp', { display_name: '다른이', caregiver_codes: ['C03'], profile: { ...PROFILE, full_name: '다른이' } })
    expect(res.status).toBe('duplicate_ltc')
    const after = (await db.query(`select count(*)::int as n from recipients`)).rows[0] as { n: number }
    expect(after.n).toBe(before.n)
    expect((await db.query(`select 1 from caregiver_assignments where caregiver_code = 'C03' and recipient_code = 'A11'`)).rows).toHaveLength(0)
  })

  it('형식이 틀린 인정번호·날짜는 사유와 함께 거부되고 전체가 취소된다', async () => {
    const bad = await call('recipient_register_erp', { display_name: '오류', caregiver_codes: [], profile: { ltc_number: 'L123' } })
    expect(bad).toMatchObject({ status: 'invalid' })
    expect(bad.message).toContain('장기요양인정번호')
    const badDate = await call('recipient_register_erp', { display_name: '오류', caregiver_codes: [], profile: { birth_date: '1956-13-40' } })
    expect(badDate.status).toBe('invalid')
    expect((await db.query(`select 1 from recipients where display_name = '오류'`)).rows).toHaveLength(0)
  })

  it('수정은 보낸 항목만 바꾸고, 같은 요청 재전송은 한 번만 반영하며, 이력에는 값이 아니라 항목 이름만 남는다', async () => {
    const id = rid()
    const first = await call('recipient_update_erp', { request_id: id, code: 'A10', profile: { ltc_grade: '3등급' } })
    expect(first.status).toBe('ok')
    const again = await call('recipient_update_erp', { request_id: id, code: 'A10', profile: { ltc_grade: '2등급' } })
    expect(again.status).toBe('duplicate')
    const row = (await db.query<Record<string, string>>(`select ltc_grade, ltc_number, full_name from recipients where code = 'A10'`)).rows[0]
    expect(row).toEqual({ ltc_grade: '3등급', ltc_number: 'L0000000001-001', full_name: '가나다' })
    const logs = (await db.query<{ detail: unknown }>(`select detail from recipient_admin_log where recipient_code = 'A10' order by id`)).rows
    expect(JSON.stringify(logs)).toContain('ltc_grade')
    expect(JSON.stringify(logs)).not.toContain('L0000000001')
    expect(JSON.stringify(logs)).not.toContain('3등급')
  })

  it('다른 수급자의 인정번호로 바꾸려 하면 거부되고 원래 값이 유지된다', async () => {
    const other = await call('recipient_register_erp', { display_name: '둘째', caregiver_codes: [], profile: { ...PROFILE, full_name: '둘째', ltc_number: 'L0000000002-001' } })
    expect(other.status).toBe('ok')
    const clash = await call('recipient_update_erp', { code: other.code, profile: { ltc_number: 'L0000000001-001' } })
    expect(clash.status).toBe('duplicate_ltc')
    expect((await db.query(`select ltc_number from recipients where code = $1`, [other.code])).rows[0]).toEqual({ ltc_number: 'L0000000002-001' })
  })

  it('빈 값을 보내면 그 항목만 비운다', async () => {
    const res = await call('recipient_update_erp', { code: 'A10', profile: { phone: '' } })
    expect(res.status).toBe('ok')
    expect((await db.query(`select phone, address from recipients where code = 'A10'`)).rows[0]).toEqual({ phone: null, address: '가상시 가상구 1' })
  })
})
