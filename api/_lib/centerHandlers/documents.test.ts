import { emptyStateChange, serializeStateChange } from '../../../shared/centerStateChange.js'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({session:vi.fn(), ready:vi.fn(), load:vi.fn(), mutate:vi.fn(), db:{}}))
vi.mock('../centerAuth.js',()=>({centerSession:mock.session}))
vi.mock('../supabase.js',()=>({getSupabaseAdmin:()=>mock.db}))
vi.mock('../centerDocumentStore.js',()=>({assertCenterOrganizationReady:mock.ready,loadCenterDocuments:mock.load,mutateCenterDocument:mock.mutate}))
import handler from './documents.js'
import { ApiError } from '../http.js'
const actor={id:'test-admin',organization_code:'TEST',role:'admin',status:'active'}
const fields={action:'create',requestId:'00000000-0000-0000-0000-000000000001',templateId:'case-management',title:'가상 문서',subjectKind:'agency',subjectId:null,period:'2026-07',content:'본문',resultEvaluationCompleted:false}
function request(method='GET',body?:unknown,site?:string) { const req=Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []) as IncomingMessage; req.method=method;req.url='/api/center/documents?organizationCode=OTHER';req.headers=site?{'sec-fetch-site':site}:{};return req }
function response(){const res={statusCode:200,setHeader:vi.fn(),end:vi.fn()};return res as unknown as ServerResponse & typeof res}
beforeEach(()=>{vi.clearAllMocks();mock.session.mockResolvedValue(actor);mock.ready.mockResolvedValue(undefined);mock.load.mockResolvedValue([]);mock.mutate.mockResolvedValue({id:'stored',organizationCode:'TEST'})})
describe('센터 문서 endpoint 기관 경계',()=>{
  it('승인된 관리자와 마스터는 자신의 기관만 조회한다',async()=>{
    for(const role of ['admin','master']){mock.session.mockResolvedValue({...actor,role});const res=response();await handler(request(),res);expect(res.statusCode).toBe(200);expect(mock.load).toHaveBeenLastCalledWith(mock.db,'TEST')}
  })
  it('비로그인·요양보호사·정지·미승인 계정은 거부한다',async()=>{
    for(const session of [null,{...actor,role:'caregiver'},{...actor,status:'suspended'},{...actor,status:'pending'}]){mock.session.mockResolvedValue(session);const res=response();await handler(request(),res);expect(res.statusCode).toBe(403)}
    expect(mock.load).not.toHaveBeenCalled();expect(mock.mutate).not.toHaveBeenCalled()
  })
  it('기관코드는 세션에서 유도하고 정상 mutation만 전달한다',async()=>{
    const res=response();await handler(request('POST',fields),res);expect(res.statusCode).toBe(200);expect(mock.mutate).toHaveBeenCalledWith(mock.db,'TEST','test-admin',fields)
    const injected=response();await handler(request('POST',{...fields,organizationCode:'OTHER'}),injected);expect(injected.statusCode).toBe(400)
  })
  it('DB 미준비를 빈 목록으로 위장하지 않는다',async()=>{
    mock.ready.mockRejectedValue(new ApiError(503,'저장소 준비 중'));const res=response();await handler(request(),res);expect(res.statusCode).toBe(503);expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({error:'저장소 준비 중'})
  })
  it('버전 충돌은 409를 보존하고 교차 사이트 쓰기를 거부한다',async()=>{
    mock.mutate.mockRejectedValue(new ApiError(409,'변경됨'));const res=response();await handler(request('POST',fields),res);expect(res.statusCode).toBe(409)
    mock.mutate.mockClear();const cross=response();await handler(request('POST',fields,'cross-site'),cross);expect(cross.statusCode).toBe(403);expect(mock.mutate).not.toHaveBeenCalled()
    const sibling=response();await handler(request('POST',fields,'same-site'),sibling);expect(sibling.statusCode).toBe(403);expect(mock.mutate).not.toHaveBeenCalled()
  })
  it('한글 80,000자 본문은 받되 문서 전용 바이트 상한을 넘으면 거부한다',async()=>{
    const korean={...fields,content:'한'.repeat(80000)}
    const accepted=response();await handler(request('POST',korean,'same-origin'),accepted);expect(accepted.statusCode).toBe(200)
    expect(mock.mutate.mock.calls[0][3].content).toBe(korean.content)
    mock.mutate.mockClear()
    const oversized=response();await handler(request('POST',{...fields,content:'한'.repeat(200000)},'same-origin'),oversized);expect(oversized.statusCode).toBe(413);expect(mock.mutate).not.toHaveBeenCalled()
  })
  it('연결되지 않은 직원·수급자 대상 저장을 임의 메모리ID로 허용하지 않는다',async()=>{
    const res=response();await handler(request('POST',{...fields,templateId:'service-record',subjectKind:'patient',subjectId:'A01'}),res);expect(res.statusCode).toBe(400);expect(mock.mutate).not.toHaveBeenCalled()
  })
})

it('수급자 UUID는 실제 기관검증 RPC로 넘기며 DB 미준비를 성공으로 바꾸지 않는다',async()=>{const patient={...fields,templateId:'state-change-record',subjectKind:'patient',subjectId:'00000000-0000-0000-0000-000000000003'};let res=response();await handler(request('POST',patient),res);expect(res.statusCode).toBe(200);expect(mock.mutate).toHaveBeenLastCalledWith(mock.db,'TEST','test-admin',expect.objectContaining({subjectId:patient.subjectId}));mock.mutate.mockRejectedValue(new ApiError(503,'수급자 저장소 준비 전'));res=response();await handler(request('POST',patient),res);expect(res.statusCode).toBe(503)})


it('화면 검사를 건너뛴 상태변화 날짜 오류는 RPC 호출 전에 400으로 거부한다', async () => {
  const record = emptyStateChange()
  record.weeks[0] = { ...record.weeks[0], date: '2026-06-30', remarks: '가상 관찰 기록' }
  const patient = { ...fields, templateId: 'state-change-record', subjectKind: 'patient', subjectId: '00000000-0000-0000-0000-000000000003' }
  for (const action of ['create', 'revise']) {
    const res = response()
    await handler(request('POST', { ...patient, action, ...(action === 'revise' ? { id: '00000000-0000-0000-0000-000000000004', expectedVersion: 1 } : {}), content: ' \n' + serializeStateChange(record) }), res)
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.end.mock.calls[0][0]).error).toContain('기준월')
  }
  expect(mock.mutate).not.toHaveBeenCalled()
  record.weeks[0].date = '2026-07-02'
  const accepted = response()
  await handler(request('POST', { ...patient, content: serializeStateChange(record) }), accepted)
  expect(accepted.statusCode).toBe(200)
  expect(mock.mutate).toHaveBeenCalledTimes(1)
})
