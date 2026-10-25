import { readFileSync } from 'node:fs'
import { randomUUID as uuid } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { StoredWeeklyPlan, WeeklyPlanFields } from '../../shared/centerWeeklyPlanStore.js'
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true),('OFF',false)")
  for (const file of ['2026-10-22-center-operations.sql', '2026-10-22-center-weekly-plans.sql']) await db.exec(readFileSync(new URL('../../db/migrations/' + file, import.meta.url), 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('truncate public.center_weekly_plan_requests,public.center_weekly_plans,public.center_operation_requests,public.center_visits,public.center_people') })
const op = (input: object, org = 'TEST') => db.query('select public.mutate_center_operation($1,$2,$3::jsonb)', [org, 'fake-admin', JSON.stringify(input)])
async function person(kind = 'worker', org = 'TEST') { const id = uuid(); await op({ action: 'upsertPerson', requestId: uuid(), expectedVersion: 0, person: { id, kind, name: '가상 계획 대상', status: '', category: '', start: '', end: '', examination: '', notes: {} } }, org); return id }
async function save(input: object, org = 'TEST', actor = 'fake-admin') { return (await db.query<{ result: StoredWeeklyPlan }>('select public.save_center_weekly_plan($1,$2,$3::jsonb) result', [org, actor, JSON.stringify(input)])).rows[0].result }
const mutation = (plan: WeeklyPlanFields, version: number) => ({ action: 'save', requestId: uuid(), expectedVersion: version, plan: { id: plan.id, patientId: plan.patientId, month: plan.month, note: plan.note, entries: plan.entries } })
async function fixture() {
  const workers = [await person(), await person()], plan: WeeklyPlanFields = { id: uuid(), patientId: await person('patient'), month: '2026-10', note: '', entries: [] }
  const request = mutation(plan, 0), saved = await save(request)
  const entry = { id: uuid(), service: '요양' as const, weekdays: [1, 3], start: '09:00', end: '10:00', workerIds: [workers[0]], nursingDual: false }
  return { workers, plan: saved, request, entry }
}
it('단일 항목 저장·동일 요청 재시도·CAS와 빈 계획 선행을 검증한다', async () => {
  const { plan, entry, request } = await fixture(), input = mutation({ ...plan, entries: [entry] }, 1), saved = await save(input)
  expect(saved.version).toBe(2); expect(await save(input)).toEqual(saved); expect(await save(request)).toEqual(plan)
  await expect(save({ ...input, requestId: uuid() })).rejects.toThrow('CENTER_PLAN_409')
  await expect(save(input, 'TEST', 'other')).rejects.toThrow('CENTER_PLAN_409')
  await expect(save(mutation({ ...plan, id: uuid(), entries: [entry] }, 0))).rejects.toThrow('CENTER_PLAN_400')
  await expect(save(mutation({ ...saved, entries: [entry, { ...entry, id: uuid() }, { ...entry, id: uuid() }] }, 2))).rejects.toThrow('CENTER_PLAN_400')
}, 15000)
it('공통요일 겹침을 막고 경계접촉·짧은 간격은 허용한다', async () => {
  const { plan, entry } = await fixture(), saved = await save(mutation({ ...plan, entries: [entry] }, 1))
  await expect(save(mutation({ ...saved, entries: [entry, { ...entry, id: uuid(), start: '09:30', end: '10:30' }] }, 2))).rejects.toThrow('CENTER_PLAN_400 overlapping')
  expect((await save(mutation({ ...saved, entries: [entry, { ...entry, id: uuid(), start: '10:00', end: '10:30' }] }, 2))).version).toBe(3)
}, 15000)
it('목욕 제공자 2명·동일 기관과 계획 보관 후 참조 해제를 검증한다', async () => {
  const { plan, workers, entry } = await fixture(), bath = { ...entry, service: '목욕' as const, workerIds: workers }
  const foreign = await person('worker', 'OTHER')
  for (const workerIds of [[workers[0]], [workers[0], workers[0]], [workers[0], foreign], [workers[0], plan.patientId]]) await expect(save(mutation({ ...plan, entries: [{ ...bath, workerIds }] }, 1))).rejects.toThrow('CENTER_PLAN_400')
  const saved = await save(mutation({ ...plan, entries: [bath] }, 1))
  expect(saved.entries[0].workerIds).toEqual(workers)
  for (const id of [plan.patientId, ...workers]) await expect(op({ action: 'archivePerson', id, requestId: uuid(), expectedVersion: 1 })).rejects.toThrow('CENTER_OP_409')
  const archive = { action: 'archive', id: plan.id, expectedVersion: 2, requestId: uuid() }
  expect(await save(archive)).toMatchObject({ archived: true, version: 3 }); expect(await save(archive)).toMatchObject({ version: 3 })
  for (const id of [plan.patientId, ...workers]) await op({ action: 'archivePerson', id, requestId: uuid(), expectedVersion: 1 })
}, 15000)
it('기관과 RPC 권한 경계를 유지한다', async () => {
  const { plan } = await fixture()
  await expect(save(mutation(plan, 1), 'OTHER')).rejects.toThrow('CENTER_PLAN_404')
  await expect(save(mutation(plan, 1), 'OFF')).rejects.toThrow('CENTER_PLAN_403')
  const row = (await db.query("select has_table_privilege('anon','public.center_weekly_plans','SELECT') browser,has_table_privilege('service_role','public.center_weekly_plans','UPDATE') direct,has_function_privilege('service_role','public.save_center_weekly_plan(text,text,jsonb)','EXECUTE') rpc,has_function_privilege('authenticated','public.save_center_weekly_plan(text,text,jsonb)','EXECUTE') browser_rpc")).rows[0]
  expect(row).toEqual({ browser: false, direct: false, rpc: true, browser_rpc: false })
}, 15000)
