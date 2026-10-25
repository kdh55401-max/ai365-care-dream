import {useEffect,useMemo,useSyncExternalStore} from 'react'
import type {Person,Visit} from './model'
import type {CenterPerson,CenterVisit,CenterOperationMutation,CenterOperationResult} from '../../shared/centerOperations'
import {createDemoOperationsRepository,serverOperationsRepository,personFields,visitFields,type OperationsRepository} from './operationsRepo'
type WithoutRequest<T> = T extends unknown ? Omit<T,'requestId'> : never
export function createOperationsController(repository:OperationsRepository){
 let state={people:[] as CenterPerson[],visits:[] as CenterVisit[],loading:true,error:'',saving:false}
 let reads=0,epoch=0,writes=0,latestWrite=0
 const listeners=new Set<()=>void>(),retryIds=new Map<string,string>()
 const publish=(next:typeof state)=>{state=next;for(const listener of listeners)listener()}
 const stable=(value:unknown):string=>{if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;return JSON.stringify(value)??'null'}
 async function mutate(fields:WithoutRequest<CenterOperationMutation>):Promise<CenterOperationResult>{
 const signature=stable(fields),requestId=retryIds.get(signature)??crypto.randomUUID();retryIds.set(signature,requestId)
 const write=++latestWrite,lifetime=epoch;reads++;writes++;publish({...state,saving:true,error:''})
 try{const result=await repository.mutate({...fields,requestId} as CenterOperationMutation)
 if(lifetime===epoch){reads++;const merge=<T extends {id:string;version?:number;archived?:boolean}>(items:T[],item:T)=>{const old=items.find(p=>p.id===item.id);if(old&&(old.version??0)>(item.version??0))return items;return item.archived?items.filter(p=>p.id!==item.id):[item,...items.filter(p=>p.id!==item.id)]};publish({...state,people:'person'in result?merge(state.people,result.person):state.people,visits:'visit'in result?merge(state.visits,result.visit):state.visits,loading:false,error:write===latestWrite?'':state.error})}
 retryIds.delete(signature);return result
 }catch(failure){if(lifetime===epoch&&write===latestWrite)publish({...state,loading:false,error:failure instanceof Error?failure.message:'저장하지 못했습니다. 입력을 보존했습니다.'});throw failure}
 finally{if(lifetime===epoch){writes--;publish({...state,saving:writes>0})}}
 }
 return {
 snapshot:()=>state,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},cancel(){reads++;epoch++},reset(){reads++;epoch++;writes=0;retryIds.clear();publish({people:[],visits:[],loading:true,error:'',saving:false})},
 async reload(){const read=++reads,lifetime=epoch;publish({...state,loading:true,error:''});try{const snapshot=await repository.list();if(read===reads&&lifetime===epoch)publish({...state,...snapshot,loading:false,error:''})}catch(failure){if(read===reads&&lifetime===epoch)publish({...state,people:[],visits:[],loading:false,error:failure instanceof Error?failure.message:'업무 저장소를 조회하지 못했습니다.'})}},
 async savePerson(person:Person&{version?:number}){const r=await mutate({action:'upsertPerson',person:personFields(person),expectedVersion:person.version??0});if(!('person'in r))throw new Error('인물 저장 결과를 확인하지 못했습니다.');return r.person},
 async saveVisit(visit:Visit&{version?:number}){const r=await mutate({action:'upsertVisit',visit:visitFields(visit),expectedVersion:visit.version??0});if(!('visit'in r))throw new Error('일정 저장 결과를 확인하지 못했습니다.');return r.visit},
 async archivePerson(person:Person&{version?:number}){return mutate({action:'archivePerson',id:person.id,expectedVersion:person.version??0})},
 async archiveVisit(visit:Visit&{version?:number}){return mutate({action:'archiveVisit',id:visit.id,expectedVersion:visit.version??0})},
 }
}
export function useCenterOperations(preview:boolean,enabled:boolean){
 const repository=useMemo(()=>preview?createDemoOperationsRepository(window.localStorage):serverOperationsRepository,[preview])
 const controller=useMemo(()=>createOperationsController(repository),[repository])
 const snapshot=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot)
 useEffect(()=>{if(enabled)void controller.reload();else controller.reset();return controller.reset},[controller,enabled])
 return {...snapshot,reload:controller.reload,savePerson:controller.savePerson,saveVisit:controller.saveVisit,archivePerson:controller.archivePerson,archiveVisit:controller.archiveVisit}
}
