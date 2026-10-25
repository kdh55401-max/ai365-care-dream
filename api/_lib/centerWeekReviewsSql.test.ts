import { readFileSync } from 'node:fs'
import { randomUUID as uuid } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
let db: PGlite
const digest = 'a'.repeat(64)
beforeAll(async () => {
  db = new PGlite(); await db.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true),('OFF',false)")
  for (const f of ['2026-10-22-center-operations.sql', '2026-10-25-center-week-reviews.sql']) await db.exec(readFileSync(new URL('../../db/migrations/' + f, import.meta.url), 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('reset role;truncate public.center_week_review_requests,public.center_week_reviews,public.center_operation_requests,public.center_visits,public.center_people') })
interface Saved { patientId: string; version: number; saved: { id: string; value: string; weekStart: string; reviewer: string; at: string; areas: string[] }[] }
async function save(input: object, org = 'TEST', actor = 'fake-admin') { return (await db.query<{ result: Saved }>('select public.save_center_week_review($1,$2,$3::jsonb) result', [org, actor, JSON.stringify(input)])).rows[0].result }
async function month(m: string, org = 'TEST') { return (await db.query<{ result: { month: string; patients: { patientId: string; version: number; entries: { weekStart: string }[] }[] } }>('select public.inspect_center_week_reviews($1,$2) result', [org, m])).rows[0].result }
async function fixture() {
  const patientId = uuid(), person = { id: patientId, kind: 'patient', name: '가상 대상', category: '기존', start: '2026-01-02', end: '2026-12-31', notes: {} }
  await db.query('select public.mutate_center_operation($1,$2,$3::jsonb)', ['TEST', 'fake-admin', JSON.stringify({ action: 'upsertPerson', requestId: uuid(), expectedVersion: 0, person })])
  const entry = { id: uuid(), weekStart: '2026-10-05', value: 'same_as_usual', areas: [] as string[], note: '', digest, documentId: uuid(), batch: false }
  return { patientId, entry, input: { requestId: uuid(), patientId, expectedVersion: 0, entries: [entry] } }
}
it('확인을 쌓아 저장하고 동일 요청을 재현하며 월별로 조회한다', async () => {
  const f = await fixture(), a = await save(f.input)
  expect(a.version).toBe(1); expect(a.saved[0]).toMatchObject({ id: f.entry.id, value: 'same_as_usual', weekStart: '2026-10-05', reviewer: 'fake-admin' }); expect(a.saved[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  expect(await save(f.input)).toEqual(a)
  const second = await save({ requestId: uuid(), patientId: f.patientId, expectedVersion: 1, entries: [{ ...f.entry, id: uuid(), weekStart: '2026-11-02', value: 'changed', areas: ['body', 'safety'], note: '식사량 감소' }] }); expect(second.version).toBe(2)
  const october = await month('2026-10'); expect(october.patients).toHaveLength(1); expect(october.patients[0].version).toBe(2); expect(october.patients[0].entries.map(e => e.weekStart)).toEqual(['2026-10-05'])
  expect((await month('2026-11')).patients[0].entries.map(e => e.weekStart)).toEqual(['2026-11-02']); expect((await month('2026-12')).patients[0].entries).toEqual([])
  expect((await db.query('select version from public.center_people where id=$1', [f.patientId])).rows[0]).toEqual({ version: 1 })
}, 20000)
it('같은 주를 다시 확인하면 쌓이고 최신이 뒤에 남는다(수정·삭제 없음)', async () => {
  const f = await fixture(); await save(f.input)
  const b = await save({ requestId: uuid(), patientId: f.patientId, expectedVersion: 1, entries: [{ ...f.entry, id: uuid(), value: 'changed', areas: ['rehab'], note: '보행 불안정' }] })
  const entries = (await month('2026-10')).patients[0].entries as unknown as { id: string; value: string }[]
  expect(entries.map(e => e.value)).toEqual(['same_as_usual', 'changed']); expect(b.saved[0].value).toBe('changed')
}, 20000)
it('버전 충돌·요청 재사용·다른 기관·꺼진 기관을 막는다', async () => {
  const f = await fixture(); await save(f.input)
  await expect(save({ ...f.input, requestId: uuid() })).rejects.toThrow('CENTER_WEEK_REVIEW_409')
  await expect(save(f.input, 'TEST', 'other')).rejects.toThrow('CENTER_WEEK_REVIEW_409')
  await expect(save({ ...f.input, entries: [{ ...f.entry, note: '다름' }] })).rejects.toThrow('CENTER_WEEK_REVIEW_409')
  await expect(save({ ...f.input, requestId: uuid(), expectedVersion: 1, entries: [f.entry] })).rejects.toThrow('CENTER_WEEK_REVIEW_409')
  await expect(save(f.input, 'OTHER')).rejects.toThrow('CENTER_WEEK_REVIEW_404'); await expect(save(f.input, 'OFF')).rejects.toThrow('CENTER_WEEK_REVIEW_403')
  await expect(month('2026-10', 'OFF')).rejects.toThrow('CENTER_WEEK_REVIEW_403')
}, 20000)
it('잘못된 값은 모두 원자적으로 거절한다', async () => {
  const f = await fixture(), e = f.entry
  const bad: object[] = [{ weekStart: '2026-02-30' }, { weekStart: '2026-10' }, { value: 'unknown' }, { value: 'same_as_usual', areas: ['body'] }, { value: 'changed', areas: ['body', 'body'] }, { value: 'changed', areas: ['mind'] }, { value: 'changed', areas: [1] }, { note: 'x'.repeat(501) }, { note: 2 }, { digest: 'xyz' }, { digest: '' }, { value: 'changed', digest: '' }, { documentId: 'not-a-uuid' }, { batch: 'yes' }, { reviewer: 'injected' }, { at: '2000-01-01T00:00:00Z' }]
  for (const patch of bad) await expect(save({ ...f.input, entries: [{ ...e, ...patch }] })).rejects.toThrow('CENTER_WEEK_REVIEW_400')
  await expect(save({ ...f.input, entries: [] })).rejects.toThrow('CENTER_WEEK_REVIEW_400'); await expect(save({ ...f.input, entries: Array.from({ length: 7 }, () => ({ ...e, id: uuid() })) })).rejects.toThrow('CENTER_WEEK_REVIEW_400')
  await expect(save({ ...f.input, extra: 1 })).rejects.toThrow('CENTER_WEEK_REVIEW_400'); await expect(save({ ...f.input, entries: [e, e] })).rejects.toThrow('CENTER_WEEK_REVIEW_409')
  await expect(save({ ...f.input, entries: [{ ...e, value: 'not_observed', digest: '', note: '입원' }] })).resolves.toMatchObject({ version: 1 })
  expect((await db.query<{ n: number }>('select count(*)::int n from public.center_week_reviews')).rows[0].n).toBe(1)
}, 30000)
it('한 번에 여러 주를 저장할 수 있다', async () => {
  const f = await fixture(), entries = ['2026-10-05', '2026-10-12', '2026-10-19'].map(weekStart => ({ ...f.entry, id: uuid(), weekStart, batch: true }))
  const result = await save({ ...f.input, entries }); expect(result.saved.map(s => s.weekStart)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
}, 20000)
