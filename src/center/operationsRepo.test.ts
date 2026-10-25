const randomUUID = () => crypto.randomUUID()
import {afterEach,describe,expect,it,vi} from 'vitest'
import type {CenterPerson,CenterOperationMutation} from '../../shared/centerOperations'
import {createDemoOperationsRepository,DEMO_OPERATIONS_STORAGE_KEY,serverOperationsRepository,type OperationsRepository} from './operationsRepo'
import {createOperationsController} from './useCenterOperations'
function storage(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}}
function person(kind:'worker'|'patient'='worker'):CenterPerson{return {id:randomUUID(),kind,name:'가상 '+kind,status:'',category:'',start:'',end:'',examination:'',notes:{}}}
function create(p=person()):Extract<CenterOperationMutation,{action:'upsertPerson'}>{return {action:'upsertPerson',requestId:randomUUID(),expectedVersion:0,person:p}}
afterEach(()=>vi.unstubAllGlobals())
describe('기관 업무 저장소와 경합',()=>{
 it('새 저장소 인스턴스에서도 자료 재조회·같은 요청 재전송 한 번 저장',async()=>{const store=storage(),repo=createDemoOperationsRepository(store),input=create();const first=await repo.mutate(input);expect(await repo.mutate(input)).toEqual(first);const reopened=createDemoOperationsRepository(store);expect((await reopened.list()).people).toHaveLength(1);expect((await reopened.list()).people[0].version).toBe(1);await expect(repo.mutate({...input,person:{...input.person,name:'다른 값'}})).rejects.toThrow('같은 요청')})
 it('옛 버전 저장을 거절하고 최신 인물값 유지',async()=>{const repo=createDemoOperationsRepository(storage()),p=person();await repo.mutate(create(p));await repo.mutate({action:'upsertPerson',requestId:randomUUID(),expectedVersion:1,person:{...p,name:'가상 수정'}});await expect(repo.mutate({action:'upsertPerson',requestId:randomUUID(),expectedVersion:1,person:p})).rejects.toThrow();expect((await repo.list()).people[0]).toMatchObject({name:'가상 수정',version:2})})
 it('일정 종류와 활동 참조를 검사하고 연결된 인물 보관은 차단',async()=>{const repo=createDemoOperationsRepository(storage()),w=person(),p=person('patient');await repo.mutate(create(w));await repo.mutate(create(p));const visit={id:randomUUID(),date:'2026-10-22',time:'09:00',workerId:w.id,patientId:p.id,service:'요양',minutes:60};await expect(repo.mutate({action:'upsertVisit',requestId:randomUUID(),expectedVersion:0,visit:{...visit,patientId:w.id}})).rejects.toThrow();await repo.mutate({action:'upsertVisit',requestId:randomUUID(),expectedVersion:0,visit});await expect(repo.mutate({action:'archivePerson',requestId:randomUUID(),expectedVersion:1,id:w.id})).rejects.toThrow('일정');await repo.mutate({action:'archiveVisit',requestId:randomUUID(),expectedVersion:1,id:visit.id});await repo.mutate({action:'archivePerson',requestId:randomUUID(),expectedVersion:1,id:w.id});expect((await repo.list()).people.map(x=>x.id)).not.toContain(w.id)})
 it('손상 저장소는 지우지 않고 쓰기 실패도 성공으로 바꾸지 않음',async()=>{const store=storage();store.values.set(DEMO_OPERATIONS_STORAGE_KEY,'broken');await expect(createDemoOperationsRepository(store).list()).rejects.toThrow();expect(store.getItem(DEMO_OPERATIONS_STORAGE_KEY)).toBe('broken');const denied=createDemoOperationsRepository({getItem:()=>null,setItem:()=>{throw new Error('quota')}});await expect(denied.mutate(create())).rejects.toThrow('quota');expect((await denied.list()).people).toEqual([])})
 it('서버503/비JSON 응답은 시연 자료로 우회하지 않음',async()=>{const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:'저장소 미준비'}),{status:503}));vi.stubGlobal('fetch',fetcher);await expect(serverOperationsRepository.list()).rejects.toThrow('미준비');expect(fetcher).toHaveBeenCalledTimes(1);fetcher.mockImplementation(async()=>new Response('<html>login</html>',{status:200}));await expect(serverOperationsRepository.mutate(create())).rejects.toThrow('응답')})
 it('실패 후 같은 인물·버전 재시도는 같은 요청ID 사용',async()=>{const p=person(),mutations:CenterOperationMutation[]=[];const repository:OperationsRepository={list:async()=>({people:[],visits:[]}),mutate:vi.fn(async input=>{mutations.push(input);if(mutations.length===1)throw new Error('connection lost');return {person:{...p,version:1,archived:false}}})};const controller=createOperationsController(repository);await expect(controller.savePerson(p)).rejects.toThrow('connection lost');expect(controller.snapshot().people).toEqual([]);await controller.savePerson(p);expect(mutations[0].requestId).toBe(mutations[1].requestId);expect(controller.snapshot().people).toHaveLength(1)})
 it('저장 후 도착한 이전 목록 응답이 새 저장을 지우지 않음',async()=>{const p=person();let resolve!:(value:{people:CenterPerson[];visits:[]})=>void;const repository:OperationsRepository={list:()=>new Promise(r=>{resolve=r}),mutate:async()=>({person:{...p,version:1,archived:false}})};const controller=createOperationsController(repository),old=controller.reload();await controller.savePerson(p);resolve({people:[],visits:[]});await old;expect(controller.snapshot().people[0].id).toBe(p.id)})
})

describe('복수 제공자 저장·보관 경계',()=>{
 it('목욕 보조 제공자도 참조를 검사하고 연결 중 보관을 차단한다',async()=>{
  const repo=createDemoOperationsRepository(storage()),controller=createOperationsController(repo),w=person(),second=person(),patient=person('patient')
  await controller.savePerson(w);await controller.savePerson(second);await controller.savePerson(patient)
  const visit={id:randomUUID(),date:'2026-10-22',time:'09:00',workerId:w.id,workerIds:[w.id,second.id],patientId:patient.id,service:'목욕',minutes:60}
  const saved=await controller.saveVisit(visit)
  expect((await repo.list()).visits[0].workerIds).toEqual([w.id,second.id])
  await expect(controller.archivePerson({...second,version:1})).rejects.toThrow('일정')
  await expect(controller.saveVisit({...saved,workerIds:[w.id,patient.id]})).rejects.toThrow('직원')
  await controller.archiveVisit(saved);await controller.archivePerson({...second,version:1})
  expect((await repo.list()).people.map(p=>p.id)).not.toContain(second.id)
 })
 it('이전 1인 목욕 자료를 지우지 않고 조회·보관할 수 있다',async()=>{
  const store=storage(),w=person(),patient=person('patient'),visit={id:randomUUID(),date:'2026-10-22',time:'09:00',workerId:w.id,patientId:patient.id,service:'목욕',minutes:60,version:1}
  store.setItem(DEMO_OPERATIONS_STORAGE_KEY,JSON.stringify({people:[{...w,version:1},{...patient,version:1}],visits:[visit],requests:{}}))
  const controller=createOperationsController(createDemoOperationsRepository(store));await controller.reload()
  expect(controller.snapshot().visits).toEqual([visit])
  await expect(controller.saveVisit(visit)).rejects.toThrow('2명')
  await controller.archiveVisit(visit)
  expect(controller.snapshot().visits).toEqual([])
 })
})

describe('방문일정 편집과 보관',()=>{
 it('편집 중 다른 개정이 생기면 옛 버전 수정·보관을 차단한다',async()=>{
  const repo=createDemoOperationsRepository(storage()),controller=createOperationsController(repo),w=person(),p=person('patient')
  await controller.savePerson(w);await controller.savePerson(p)
  const first=await controller.saveVisit({id:randomUUID(),date:'2026-10-22',time:'09:00',workerId:w.id,patientId:p.id,service:'요양',minutes:60})
  const latest=await controller.saveVisit({...first,time:'11:00'})
  await expect(controller.saveVisit({...first,minutes:90})).rejects.toThrow('변경')
  await expect(controller.archiveVisit(first)).rejects.toThrow('변경')
  expect((await repo.list()).visits).toEqual([latest])
  await controller.archiveVisit(latest)
  expect(controller.snapshot().visits).toEqual([])
  expect((await repo.list()).visits).toEqual([])
 })
 it('수정 응답 유실을 재시도해도 같은 요청으로 한 번만 개정한다',async()=>{
  const store=storage(),repo=createDemoOperationsRepository(store),base=createOperationsController(repo),w=person(),p=person('patient')
  await base.savePerson(w);await base.savePerson(p)
  const first=await base.saveVisit({id:randomUUID(),date:'2026-10-22',time:'09:00',workerId:w.id,patientId:p.id,service:'요양',minutes:60})
  const requests:CenterOperationMutation[]=[]
  const controller=createOperationsController({list:repo.list,mutate:async input=>{requests.push(input);const result=await repo.mutate(input);if(requests.length===1)throw new Error('response lost');return result}})
  await expect(controller.saveVisit({...first,time:'10:00'})).rejects.toThrow('response lost')
  await controller.saveVisit({...first,time:'10:00'})
  expect(requests[0].requestId).toBe(requests[1].requestId)
  expect((await repo.list()).visits[0]).toMatchObject({id:first.id,time:'10:00',version:2})
 })
})

describe('로그아웃 상태 격리',()=>{it('세션 종료 때 인물 캐시를 지우고 늦은 조회도 무시한다',async()=>{const p=person();let resolve!:(value:{people:CenterPerson[];visits:[]})=>void;const repository:OperationsRepository={list:()=>new Promise(r=>{resolve=r}),mutate:async()=>({person:{...p,version:1,archived:false}})};const controller=createOperationsController(repository);await controller.savePerson(p);expect(controller.snapshot().people).toHaveLength(1);const pending=controller.reload();controller.reset();resolve({people:[p],visits:[]});await pending;expect(controller.snapshot().people).toEqual([]);expect(controller.snapshot().saving).toBe(false)})})

it('이전 세션의 저장 완료가 새 세션 저장중 상태를 바꾸지 않는다',async()=>{const p=person();const pending:Array<(r:{person:CenterPerson})=>void>=[];const controller=createOperationsController({list:async()=>({people:[],visits:[]}),mutate:()=>new Promise(r=>{pending.push(r)})});const old=controller.savePerson(p);controller.reset();const current=controller.savePerson({...p,name:'새 세션 가상'});pending[0]({person:{...p,version:1}});await old;expect(controller.snapshot().saving).toBe(true);expect(controller.snapshot().people).toEqual([]);pending[1]({person:{...p,name:'새 세션 가상',version:1}});await current;expect(controller.snapshot().saving).toBe(false)})
