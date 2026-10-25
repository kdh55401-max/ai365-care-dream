import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true),('OFF',false)")
  for (const name of ['2026-10-22-center-operations.sql', '2026-10-22-center-visit-providers.sql', '2026-10-22-center-assignments.sql']) await db.exec(readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url), 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('truncate public.center_assignment_requests,public.center_patient_assignments,public.center_operation_requests,public.center_visits,public.center_people') })
async function op(input: object, org = 'TEST') { return db.query('select public.mutate_center_operation($1,$2,$3::jsonb)', [org, 'fake-admin', JSON.stringify(input)]) }
async function person(kind = 'worker', org = 'TEST') {
  const id = randomUUID(); await op({ action: 'upsertPerson', requestId: randomUUID(), expectedVersion: 0, person: { id, kind, name: '가상 대상', status: '', category: '', start: '', end: '', examination: '', notes: {} } }, org); return id
}
async function save(input: object, org = 'TEST', actor = 'fake-admin') { return (await db.query<{ result: { patientId: string; workerIds: string[]; version: number } }>('select public.save_center_assignment($1,$2,$3::jsonb) result', [org, actor, JSON.stringify(input)])).rows[0].result }
async function fixture() { return { patientId: await person('patient'), workerIds: [await person(), await person()], expectedVersion: 0, requestId: randomUUID() } }

it('복수 배정·동일 요청 재시도·새 버전 해제를 저장한다', async () => {
  const input = await fixture(), result = await save(input)
  expect(result).toEqual({ patientId: input.patientId, workerIds: input.workerIds, version: 1 }); expect(await save(input)).toEqual(result)
  const row = (await db.query<{ worker_ids: string[]; version: number }>('select worker_ids,version from public.center_patient_assignments')).rows[0]
  expect(row).toEqual({ worker_ids: input.workerIds, version: 1 })
  expect(await save({ ...input, workerIds: [], expectedVersion: 1, requestId: randomUUID() })).toMatchObject({ workerIds: [], version: 2 })
}, 15000)
it('옛 버전·요청 번호의 다른 본문/작성자 재사용을 거절한다', async () => {
  const input = await fixture(); await save(input)
  await expect(save({ ...input, requestId: randomUUID() })).rejects.toThrow('CENTER_ASSIGN_409')
  await expect(save({ ...input, workerIds: [] })).rejects.toThrow('CENTER_ASSIGN_409')
  await expect(save(input, 'TEST', 'another')).rejects.toThrow('CENTER_ASSIGN_409')
}, 15000)
it('기관·대상 종류·보관·중복 UUID 경계 실패는 배정과 영수증을 만들지 않는다', async () => {
  const input = await fixture(), foreign = await person('worker', 'OTHER'), archived = await person()
  await op({ action: 'archivePerson', id: archived, expectedVersion: 1, requestId: randomUUID() })
  for (const workerIds of [[foreign], [input.patientId], [archived], [randomUUID()], [input.workerIds[0], input.workerIds[0]], ['invalid']]) await expect(save({ ...input, workerIds })).rejects.toThrow('CENTER_ASSIGN_400')
  await expect(save({ ...input, patientId: input.workerIds[0] })).rejects.toThrow('CENTER_ASSIGN_400')
  await expect(save(input, 'OTHER')).rejects.toThrow('CENTER_ASSIGN_400')
  await expect(save(input, 'OFF')).rejects.toThrow('CENTER_ASSIGN_403')
  expect((await db.query<{ n: number }>('select count(*)::int n from public.center_assignment_requests')).rows[0].n).toBe(0)
}, 15000)
it('배정된 직원과 수급자의 보관을 막고 해제 후에는 허용한다', async () => {
  const input = await fixture(); await save(input)
  for (const id of [input.patientId, ...input.workerIds]) await expect(op({ action: 'archivePerson', id, expectedVersion: 1, requestId: randomUUID() })).rejects.toThrow('CENTER_OP_409')
  await save({ ...input, workerIds: [], expectedVersion: 1, requestId: randomUUID() })
  for (const id of [input.patientId, ...input.workerIds]) await op({ action: 'archivePerson', id, expectedVersion: 1, requestId: randomUUID() })
}, 15000)
it('브라우저 읽기·서비스 직접쓰기를 금지하고 RPC만 허용한다', async () => {
  const result = (await db.query<{ browser: boolean; direct: boolean; rpc: boolean }>("select has_table_privilege('anon','public.center_patient_assignments','SELECT') browser,has_table_privilege('service_role','public.center_patient_assignments','INSERT') direct,has_function_privilege('service_role','public.save_center_assignment(text,text,jsonb)','EXECUTE') rpc")).rows[0]
  expect(result).toEqual({ browser: false, direct: false, rpc: true })
})
