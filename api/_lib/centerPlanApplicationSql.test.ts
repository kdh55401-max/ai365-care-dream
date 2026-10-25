import { readFileSync } from 'node:fs'
import { randomUUID as uuid } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { PlanApplicationResult } from '../../shared/centerPlanApplication.js'
import type { WeeklyPlanFields, StoredWeeklyPlan } from '../../shared/centerWeeklyPlanStore.js'
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true)")
  for (const file of ['2026-10-22-center-operations.sql', '2026-10-22-center-visit-providers.sql', '2026-10-22-center-weekly-plans.sql', '2026-10-23-center-plan-application.sql']) await db.exec(readFileSync(new URL('../../db/migrations/' + file, import.meta.url), 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('truncate public.center_plan_application_requests,public.center_plan_visit_origins,public.center_weekly_plan_requests,public.center_weekly_plans,public.center_operation_requests,public.center_visits,public.center_people') })
const op = (input: object) => db.query('select public.mutate_center_operation($1,$2,$3::jsonb)', ['TEST', 'fake-admin', JSON.stringify(input)])
async function person(kind = 'worker') { const id = uuid(); await op({ action: 'upsertPerson', requestId: uuid(), expectedVersion: 0, person: { id, kind, name: '가상 반영 대상', status: '', category: '', start: '', end: '', examination: '', notes: {} } }); return id }
async function save(plan: WeeklyPlanFields, version: number) { return (await db.query<{ result: StoredWeeklyPlan }>('select public.save_center_weekly_plan($1,$2,$3::jsonb) result', ['TEST', 'fake-admin', JSON.stringify({ action: 'save', requestId: uuid(), expectedVersion: version, plan })])).rows[0].result }
async function apply(input: object, org = 'TEST', actor = 'fake-admin') { return (await db.query<{ result: PlanApplicationResult }>('select public.apply_center_weekly_plan($1,$2,$3::jsonb) result', [org, actor, JSON.stringify(input)])).rows[0].result }
async function fixture() {
  const worker = await person(), patient = await person('patient'), fields: WeeklyPlanFields = { id: uuid(), patientId: patient, month: '2026-10', note: '', entries: [] }
  await save(fields, 0)
  const plan = await save({ ...fields, entries: [{ id: uuid(), service: '요양', weekdays: [1], start: '09:00', end: '10:00', workerIds: [worker], nursingDual: false }] }, 1)
  const input = { planId: plan.id, expectedVersion: 2, requestId: uuid() }
  return { plan, fields, input, worker, patient }
}
async function visit(patientId: string, workerId: string, date: string, time = '09:30', minutes = 60) { const id = uuid(); await op({ action: 'upsertVisit', expectedVersion: 0, requestId: uuid(), visit: { id, patientId, workerId, workerIds: [workerId], service: '요양', date, time, minutes } }); return id }
async function count(table: string) { return (await db.query<{ n: number }>('select count(*)::int n from public.' + table)).rows[0].n }
it('월 전개·replay·CAS와 편집/보관 이후 재생성 방지', async () => {
  const { plan, input } = await fixture(), result = await apply(input)
  expect(result).toMatchObject({ createdCount: 4, skippedCount: 0 }); expect(await apply(input)).toEqual(result)
  await expect(apply(input, 'TEST', 'other')).rejects.toThrow('CENTER_APPLY_409')
  await expect(apply({ ...input, expectedVersion: 1, requestId: uuid() })).rejects.toThrow('CENTER_APPLY_409')
  await op({ action: 'archiveVisit', id: result.visitIds[0], expectedVersion: 1, requestId: uuid() })
  const row = (await db.query<{ data: Record<string, unknown> }>('select data from public.center_visits where id=$1', [result.visitIds[1]])).rows[0]
  await op({ action: 'upsertVisit', visit: { ...row.data, time: '11:00' }, expectedVersion: 1, requestId: uuid() })
  expect(await apply({ ...input, requestId: uuid() })).toMatchObject({ createdCount: 0, skippedCount: 4 })
  expect(await count('center_visits')).toBe(4)
  expect(await count('center_plan_visit_origins')).toBe(4)
  expect(plan.version).toBe(2)
}, 15000)
it('뒤쪽 날짜 충돌은 앞선 삽입·origin·receipt까지 rollback한다', async () => {
  const { input, worker, patient } = await fixture()
  await visit(patient, worker, '2026-10-26')
  await expect(apply(input)).rejects.toThrow('CENTER_APPLY_409')
  expect(await count('center_visits')).toBe(1); expect(await count('center_plan_visit_origins')).toBe(0); expect(await count('center_plan_application_requests')).toBe(0)
}, 15000)
it('출처 없는 동일 일정은 보존하고 재반영 후 보관해도 재생성하지 않는다', async () => {
  const { input, worker, patient } = await fixture(), id = await visit(patient, worker, '2026-10-05', '09:00')
  expect(await apply(input)).toMatchObject({ createdCount: 3, skippedCount: 1 })
  await op({ action: 'archiveVisit', id, expectedVersion: 1, requestId: uuid() })
  expect(await apply({ ...input, requestId: uuid() })).toMatchObject({ createdCount: 0, skippedCount: 4 })
  expect(await count('center_visits')).toBe(4)
}, 15000)
it('야간 전월 일정과 공유 직원 충돌은 차단하고 경계접촉은 허용한다', async () => {
  const { plan, fields, input, worker } = await fixture(), otherPatient = await person('patient')
  const night = { ...plan.entries[0], weekdays: [4], start: '00:00', end: '01:00' }
  await save({ ...fields, entries: [night] }, 2)
  const id = await visit(otherPatient, worker, '2026-09-30', '23:30', 60)
  await expect(apply({ ...input, expectedVersion: 3 })).rejects.toThrow('CENTER_APPLY_409')
  await op({ action: 'archiveVisit', id, expectedVersion: 1, requestId: uuid() })
  await visit(otherPatient, worker, '2026-09-30', '23:00', 60)
  expect(await apply({ ...input, expectedVersion: 3 })).toMatchObject({ createdCount: 5 })
}, 15000)
it('목욕 보조 제공자 충돌과 기관/직접쓰기 경계를 지킨다', async () => {
  const { plan, fields, input, worker } = await fixture(), second = await person(), other = await person('patient')
  await save({ ...fields, entries: [{ ...plan.entries[0], service: '목욕', workerIds: [worker, second] }] }, 2)
  await visit(other, second, '2026-10-26')
  await expect(apply({ ...input, expectedVersion: 3 })).rejects.toThrow('CENTER_APPLY_409')
  await expect(apply(input, 'OTHER')).rejects.toThrow('CENTER_APPLY_404')
  const row = (await db.query("select has_table_privilege('anon','public.center_plan_visit_origins','SELECT') browser,has_table_privilege('service_role','public.center_plan_visit_origins','INSERT') direct,has_function_privilege('service_role','public.apply_center_weekly_plan(text,text,jsonb)','EXECUTE') rpc")).rows[0]
  expect(row).toEqual({ browser: false, direct: false, rpc: true })
}, 15000)
