import type { Person, Visit } from './model'
import { assertMonthlyScheduleEditable } from './monthlyScheduleStorage'
import { hasDemoAssignmentReference } from './assignmentStorage'
import { hasDemoWeeklyPlanReference } from './weeklyPlanStorage'
import { parseCenterOperationMutation, visitWorkerIds, type CenterPerson, type CenterVisit, type CenterOperationMutation, type CenterOperationSnapshot, type CenterOperationResult } from '../../shared/centerOperations'
export interface OperationsRepository { list(): Promise<CenterOperationSnapshot>; mutate(input: CenterOperationMutation): Promise<CenterOperationResult> }
export class OperationsRepositoryError extends Error { status:number; constructor(message:string,status:number){super(message);this.status=status} }
export function personFields(p:Person):Person{return {id:p.id,kind:p.kind,name:p.name,status:p.status,category:p.category,start:p.start,end:p.end,examination:p.examination,notes:{...p.notes}}}
export function visitFields(v:Visit):Visit{return {id:v.id,date:v.date,time:v.time,workerId:v.workerId,...(v.workerIds===undefined?{}:{workerIds:[...v.workerIds]}),patientId:v.patientId,service:v.service,minutes:v.minutes}}
const probeId='00000000-0000-4000-8000-000000000001'
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)}
function metadata(value:unknown):asserts value is {version:number;archived?:boolean}{if(!record(value)||!Number.isSafeInteger(value.version)||Number(value.version)<1||(value.archived!==undefined&&typeof value.archived!=='boolean'))throw new OperationsRepositoryError('업무 자료 버전 형식이 올바르지 않습니다.',502)}
function checkedPerson(value:unknown):CenterPerson{metadata(value);parseCenterOperationMutation({action:'upsertPerson',requestId:probeId,expectedVersion:value.version,person:personFields(value as unknown as Person)});return value as CenterPerson}
function checkedVisit(value:unknown):CenterVisit{metadata(value);parseCenterOperationMutation({action:'upsertVisit',requestId:probeId,expectedVersion:value.version,visit:visitFields(value as unknown as Visit)},true);return value as CenterVisit}
function checkedSnapshot(value:unknown):CenterOperationSnapshot{if(!record(value)||!Array.isArray(value.people)||!Array.isArray(value.visits))throw new OperationsRepositoryError('업무 목록 응답 형식이 올바르지 않습니다.',502);return {people:value.people.map(checkedPerson).filter(p=>!p.archived),visits:value.visits.map(checkedVisit).filter(v=>!v.archived)}}
function checkedResult(value:unknown,action:CenterOperationMutation['action']):CenterOperationResult{if(!record(value))throw new OperationsRepositoryError('업무 저장 응답을 확인하지 못했습니다.',502);if(action==='upsertPerson'||action==='archivePerson')return {person:checkedPerson(value.person)};return {visit:checkedVisit(value.visit)}}
async function body(response:Response):Promise<unknown>{let value:unknown;try{value=await response.json()}catch{throw new OperationsRepositoryError('서버 응답을 확인하지 못했습니다. 입력을 보존했습니다.',response.status)}if(!response.ok)throw new OperationsRepositoryError(record(value)&&typeof value.error==='string'?value.error:'업무 요청을 처리하지 못했습니다.',response.status);return value}
export const serverOperationsRepository:OperationsRepository={
 async list(){return checkedSnapshot(await body(await fetch('/api/center/operations',{credentials:'same-origin'})))},
 async mutate(input){const mutation=parseCenterOperationMutation(input);return checkedResult(await body(await fetch('/api/center/operations',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(mutation)})),mutation.action)},
}
export const DEMO_OPERATIONS_STORAGE_KEY='gadream365:center-operations:demo:v1'
type DemoLedger=CenterOperationSnapshot&{planApplicationState?:unknown;monthScheduleState?:unknown;patientContractsState?:unknown;patientRecognitionsState?:unknown;patientRatesState?:unknown;patientMemosState?:unknown;workerMemosState?:unknown;requests:Record<string,{payload:string;result:CenterOperationResult}>}
function clone<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T}
/** Explicit fictitious-data repository. Server errors never fall back here. */
export function createDemoOperationsRepository(storage:Pick<Storage,'getItem'|'setItem'>):OperationsRepository{
 function read():DemoLedger{const raw=storage.getItem(DEMO_OPERATIONS_STORAGE_KEY);if(!raw)return {people:[],visits:[],requests:{}};try{const v:unknown=JSON.parse(raw);if(!record(v)||!record(v.requests)||!Array.isArray(v.people)||!Array.isArray(v.visits))throw new Error();return {people:v.people.map(checkedPerson),visits:v.visits.map(checkedVisit),requests:v.requests as DemoLedger['requests'],...(v.planApplicationState===undefined?{}:{planApplicationState:v.planApplicationState}),...(v.monthScheduleState===undefined?{}:{monthScheduleState:v.monthScheduleState}),...(v.patientContractsState===undefined?{}:{patientContractsState:v.patientContractsState}),...(v.patientRecognitionsState===undefined?{}:{patientRecognitionsState:v.patientRecognitionsState}),...(v.patientRatesState===undefined?{}:{patientRatesState:v.patientRatesState}),...(v.patientMemosState===undefined?{}:{patientMemosState:v.patientMemosState}),...(v.workerMemosState===undefined?{}:{workerMemosState:v.workerMemosState})}}catch{throw new OperationsRepositoryError('시연 업무 저장소를 읽지 못했습니다. 기존 자료를 지우지 않았습니다.',500)}}
 return {
 async list(){const s=read();return clone({people:s.people.filter(p=>!p.archived),visits:s.visits.filter(v=>!v.archived)})},
 async mutate(input){const m=parseCenterOperationMutation(input),s=read(),payload=JSON.stringify(m),prior=s.requests[m.requestId];if(prior){if(prior.payload!==payload)throw new OperationsRepositoryError('같은 요청 번호의 내용이 달라졌습니다.',409);return clone(checkedResult(prior.result,m.action))}
 let result:CenterOperationResult
 if(m.action==='upsertPerson'||m.action==='archivePerson'){
 const id=m.action==='upsertPerson'?m.person.id:m.id,old=s.people.find(p=>p.id===id)
 if((old?.version??0)!==m.expectedVersion||old?.archived)throw new OperationsRepositoryError('인물 자료가 변경·보관되었습니다. 다시 조회하세요.',409)
 if(m.action==='archivePerson'){if(!old)throw new OperationsRepositoryError('인물을 찾지 못했습니다.',404);if(hasDemoAssignmentReference(storage,id))throw new OperationsRepositoryError('담당 배정을 먼저 해제하세요.',409);if(hasDemoWeeklyPlanReference(storage,id))throw new OperationsRepositoryError('연결된 주간 계획을 먼저 정리하세요.',409);if(s.visits.some(v=>!v.archived&&(visitWorkerIds(v).includes(id)||v.patientId===id)))throw new OperationsRepositoryError('연결된 방문일정을 먼저 보관하세요.',409);result={person:{...old,archived:true,version:(old.version??0)+1}}}
 else{if(old&&old.kind!==m.person.kind)throw new OperationsRepositoryError('대상 종류는 바꿀 수 없습니다.',409);result={person:{...m.person,version:(old?.version??0)+1,archived:false}}}
 s.people=[result.person,...s.people.filter(p=>p.id!==id)]
 }else{
 const id=m.action==='upsertVisit'?m.visit.id:m.id,old=s.visits.find(v=>v.id===id)
 if((old?.version??0)!==m.expectedVersion||old?.archived)throw new OperationsRepositoryError('일정이 변경·보관되었습니다. 다시 조회하세요.',409)
 if(m.action==='archiveVisit'){if(!old)throw new OperationsRepositoryError('일정을 찾지 못했습니다.',404);result={visit:{...old,archived:true,version:(old.version??0)+1}}}
 else{const v=m.visit;if(!visitWorkerIds(v).every(id=>s.people.some(p=>p.id===id&&p.kind==='worker'&&!p.archived))||!s.people.some(p=>p.id===v.patientId&&p.kind==='patient'&&!p.archived))throw new OperationsRepositoryError('같은 기관의 직원과 수급자를 선택하세요.',400);result={visit:{...v,version:(old?.version??0)+1,archived:false}}}
 assertMonthlyScheduleEditable(s.monthScheduleState,old,result.visit);s.visits=[result.visit,...s.visits.filter(v=>v.id!==id)]
 }
 s.requests[m.requestId]={payload,result};storage.setItem(DEMO_OPERATIONS_STORAGE_KEY,JSON.stringify(s));return clone(result)
 },
 }
}
