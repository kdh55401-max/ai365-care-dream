import { readFileSync } from 'node:fs'
import { randomUUID as uuid } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { PatientRecognitionResult, PatientRecognitionsState } from '../../shared/centerPatientRecognitions.js'
let db: PGlite
beforeAll(async () => { db = new PGlite(); await db.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true),('OFF',false)"); for (const file of ['2026-10-22-center-operations.sql', '2026-10-23-center-patient-recognitions.sql']) await db.exec(readFileSync(new URL('../../db/migrations/' + file, import.meta.url), 'utf8')) }, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('reset role; truncate public.center_patient_recognition_requests,public.center_patient_recognitions,public.center_operation_requests,public.center_visits,public.center_people') })
const op = (v: object) => db.query('select public.mutate_center_operation($1,$2,$3::jsonb)', ['TEST', 'fake-admin', JSON.stringify(v)])
async function inspect(id: string) { return (await db.query<{ result: PatientRecognitionsState }>('select public.inspect_center_patient_recognition($1,$2) result', ['TEST', id])).rows[0].result }
async function save(v: object, org = 'TEST', actor = 'fake-admin') { return (await db.query<{ result: PatientRecognitionResult }>('select public.save_center_patient_recognition($1,$2,$3::jsonb) result', [org, actor, JSON.stringify(v)])).rows[0].result }
async function fixture() {
  const patientId = uuid(), person = { id: patientId, kind: 'patient', name: '가상 인정 대상', status: '', category: '기존 등급', start: '2026-01-02', end: '2026-12-31', examination: '', notes: { 기타: '보존' } }
  await op({ action: 'upsertPerson', person, expectedVersion: 0, requestId: uuid() })
  const recognition = { id: uuid(), grade: ' 3등급 ', number: 'L000123', sequence: '001', periodStart: '2026-10-01', periodEnd: '2027-09-30', note: '가상 인정서' }, input = { action: 'save', patientId, requestId: uuid(), expectedVersion: 0, recognition }
  return { patientId, person, recognition, input }
}
it('저장은 분리하고 적용은 category만 변경·숫자문자열 앞자리0 보존·요청 재현', async () => {
  const { patientId, person, recognition, input } = await fixture(), saved = await save(input)
  expect(saved.state.entries[0]).toMatchObject({ grade: '3등급', number: 'L000123', sequence: '001' })
  expect((await db.query<{ data: object }>('select data from public.center_people')).rows[0].data).toEqual(person)
  const apply = { action: 'apply', patientId, id: recognition.id, expectedVersion: 1, expectedPersonVersion: 1, requestId: uuid() }, result = await save(apply)
  expect(result.person).toEqual({ ...person, category: '3등급', version: 2, archived: false }); expect(await save(apply)).toEqual(result)
  await expect(save({ ...input, expectedVersion: 2, requestId: uuid() })).rejects.toThrow('CENTER_RECOG_409')
  await expect(save({ action: 'archive', patientId, id: recognition.id, expectedVersion: 2, requestId: uuid() })).rejects.toThrow('CENTER_RECOG_409')
}, 15000)
it('인물 충돌시 전체 보존·갱신 적용·이전 보관·수급자 보관 후 조회', async () => {
  const { patientId, person, recognition, input } = await fixture(); await save(input)
  await op({ action: 'upsertPerson', person: { ...person, name: '다른 편집' }, expectedVersion: 1, requestId: uuid() })
  await expect(save({ action: 'apply', patientId, id: recognition.id, expectedVersion: 1, expectedPersonVersion: 1, requestId: uuid() })).rejects.toThrow('CENTER_RECOG_409')
  expect(await inspect(patientId)).toMatchObject({ version: 1, activeId: null })
  const next = { ...recognition, id: uuid(), grade: '2등급', sequence: '002' }; await save({ ...input, recognition: next, expectedVersion: 1, requestId: uuid() })
  const apply = { action: 'apply', patientId, id: next.id, expectedVersion: 2, expectedPersonVersion: 2, requestId: uuid() }; const applied = await save(apply)
  const archived = await save({ action: 'archive', patientId, id: recognition.id, expectedVersion: 3, requestId: uuid() })
  expect(archived.state.entries.find(e => e.id === recognition.id)?.archived).toBe(true)
  await op({ action: 'archivePerson', id: patientId, expectedVersion: 3, requestId: uuid() })
  expect((await inspect(patientId)).entries).toHaveLength(2); expect(await save(apply)).toEqual(applied)
}, 15000)
it('날짜·번호·확장·기관·재사용을 거절한다', async () => {
  const { input, recognition } = await fixture()
  for (const changed of [{ ...recognition, periodEnd: '2026-02-30' }, { ...recognition, periodEnd: '2025-01-01' }, { ...recognition, grade: ' ' }, { ...recognition, number: 'L' }, { ...recognition, sequence: 1 }]) await expect(save({ ...input, recognition: changed })).rejects.toThrow('CENTER_RECOG_400')
  await expect(save(input, 'OTHER')).rejects.toThrow('CENTER_RECOG_404'); await expect(save(input, 'OFF')).rejects.toThrow('CENTER_RECOG_403')
  await save(input); await expect(save(input, 'TEST', 'other-admin')).rejects.toThrow('CENTER_RECOG_409')
}, 15000)
it('직접쓰기·브라우저 접근을 막고 실제 서비스 역할 RPC만 실행한다', async () => {
  const { input } = await fixture()
  const row = (await db.query("select has_table_privilege('anon','public.center_patient_recognitions','SELECT') browser,has_table_privilege('service_role','public.center_patient_recognitions','UPDATE') direct,has_function_privilege('service_role','public.save_center_patient_recognition(text,text,jsonb)','EXECUTE') rpc")).rows[0]
  expect(row).toEqual({ browser: false, direct: false, rpc: true }); await db.exec('set role service_role'); expect((await save(input)).state.version).toBe(1); await db.exec('reset role')
}, 15000)
