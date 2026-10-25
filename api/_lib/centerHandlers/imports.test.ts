import {Readable} from 'node:stream'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),ready:vi.fn(),list:vi.fn(),run:vi.fn(),db:{}}))
vi.mock('../centerAuth.js',()=>({centerSession:m.session}));vi.mock('../supabase.js',()=>({getSupabaseAdmin:()=>m.db}));vi.mock('../centerDocumentStore.js',()=>({assertCenterOrganizationReady:m.ready}));vi.mock('../centerPersonImport.js',()=>({listCenterImports:m.list,runCenterImport:m.run}))
import handler from './imports.js'
const actor={id:'fake-admin',organization_code:'TEST',role:'admin',status:'active'}
const input={kind:'worker',sourceText:'이름: 가상 하나',requestId:'00000000-0000-0000-0000-000000000001'}
function req(method='GET',body?:unknown,site?:string){const r=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]) as IncomingMessage;r.method=method;r.url='/api/center/imports?organizationCode=OTHER';r.headers=site?{'sec-fetch-site':site}:{};return r}
function res(){return {statusCode:200,setHeader:vi.fn(),end:vi.fn()} as unknown as ServerResponse}
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue(actor);m.ready.mockResolvedValue(undefined);m.list.mockResolvedValue([]);m.run.mockResolvedValue({id:'fake-id',status:'review_required'})})
describe('AI 인물자료 처리 API 권한',()=>{
 it('승인된관리자/마스터는 세션기관만 조회·저장한다',async()=>{for(const role of ['admin','master']){m.session.mockResolvedValue({...actor,role});const r=res();await handler(req(),r);expect(r.statusCode).toBe(200);expect(m.list).toHaveBeenLastCalledWith(m.db,'TEST')}const r=res();await handler(req('POST',input),r);expect(r.statusCode).toBe(200);expect(m.run).toHaveBeenCalledWith(m.db,'TEST','fake-admin',input)})
 it('미로그인·요양보호사·승인대기·정지계정 차단',async()=>{for(const a of [null,{...actor,role:'caregiver'},{...actor,status:'pending'},{...actor,status:'suspended'}]){m.session.mockResolvedValue(a);const r=res();await handler(req('POST',input),r);expect(r.statusCode).toBe(403)}expect(m.run).not.toHaveBeenCalled();expect(m.list).not.toHaveBeenCalled()})
 it('교차출처와 기관주입·잘못된자료를외부 AI 호출전에 차단',async()=>{for(const site of ['same-site','cross-site']){const r=res();await handler(req('POST',input,site),r);expect(r.statusCode).toBe(403)}for(const patch of [{organizationCode:'OTHER'},{sourceText:''},{kind:'master'}]){const r=res();await handler(req('POST',{...input,...patch}),r);expect(r.statusCode).toBe(400)}expect(m.run).not.toHaveBeenCalled()})
})
