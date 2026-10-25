import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
let db: PGlite
beforeAll(async()=>{
  db=new PGlite()
  await db.exec("create role anon; create role authenticated; create role service_role; create table public.center_organizations(code text primary key, active boolean not null default true); insert into public.center_organizations values('TEST',true),('OTHER',true),('OFF',false);")
  await db.exec(readFileSync(new URL('../../db/migrations/2026-10-21-center-documents.sql',import.meta.url),'utf8'))
},30000)
afterAll(async()=>{await db?.close()})
beforeEach(async()=>{await db.exec('truncate public.center_document_requests, public.center_documents;')})
const create=()=>({action:'create',requestId:randomUUID(),templateId:'case-management',title:'가상 문서',subjectKind:'agency',subjectId:null,period:'2026-06',content:'본문',resultEvaluationCompleted:false})
async function mutate(input:Record<string,unknown>,org='TEST',actor='test-admin'){
  const result=await db.query<{document:Record<string,unknown>}>('select public.mutate_center_document($1,$2,$3::jsonb) as document',[org,actor,JSON.stringify(input)])
  return result.rows[0].document
}
describe('센터 문서 DB 원자적 상태·중복 요청 계약 (로컬 가상 DB)',()=>{
  it('같은 요청을 재전송해도 문서 한 건이며 응답 스냅샷을 재사용한다',async()=>{
    const input=create();const first=await mutate(input);expect(await mutate(input)).toEqual(first)
    expect((await db.query<{count:number}>('select count(*)::int as count from public.center_documents')).rows[0].count).toBe(1)
    await expect(mutate({...input,title:'다른 내용'})).rejects.toThrow('CENTER_DOC_409')
    await expect(mutate(input,'TEST','different-admin')).rejects.toThrow('CENTER_DOC_409')
  })
  it('오래된 버전은 409, 명시 확정 후 새 요청으로 수정할 수 없다',async()=>{
    const input=create(),first=await mutate(input)
    const revised=await mutate({...input,action:'revise',requestId:randomUUID(),id:first.id,expectedVersion:1,content:'수정'})
    expect(revised.version).toBe(2)
    await expect(mutate({action:'confirm',requestId:randomUUID(),id:first.id,expectedVersion:1})).rejects.toThrow('CENTER_DOC_409')
    const confirm={action:'confirm',requestId:randomUUID(),id:first.id,expectedVersion:2}
    const confirmed=await mutate(confirm);expect(confirmed.status).toBe('confirmed');expect(confirmed.confirmed_at).not.toBeNull()
    expect(await mutate(confirm)).toEqual(confirmed)
    await expect(mutate({...input,action:'revise',requestId:randomUUID(),id:first.id,expectedVersion:3})).rejects.toThrow('CENTER_DOC_409')
    expect(await mutate(input)).toEqual(first)
  })
  it('기관 경계·비활성 기관·없는 문서를 구분한다',async()=>{
    const first=await mutate(create())
    await expect(mutate({action:'confirm',requestId:randomUUID(),id:first.id,expectedVersion:1},'OTHER')).rejects.toThrow('CENTER_DOC_404')
    await expect(mutate(create(),'OFF')).rejects.toThrow('CENTER_DOC_403')
    await expect(mutate({action:'confirm',requestId:randomUUID(),id:randomUUID(),expectedVersion:1})).rejects.toThrow('CENTER_DOC_404')
  })
  it('본문 없는 확정과 잘못된 결과평가 필드를 저장하지 않는다',async()=>{
    const first=await mutate({...create(),content:' '})
    await expect(mutate({action:'confirm',requestId:randomUUID(),id:first.id,expectedVersion:1})).rejects.toThrow('CENTER_DOC_400')
    await expect(mutate({...create(),templateId:'staff-meeting',resultEvaluationCompleted:true})).rejects.toThrow('CENTER_DOC_400')
    expect((await db.query<{count:number}>('select count(*)::int as count from public.center_document_requests')).rows[0].count).toBe(1)
  })
  it('브라우저 역할과 service role 직접쓰기 대신 서버 RPC로만 변경한다',async()=>{
    const privileges=await db.query<{read:boolean;write:boolean;execute:boolean}>("select has_table_privilege('anon','public.center_documents','SELECT') as read,has_table_privilege('service_role','public.center_documents','UPDATE') as write,has_function_privilege('service_role','public.mutate_center_document(text,text,jsonb)','EXECUTE') as execute")
    expect(privileges.rows[0]).toEqual({read:false,write:false,execute:true})
  })
  it('DB 제약도 대상 식별자 누락과 양식/대상 불일치를 차단한다',async()=>{
    const insert=(template:string,kind:string,subject:string|null)=>db.query("insert into public.center_documents(organization_code,template_id,title,subject_kind,subject_id,period,content) values('TEST',$1,'가상 문서',$2,$3,'2026-06','본문')",[template,kind,subject])
    await expect(insert('service-record','patient',null)).rejects.toThrow()
    await expect(insert('case-management','patient','A01')).rejects.toThrow()
    await expect(insert('service-record','agency',null)).rejects.toThrow()
    await insert('service-record','patient','A01')
    expect((await db.query<{count:number}>('select count(*)::int as count from public.center_documents')).rows[0].count).toBe(1)
  })
})
