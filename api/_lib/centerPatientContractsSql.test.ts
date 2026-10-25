import { readFileSync } from 'node:fs'
import { randomUUID as uuid } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { PatientContractResult, PatientContractsState } from '../../shared/centerPatientContracts.js'
let db: PGlite
beforeAll(async () => { db = new PGlite(); await db.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true),('OFF',false)"); for (const f of ['2026-10-22-center-operations.sql', '2026-10-23-center-patient-contracts.sql']) await db.exec(readFileSync(new URL('../../db/migrations/' + f, import.meta.url), 'utf8')) }, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('truncate public.center_patient_contract_requests,public.center_patient_contracts,public.center_operation_requests,public.center_visits,public.center_people') })
const op = (v: object) => db.query('select public.mutate_center_operation($1,$2,$3::jsonb)', ['TEST', 'fake-admin', JSON.stringify(v)])
async function inspect(id: string) { return (await db.query<{ result: PatientContractsState }>('select public.inspect_center_patient_contract($1,$2) result', ['TEST', id])).rows[0].result }
async function save(v: object, org = 'TEST', actor = 'fake-admin') { return (await db.query<{ result: PatientContractResult }>('select public.save_center_patient_contract($1,$2,$3::jsonb) result', [org, actor, JSON.stringify(v)])).rows[0].result }
async function fixture() {
  const patientId = uuid(), person = { id: patientId, kind: 'patient', name: '가상 계약 대상', status: '', category: '가상 등급', start: '', end: '', examination: '', notes: { 기타: '보존' } }
  await op({ action: 'upsertPerson', person, expectedVersion: 0, requestId: uuid() })
  const contract = { id: uuid(), contractDate: '2026-10-01', periodStart: '2026-10-03', periodEnd: '2027-10-02', services: ['목욕', '요양'], note: '가상 계약' }, input = { action: 'save', requestId: uuid(), patientId, expectedVersion: 0, contract }
  return { patientId, person, contract, input }
}
it('저장과 적용·요청 재현·활성 이력 보호 및 기타 인물정보 보존', async () => {
  const { patientId, contract, input } = await fixture(), first = await save(input)
  expect(first.state).toMatchObject({ version: 1, activeId: null }); expect(first.state.entries[0].services).toEqual(['요양', '목욕'])
  expect((await db.query<{ data: { start: string } }>('select data from public.center_people')).rows[0].data.start).toBe('')
  const apply = { action: 'apply', requestId: uuid(), patientId, expectedVersion: 1, expectedPersonVersion: 1, id: contract.id }, applied = await save(apply)
  expect(applied.person).toMatchObject({ start: contract.contractDate, end: contract.periodEnd, category: '가상 등급', notes: { 기타: '보존' }, version: 2 })
  expect(await save(apply)).toEqual(applied)
  await expect(save({ ...input, expectedVersion: 2, requestId: uuid() })).rejects.toThrow('CENTER_CONTRACT_409')
  await expect(save({ action: 'archive', patientId, id: contract.id, expectedVersion: 2, requestId: uuid() })).rejects.toThrow('CENTER_CONTRACT_409')
}, 15000)
it('인물 CAS 실패는 이력·기본정보를 동시에 보존하고 명시적 교체후 이전 이력 보관', async () => {
  const { patientId, person, contract, input } = await fixture(); await save(input)
  await op({ action: 'upsertPerson', person: { ...person, name: '가상 편집' }, expectedVersion: 1, requestId: uuid() })
  await expect(save({ action: 'apply', patientId, id: contract.id, expectedVersion: 1, expectedPersonVersion: 1, requestId: uuid() })).rejects.toThrow('CENTER_CONTRACT_409')
  expect(await inspect(patientId)).toMatchObject({ version: 1, activeId: null })
  const next = { ...contract, id: uuid(), periodEnd: '2028-10-02' }; await save({ ...input, contract: next, expectedVersion: 1, requestId: uuid() })
  await save({ action: 'apply', patientId, id: next.id, expectedVersion: 2, expectedPersonVersion: 2, requestId: uuid() })
  const archived = await save({ action: 'archive', patientId, id: contract.id, expectedVersion: 3, requestId: uuid() })
  expect(archived.state.entries.find(e => e.id === contract.id)?.archived).toBe(true)
  expect(archived.state.activeId).toBe(next.id)
}, 15000)
it('날짜·서비스·다른 기관 및 요청 번호 재사용을 검증한다', async () => {
  const { patientId, contract, input } = await fixture()
  for (const changed of [{ ...contract, periodEnd: '2026-02-30' }, { ...contract, periodEnd: '2025-01-01' }, { ...contract, services: ['요양', '요양'] }, { ...contract, services: [] }]) await expect(save({ ...input, contract: changed })).rejects.toThrow('CENTER_CONTRACT_400')
  await expect(save(input, 'OTHER')).rejects.toThrow('CENTER_CONTRACT_404')
  await expect(save(input, 'OFF')).rejects.toThrow('CENTER_CONTRACT_403')
  const result = await save(input); expect(await save(input)).toEqual(result)
  await expect(save(input, 'TEST', 'another')).rejects.toThrow('CENTER_CONTRACT_409')
  await op({ action: 'archivePerson', id: patientId, expectedVersion: 1, requestId: uuid() })
  expect((await inspect(patientId)).entries).toHaveLength(1); expect(await save(input)).toEqual(result)
}, 15000)
it('브라우저·서비스 직접쓰기 금지와 service_role RPC 실행을 검증한다', async () => {
  const { patientId, input } = await fixture()
  const row = (await db.query("select has_table_privilege('anon','public.center_patient_contracts','SELECT') browser,has_table_privilege('service_role','public.center_patient_contracts','UPDATE') direct,has_function_privilege('service_role','public.save_center_patient_contract(text,text,jsonb)','EXECUTE') rpc")).rows[0]
  expect(row).toEqual({ browser: false, direct: false, rpc: true })
  await db.exec('set role service_role'); expect((await save(input)).state.patientId).toBe(patientId); await db.exec('reset role')
}, 15000)
