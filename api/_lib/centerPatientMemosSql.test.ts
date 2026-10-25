import { readFileSync } from 'node:fs'
import { randomUUID as uuid } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
let db: PGlite
beforeAll(async () => {
 db = new PGlite(); await db.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true),('OFF',false)")
 for (const f of ['2026-10-22-center-operations.sql', '2026-10-23-center-patient-memos.sql']) await db.exec(readFileSync(new URL('../../db/migrations/' + f, import.meta.url), 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('reset role;truncate public.center_patient_memo_requests,public.center_patient_memos,public.center_operation_requests,public.center_visits,public.center_people') })
async function save(input: object, org = 'TEST', actor = 'fake-admin') { return (await db.query<{ result: { state: { patientId: string; version: number; entries: { id: string; text: string; archived: boolean }[] } } }>('select public.save_center_patient_memo($1,$2,$3::jsonb) result', [org, actor, JSON.stringify(input)])).rows[0].result }
async function inspect(id: string) { return (await db.query<{ result: unknown }>('select public.inspect_center_patient_memo($1,$2) result', ['TEST', id])).rows[0].result }
async function fixture() {
 const patientId = uuid(), person = { id: patientId, kind: 'patient', name: '가상 대상', category: '기존', start: '2026-01-02', end: '2026-12-31', notes: {} }
 await db.query('select public.mutate_center_operation($1,$2,$3::jsonb)', ['TEST', 'fake-admin', JSON.stringify({ action: 'upsertPerson', requestId: uuid(), expectedVersion: 0, person })])
 const memo = { id: uuid(), date: '2026-10-01', text: '가상 증빙' }, input = { action: 'save', requestId: uuid(), patientId, expectedVersion: 0, memo }
 return { input, patientId, person, memo }
}
it('이력만 저장/수정하고 동일 요청을 재현하며 인물과 일정을 보존한다', async () => {
 const f = await fixture(), a = await save(f.input); expect(a.state.entries[0]).toEqual({ ...f.memo, archived: false, writer: 'fake-admin' }); expect(await save(f.input)).toEqual(a)
 const b = await save({ ...f.input, requestId: uuid(), expectedVersion: 1, memo: { ...f.memo, text: '07' } }); expect(b.state.version).toBe(2)
 expect((await db.query('select data,version from public.center_people where id=$1', [f.patientId])).rows[0]).toEqual({ data: f.person, version: 1 }); expect((await db.query<{ n: number }>('select count(*)::int n from public.center_visits')).rows[0].n).toBe(0)
}, 15000)
it('같은 날짜 여러 기록을 허용하고 CAS·요청재사용을 차단하며 보관한다', async () => {
 const f = await fixture(); await save(f.input)
 const second = await save({ ...f.input, requestId: uuid(), expectedVersion: 1, memo: { ...f.memo, id: uuid(), text: '같은 날짜 두 번째' } }); expect(second.state.entries).toHaveLength(2)
 await expect(save({ ...f.input, requestId: uuid() })).rejects.toThrow('CENTER_MEMO_409')
 await expect(save(f.input, 'TEST', 'other')).rejects.toThrow('CENTER_MEMO_409')
 await expect(save({ ...f.input, memo: { ...f.memo, text: '다름' } })).rejects.toThrow('CENTER_MEMO_409')
 const a = await save({ action: 'archive', requestId: uuid(), patientId: f.patientId, expectedVersion: 2, id: f.memo.id }); expect(a.state.entries[0].archived).toBe(true)
 await expect(save({ ...f.input, expectedVersion: 3, requestId: uuid() })).rejects.toThrow('CENTER_MEMO_409')
}, 15000)
it('잘못된 날짜·코드·권한·apply·추가 필드는 원자적으로 거절한다', async () => {
 const f = await fixture()
 for (const patch of [{ date: '2026-02-30' }, { date: '2200-01-01' }, { text: '' }, { text: '   ' }, { text: 2 }, { text: 'x'.repeat(4001) }, { writer: 'injected' }, { archived: true }]) await expect(save({ ...f.input, memo: { ...f.memo, ...patch } })).rejects.toThrow('CENTER_MEMO_400')
 await expect(save({ ...f.input, action: 'apply' })).rejects.toThrow('CENTER_MEMO_400'); await expect(save({ ...f.input, expectedPersonVersion: 1 })).rejects.toThrow('CENTER_MEMO_400')
 await expect(save(f.input, 'OTHER')).rejects.toThrow('CENTER_MEMO_404'); await expect(save(f.input, 'OFF')).rejects.toThrow('CENTER_MEMO_403')
 expect(await inspect(f.patientId)).toEqual({ patientId: f.patientId, version: 0, entries: [] })
}, 15000)
it('보관 수급자 조회/영수증은 보존하고 신규변경·500건 초과는 거절한다', async () => {
 const f = await fixture(), a = await save(f.input)
 await db.query('select public.mutate_center_operation($1,$2,$3::jsonb)', ['TEST', 'fake-admin', JSON.stringify({ action: 'archivePerson', requestId: uuid(), expectedVersion: 1, id: f.patientId })]); expect(await inspect(f.patientId)).toEqual(a.state); expect(await save(f.input)).toEqual(a)
 await expect(save({ ...f.input, requestId: uuid(), expectedVersion: 1 })).rejects.toThrow('CENTER_MEMO_409')
 const q = await fixture(), entries = Array.from({ length: 500 }, () => ({ ...q.memo, id: uuid(), archived: true }))
 await db.query('insert into public.center_patient_memos(organization_code,patient_id,version,entries) values($1,$2,1,$3::jsonb)', ['TEST', q.patientId, JSON.stringify(entries)])
 await expect(save({ ...q.input, expectedVersion: 1 })).rejects.toThrow('CENTER_MEMO_400')
}, 15000)
it('테이블 직접쓰기·브라우저 RPC 금지, service_role RPC만 허용한다', async () => {
 const f = await fixture()
 expect((await db.query("select has_table_privilege('anon','public.center_patient_memos','SELECT') browser,has_table_privilege('service_role','public.center_patient_memos','UPDATE') direct,has_function_privilege('anon','public.save_center_patient_memo(text,text,jsonb)','EXECUTE') anon_rpc,has_function_privilege('service_role','public.save_center_patient_memo(text,text,jsonb)','EXECUTE') rpc")).rows[0]).toEqual({ browser: false, direct: false, anon_rpc: false, rpc: true })
 await db.exec('set role service_role'); expect((await save(f.input)).state.version).toBe(1)
}, 15000)
