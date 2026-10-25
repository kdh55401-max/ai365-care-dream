import { readFileSync } from 'node:fs'
import { randomUUID as uuid } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { MonthScheduleState } from '../../shared/centerMonthSchedule.js'
let db: PGlite
beforeAll(async () => {
  db = new PGlite(); await db.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true),('OFF',false)")
  for (const file of ['2026-10-22-center-operations.sql', '2026-10-22-center-visit-providers.sql', '2026-10-22-center-weekly-plans.sql', '2026-10-23-center-plan-application.sql', '2026-10-23-center-month-schedule.sql']) await db.exec(readFileSync(new URL('../../db/migrations/' + file, import.meta.url), 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('truncate public.center_monthly_schedule_requests,public.center_monthly_schedule_locks,public.center_plan_application_requests,public.center_plan_visit_origins,public.center_weekly_plan_requests,public.center_weekly_plans,public.center_operation_requests,public.center_visits,public.center_people') })
const op = (input: object) => db.query('select public.mutate_center_operation($1,$2,$3::jsonb)', ['TEST', 'fake-admin', JSON.stringify(input)])
async function person(kind: string) { const id = uuid(); await op({ action: 'upsertPerson', requestId: uuid(), expectedVersion: 0, person: { id, kind, name: '가상 검토', status: '', category: '', start: '', end: '', examination: '', notes: {} } }); return id }
async function fixture() { return { id: uuid(), workerId: await person('worker'), patientId: await person('patient'), date: '2026-10-22', time: '09:00', minutes: 60, service: '요양' } }
async function inspect(month = '2026-10', org = 'TEST') { return (await db.query<{ result: MonthScheduleState }>('select public.inspect_center_month_schedule($1,$2) result', [org, month])).rows[0].result }
async function save(input: object, org = 'TEST', actor = 'fake-admin') { return (await db.query<{ result: MonthScheduleState }>('select public.set_center_month_schedule_lock($1,$2,$3::jsonb) result', [org, actor, JSON.stringify(input)])).rows[0].result }
const input = (s: MonthScheduleState, locked: boolean) => ({ month: s.month, expectedVersion: s.version, snapshot: s.snapshot, locked, requestId: uuid() })
it('빈 월·추가·수정·보관에 의한 낡은 검토를 거절한다', async () => {
  const visit = await fixture(), empty = await inspect()
  await expect(save(input(empty, true))).rejects.toThrow('CENTER_MONTH_400')
  await op({ action: 'upsertVisit', visit, expectedVersion: 0, requestId: uuid() })
  await expect(save(input(empty, true))).rejects.toThrow('CENTER_MONTH_409')
  const before = await inspect()
  await op({ action: 'upsertVisit', visit: { ...visit, time: '10:00' }, expectedVersion: 1, requestId: uuid() })
  await expect(save(input(before, true))).rejects.toThrow('CENTER_MONTH_409')
  const after = await inspect()
  await op({ action: 'archiveVisit', id: visit.id, expectedVersion: 2, requestId: uuid() })
  await expect(save(input(after, true))).rejects.toThrow('CENTER_MONTH_409')
}, 15000)
it('잠금은 모든 일정 변경 경로를 막고 해제 후 다시 허용한다', async () => {
  const visit = await fixture(); await op({ action: 'upsertVisit', visit, expectedVersion: 0, requestId: uuid() })
  const request = input(await inspect(), true), locked = await save(request)
  expect(await save(request)).toEqual(locked)
  await expect(save(request, 'TEST', 'other')).rejects.toThrow('CENTER_MONTH_409')
  for (const mutation of [{ action: 'upsertVisit', visit: { ...visit, id: uuid() }, expectedVersion: 0 }, { action: 'upsertVisit', visit: { ...visit, date: '2026-11-01' }, expectedVersion: 1 }, { action: 'archiveVisit', id: visit.id, expectedVersion: 1 }]) await expect(op({ ...mutation, requestId: uuid() })).rejects.toThrow('CENTER_MONTH_409')
  expect((await db.query<{ n: number }>('select count(*)::int n from public.center_visits')).rows[0].n).toBe(1)
  await save(input(await inspect(), false))
  await op({ action: 'upsertVisit', visit: { ...visit, time: '10:00' }, expectedVersion: 1, requestId: uuid() })
  expect(await inspect()).toMatchObject({ locked: false, version: 2, snapshot: [{ id: visit.id, version: 2 }] })
}, 15000)
it('월 경계 야간은 양쪽 월의 잠금을 지키고 기관·권한을 격리한다', async () => {
  const visit = { ...await fixture(), date: '2026-10-31', time: '23:30', minutes: 60 }
  await op({ action: 'upsertVisit', visit, expectedVersion: 0, requestId: uuid() })
  expect((await inspect('2026-11')).snapshot).toHaveLength(1)
  await save(input(await inspect('2026-11'), true))
  await expect(op({ action: 'archiveVisit', id: visit.id, expectedVersion: 1, requestId: uuid() })).rejects.toThrow('CENTER_MONTH_409')
  expect((await inspect('2026-11', 'OTHER')).snapshot).toEqual([])
  await expect(inspect('2026-11', 'OFF')).rejects.toThrow('CENTER_MONTH_403')
  const row = (await db.query("select has_table_privilege('anon','public.center_monthly_schedule_locks','SELECT') browser,has_table_privilege('service_role','public.center_monthly_schedule_locks','UPDATE') direct,has_function_privilege('service_role','public.set_center_month_schedule_lock(text,text,jsonb)','EXECUTE') rpc")).rows[0]
  expect(row).toEqual({ browser: false, direct: false, rpc: true })
}, 15000)
it('주간계획 월 반영도 잠금에서 차단되어 일정·origin을 부분 저장하지 않는다', async () => {
  const visit = await fixture(); await op({ action: 'upsertVisit', visit, expectedVersion: 0, requestId: uuid() })
  await save(input(await inspect(), true))
  const plan = { id: uuid(), patientId: visit.patientId, month: '2026-10', note: '', entries: [] as object[] }
  const planSave = (version: number) => db.query('select public.save_center_weekly_plan($1,$2,$3::jsonb)', ['TEST', 'fake-admin', JSON.stringify({ action: 'save', plan, expectedVersion: version, requestId: uuid() })])
  await planSave(0)
  plan.entries.push({ id: uuid(), service: '요양', weekdays: [1], start: '09:00', end: '10:00', workerIds: [visit.workerId], nursingDual: false }); await planSave(1)
  await expect(db.query('select public.apply_center_weekly_plan($1,$2,$3::jsonb)', ['TEST', 'fake-admin', JSON.stringify({ planId: plan.id, expectedVersion: 2, requestId: uuid() })])).rejects.toThrow('CENTER_MONTH_409')
  expect((await db.query<{ n: number }>('select count(*)::int n from public.center_visits')).rows[0].n).toBe(1)
  expect((await db.query<{ n: number }>('select count(*)::int n from public.center_plan_visit_origins')).rows[0].n).toBe(0)
}, 15000)
