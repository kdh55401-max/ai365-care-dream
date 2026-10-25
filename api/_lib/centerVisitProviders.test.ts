import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

const baseSql = readFileSync(new URL('../../db/migrations/2026-10-22-center-operations.sql', import.meta.url), 'utf8')
const providerSql = readFileSync(new URL('../../db/migrations/2026-10-22-center-visit-providers.sql', import.meta.url), 'utf8')
let db: PGlite
async function database(providers = true) {
  const target = new PGlite()
  await target.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true);")
  await target.exec(baseSql)
  if (providers) await target.exec(providerSql)
  return target
}
beforeAll(async () => { db = await database() }, 30000)
beforeEach(async () => { await db.exec('truncate public.center_operation_requests,public.center_visits,public.center_people') })
afterAll(async () => { await db?.close() })
async function mutate(mutation: object, org = 'TEST', target = db) {
  return (await target.query<{ result: { person?: { version: number }; visit?: { workerIds: string[]; version: number; archived: boolean } } }>('select public.mutate_center_operation($1,$2,$3::jsonb) result', [org, 'fake-admin', JSON.stringify(mutation)])).rows[0].result
}
async function person(kind = 'worker', org = 'TEST', target = db) {
  const id = randomUUID()
  await mutate({ action: 'upsertPerson', requestId: randomUUID(), expectedVersion: 0, person: { id, kind, name: '가상 제공자', status: '', category: '', start: '', end: '', examination: '', notes: {} } }, org, target)
  return id
}
async function visit(target = db) {
  const workerId = await person('worker', 'TEST', target), secondary = await person('worker', 'TEST', target), patientId = await person('patient', 'TEST', target)
  return { id: randomUUID(), date: '2026-10-22', time: '09:00', minutes: 60, service: '목욕', patientId, workerId, workerIds: [workerId, secondary] }
}
const upsert = (value: object, expectedVersion = 0) => ({ action: 'upsertVisit', requestId: randomUUID(), expectedVersion, visit: value })

it('목욕 제공자 둘을 저장하고 재시도·개정·보조 담당자 보관 경계를 유지한다', async () => {
  const value = await visit(), request = upsert(value), first = await mutate(request)
  expect(first.visit).toMatchObject({ workerIds: value.workerIds, version: 1 })
  expect(await mutate(request)).toEqual(first)
  const updated = await mutate(upsert({ ...value, time: '10:00' }, 1))
  expect(updated.visit?.version).toBe(2)
  await expect(mutate({ action: 'archivePerson', requestId: randomUUID(), id: value.workerIds[1], expectedVersion: 1 })).rejects.toThrow('CENTER_OP_409')
  await mutate({ action: 'archiveVisit', requestId: randomUUID(), id: value.id, expectedVersion: 2 })
  await mutate({ action: 'archivePerson', requestId: randomUUID(), id: value.workerIds[1], expectedVersion: 1 })
}, 15000)

it('제공자 수·대표 순서·중복·형식 오류는 행과 요청 모두 남기지 않는다', async () => {
  const value = await visit()
  const { workerIds: omitted, ...withoutProviders } = value
  const invalid = [withoutProviders, ...[[], [value.workerId], [value.workerId, value.workerId], [...omitted, randomUUID()], [omitted[1], omitted[0]], [value.workerId, null], [value.workerId, 2], [value.workerId, 'invalid']].map(workerIds => ({ ...value, workerIds })), { ...value, service: '요양' }]
  const before = (await db.query<{ n: number }>('select count(*)::int n from public.center_operation_requests')).rows[0].n
  for (const candidate of invalid) await expect(mutate(upsert(candidate))).rejects.toThrow('CENTER_OP_400')
  expect((await db.query<{ n: number }>('select count(*)::int n from public.center_visits')).rows[0].n).toBe(0)
  expect((await db.query<{ n: number }>('select count(*)::int n from public.center_operation_requests')).rows[0].n).toBe(before)
}, 15000)

it('다른 기관·수급자·보관된 직원·없는 직원은 두 번째 제공자가 될 수 없다', async () => {
  const value = await visit(), foreign = await person('worker', 'OTHER'), archived = await person()
  await mutate({ action: 'archivePerson', requestId: randomUUID(), id: archived, expectedVersion: 1 })
  for (const id of [foreign, value.patientId, archived, randomUUID()]) await expect(mutate(upsert({ ...value, workerIds: [value.workerId, id] }))).rejects.toThrow('CENTER_OP_400')
}, 15000)

it.each(['요양', '간호', '기타'])('%s 한 명 자료는 기존 입력과 응답을 보존한다', async service => {
  const value = await visit(), { workerIds: _, ...legacy } = value
  expect((await mutate(upsert({ ...legacy, service }))).visit).toMatchObject({ workerIds: [value.workerId], version: 1 })
}, 15000)

it('이전 1인 목욕과 과거 응답을 보존하고 새 수정은 인원 검증, 순수 보관은 허용한다', async () => {
  const target = await database(false)
  try {
    const value = await visit(target), { workerIds: _, ...legacy } = value, request = upsert(legacy)
    const original = await mutate(request, 'TEST', target)
    await target.exec(providerSql)
    expect(await mutate(request, 'TEST', target)).toEqual(original)
    const stored = (await target.query<{ data: Record<string, unknown> }>('select data from public.center_visits where id=$1', [value.id])).rows[0].data
    expect(stored.workerIds).toBeUndefined()
    await expect(mutate(upsert({ ...legacy, time: '10:00' }, 1), 'TEST', target)).rejects.toThrow('CENTER_OP_400')
    const result = await mutate({ action: 'archiveVisit', requestId: randomUUID(), id: value.id, expectedVersion: 1 }, 'TEST', target)
    expect(result.visit).toMatchObject({ version: 2, archived: true })
  } finally { await target.close() }
}, 30000)
