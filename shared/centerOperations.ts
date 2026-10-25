export interface CenterPerson { id:string; kind:'worker'|'patient'; name:string; status:string; category:string; start:string; end:string; examination:string; notes:Record<string,string>; version?:number; archived?:boolean }
export interface CenterVisit { id:string; date:string; time:string; workerId:string; workerIds?:string[]; patientId:string; service:string; minutes:number; version?:number; archived?:boolean }
export interface CenterOperationSnapshot { people:CenterPerson[]; visits:CenterVisit[] }
export type CenterOperationMutation = {action:'upsertPerson';requestId:string;expectedVersion:number;person:CenterPerson}|{action:'upsertVisit';requestId:string;expectedVersion:number;visit:CenterVisit}|{action:'archivePerson';requestId:string;expectedVersion:number;id:string}|{action:'archiveVisit';requestId:string;expectedVersion:number;id:string}
export type CenterOperationResult = {person:CenterPerson}|{visit:CenterVisit}
export class CenterOperationError extends Error {
  statusCode:number
  constructor(statusCode:number,message:string){super(message);this.statusCode=statusCode}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function fail():never {throw new CenterOperationError(400,'직원·수급자·일정 입력을 확인하세요.')}
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Record<string,unknown>}
function keys(v:Record<string,unknown>, allowed:string[]){if(Object.keys(v).some(k=>!allowed.includes(k)))fail()}
function id(v:unknown):string{if(typeof v!=='string'||!uuid.test(v))fail();return v.toLowerCase()}
function str(v:unknown,max:number,required=false):string{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail();return v}
export function isCenterDate(v:string):boolean {if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'1900-01-01'||v>'2199-12-31')return false;const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v}
function date(v:unknown,optional=false):string{if(optional&&v==='')return '';if(typeof v!=='string'||!isCenterDate(v))fail();return v}
/** Provider counts observed in EZcare's visit-plan UI, not a billing eligibility decision. */
export function requiredVisitProviderCount(service:string):1|2 {return ['목욕','방문목욕'].includes(service.trim())?2:1}
export function visitWorkerIds(visit:Pick<CenterVisit,'workerId'|'workerIds'>):string[]{return visit.workerIds??[visit.workerId]}
export function parseCenterOperationMutation(input:unknown,allowLegacyVisitProviders=false):CenterOperationMutation {
 const v=record(input),action=v.action;if(!['upsertPerson','upsertVisit','archivePerson','archiveVisit'].includes(String(action)))fail();keys(v,['action','requestId','expectedVersion',action==='upsertPerson'?'person':action==='upsertVisit'?'visit':'id']);const requestId=id(v.requestId);if(!Number.isSafeInteger(v.expectedVersion)||Number(v.expectedVersion)<0)fail();const expectedVersion=Number(v.expectedVersion);
 if(action==='archivePerson'||action==='archiveVisit'){if(!expectedVersion)fail();return {action,requestId,expectedVersion,id:id(v.id)}}
 if(action==='upsertPerson'){const p=record(v.person);keys(p,['id','kind','name','status','category','start','end','examination','notes','version','archived']);if(p.kind!=='worker'&&p.kind!=='patient')fail();const notes=record(p.notes);if(Object.keys(notes).length>100)fail();const parsedNotes:Record<string,string>={};for(const [k,val]of Object.entries(notes)){if(!k||k.length>100||['__proto__','constructor','prototype'].includes(k))fail();parsedNotes[k]=str(val,20000)}return {action,requestId,expectedVersion,person:{id:id(p.id),kind:p.kind,name:str(p.name,100,true),status:str(p.status,100),category:str(p.category,100),start:date(p.start,true),end:date(p.end,true),examination:date(p.examination,true),notes:parsedNotes}}}
 const p=record(v.visit);keys(p,['id','date','time','workerId','workerIds','patientId','service','minutes','version','archived']);if(typeof p.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time)||!Number.isSafeInteger(p.minutes)||Number(p.minutes)<1||Number(p.minutes)>1440)fail();const workerId=id(p.workerId),service=str(p.service,100,true)
 if(p.workerIds!==undefined&&(!Array.isArray(p.workerIds)||p.workerIds.length<1||p.workerIds.length>2))fail()
 const providers=p.workerIds===undefined?[workerId]:(p.workerIds as unknown[]).map(id)
 if(providers[0]!==workerId||new Set(providers).size!==providers.length)fail()
 if(!(allowLegacyVisitProviders&&p.workerIds===undefined)&&providers.length!==requiredVisitProviderCount(service))throw new CenterOperationError(400,requiredVisitProviderCount(service)===2?'목욕 일정은 서로 다른 제공자 2명을 선택하세요.':'요양·간호 및 일반 일정은 제공자 1명을 선택하세요.')
 return {action:'upsertVisit',requestId,expectedVersion,visit:{id:id(p.id),date:date(p.date),time:p.time,workerId,...(p.workerIds===undefined?{}:{workerIds:providers}),patientId:id(p.patientId),service,minutes:Number(p.minutes)}}
}
