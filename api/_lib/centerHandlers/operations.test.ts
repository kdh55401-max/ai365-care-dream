import {Readable} from 'node:stream'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),ready:vi.fn(),load:vi.fn(),mutate:vi.fn(),db:{}}))
vi.mock('../centerAuth.js',()=>({centerSession:m.session}));vi.mock('../supabase.js',()=>({getSupabaseAdmin:()=>m.db}));vi.mock('../centerDocumentStore.js',()=>({assertCenterOrganizationReady:m.ready}));vi.mock('../centerOperationStore.js',()=>({loadCenterOperations:m.load,mutateCenterOperation:m.mutate}))
import handler from './operations.js'
import {ApiError} from '../http.js'
const actor={id:'fake-admin',organization_code:'TEST',role:'admin',status:'active'}
const input={action:'upsertPerson',requestId:'00000000-0000-0000-0000-000000000001',expectedVersion:0,person:{id:'00000000-0000-0000-0000-000000000002',kind:'worker',name:'가상',status:'',category:'',start:'',end:'',examination:'',notes:{}}}
function req(method='GET',body?:unknown,site?:string){const r=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]) as IncomingMessage;r.method=method;r.url='/api/center/operations?organizationCode=OTHER';r.headers=site?{'sec-fetch-site':site}:{};return r}
function res(){return {statusCode:200,setHeader:vi.fn(),end:vi.fn()} as unknown as ServerResponse}
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue(actor);m.ready.mockResolvedValue(undefined);m.load.mockResolvedValue({people:[],visits:[]});m.mutate.mockResolvedValue({person:{...input.person,version:1,archived:false}})})
describe('기관 업무 API 경계',()=>{
 it('승인 admin/master의 기관을 세션에서 결정',async()=>{for(const role of ['admin','master']){m.session.mockResolvedValue({...actor,role});const r=res();await handler(req(),r);expect(r.statusCode).toBe(200);expect(m.load).toHaveBeenLastCalledWith(m.db,'TEST')}m.session.mockResolvedValue(actor);const r=res();await handler(req('POST',input),r);expect(r.statusCode).toBe(200);expect(m.mutate).toHaveBeenLastCalledWith(m.db,'TEST','fake-admin',input)})
 it('미로그인·caregiver·대기·정지 차단',async()=>{for(const a of [null,{...actor,role:'caregiver'},{...actor,status:'pending'},{...actor,status:'suspended'}]){m.session.mockResolvedValue(a);const r=res();await handler(req(),r);expect(r.statusCode).toBe(403)}expect(m.load).not.toHaveBeenCalled()})
 it('기관 주입·교차 출처 쓰기 차단',async()=>{const r=res();await handler(req('POST',{...input,organizationCode:'OTHER'}),r);expect(r.statusCode).toBe(400);for(const site of ['same-site','cross-site']){const s=res();await handler(req('POST',input,site),s);expect(s.statusCode).toBe(403)}expect(m.mutate).not.toHaveBeenCalled()})
 it('저장소 실패503·동시수정409를 성공으로 바꾸지 않음',async()=>{m.ready.mockRejectedValue(new ApiError(503,'미준비'));const r=res();await handler(req(),r);expect(r.statusCode).toBe(503);expect(m.load).not.toHaveBeenCalled();m.ready.mockResolvedValue(undefined);m.mutate.mockRejectedValue(new ApiError(409,'충돌'));const s=res();await handler(req('POST',input),s);expect(s.statusCode).toBe(409)})
})
