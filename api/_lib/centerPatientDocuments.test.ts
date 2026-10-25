import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
let db: PGlite
const patient = '00000000-0000-0000-0000-000000000011', other = '00000000-0000-0000-0000-000000000012', worker = '00000000-0000-0000-0000-000000000013', archived = '00000000-0000-0000-0000-000000000014'
beforeAll(async () => {
  db = new PGlite()
  await db.exec("create role anon;create role authenticated;create role service_role;create table public.center_organizations(code text primary key,active boolean not null default true);insert into public.center_organizations values('TEST',true),('OTHER',true),('OFF',false)")
  for (const file of ['2026-10-21-center-documents.sql','2026-10-22-center-operations.sql','2026-10-22-center-patient-documents.sql']) await db.exec(readFileSync(new URL('../../db/migrations/' + file, import.meta.url), 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec('truncate public.center_document_requests,public.center_documents,public.center_people cascade')
  for (const [id, org, kind, flag] of [[patient,'TEST','patient',false],[other,'OTHER','patient',false],[worker,'TEST','worker',false],[archived,'TEST','patient',true]]) await db.query("insert into public.center_people(id,organization_code,kind,data,archived) values($1,$2,$3,'{}',$4)", [id,org,kind,flag])
})
const create = (templateId = 'state-change-record') => ({ action: 'create', requestId: randomUUID(), templateId, title: '가상 수급자 기록', subjectKind: 'patient', subjectId: patient, period: '2026-10', content: '가상 원문·확인 필요', resultEvaluationCompleted: false })
async function mutate(v: Record<string, unknown>, org = 'TEST') { return (await db.query<{doc: Record<string, unknown>}>('select public.mutate_center_document($1,$2,$3::jsonb) as doc',[org,'fake-admin',JSON.stringify(v)])).rows[0].doc }
describe('수급자 문서 실제 SQL 계약 · 격리 DB', () => {
  it.each(['service-record','state-change-record','service-result-evaluation'])('%s 생성·재조회·중복·개정·명시 확정을 보존한다', async template => {
    const v = create(template), first = await mutate(v)
    expect(first).toMatchObject({subject_id:patient,status:'draft',version:1}); expect(await mutate(v)).toEqual(first)
    const revised = await mutate({...v,action:'revise',id:first.id,requestId:randomUUID(),expectedVersion:1,content:'수정된 가상 원문'})
    expect(revised.version).toBe(2)
    const confirmed = await mutate({action:'confirm',requestId:randomUUID(),id:first.id,expectedVersion:2})
    expect(confirmed).toMatchObject({status:'confirmed',version:3}); expect((await db.query('select * from public.center_documents')).rows).toHaveLength(1)
    await expect(mutate({...v,action:'revise',id:first.id,requestId:randomUUID(),expectedVersion:3})).rejects.toThrow('CENTER_DOC_409')
  })
  it('다른기관·직원·보관·없는·문자열 인물은 기록 생성과 영수증을 만들지 않는다', async () => {
    for (const id of [other,worker,archived,randomUUID(),'A01']) await expect(mutate({...create(),subjectId:id})).rejects.toThrow('CENTER_DOC_400')
    expect((await db.query('select * from public.center_document_requests')).rows).toHaveLength(0)
  })
  it('환자 문서에 다른 기관으로 접근하거나 대상·양식을 바꾸지 못한다', async () => {
    const v = create(), first = await mutate(v)
    await expect(mutate({action:'confirm',requestId:randomUUID(),id:first.id,expectedVersion:1},'OTHER')).rejects.toThrow('CENTER_DOC_404')
    for (const patch of [{subjectId:other},{templateId:'service-record'},{subjectKind:'agency',subjectId:null,templateId:'case-management'}]) await expect(mutate({...v,...patch,action:'revise',requestId:randomUUID(),id:first.id,expectedVersion:1})).rejects.toThrow('CENTER_DOC_409')
  })
  it('보관된 수급자의 기존 초안을 새로 확정하지 않는다', async () => {
    const first = await mutate(create())
    await db.query("select public.mutate_center_operation('TEST','fake-admin',$1::jsonb)",[JSON.stringify({action:'archivePerson',id:patient,expectedVersion:1,requestId:randomUUID()})])
    await expect(mutate({action:'confirm',requestId:randomUUID(),id:first.id,expectedVersion:1})).rejects.toThrow('CENTER_DOC_400')
  })
  it('기존 기관 문서와 직접쓰기 제한을 유지하고 잘못된 결과평가 값은 거절한다', async () => {
    await expect(mutate({...create(),resultEvaluationCompleted:true})).rejects.toThrow('CENTER_DOC_400')
    const v = {...create(),templateId:'case-management',subjectKind:'agency',subjectId:null}, first = await mutate(v)
    await mutate({...v,action:'revise',id:first.id,requestId:randomUUID(),expectedVersion:1,content:'기관 가상 초안'})
    expect((await db.query<{write:boolean;execute:boolean}>("select has_table_privilege('service_role','public.center_documents','UPDATE') as write,has_function_privilege('service_role','public.mutate_center_document(text,text,jsonb)','EXECUTE') as execute")).rows[0]).toEqual({write:false,execute:true})
  })
})
