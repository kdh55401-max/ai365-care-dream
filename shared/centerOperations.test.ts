import {describe,expect,it} from 'vitest'
import {isCenterDate,parseCenterOperationMutation} from './centerOperations.js'
const id='00000000-0000-0000-0000-000000000001',requestId='00000000-0000-0000-0000-000000000002'
const person={id,kind:'worker',name:'가상 직원',status:'재직',category:'요양보호사',start:'2026-01-01',end:'',examination:'',notes:{}}
const input={action:'upsertPerson',requestId,expectedVersion:0,person}
describe('기관 업무 입력 계약',()=>{
 it('기존 필드 보존·메타데이터 서버 결정',()=>expect(parseCenterOperationMutation({...input,person:{...person,version:99,archived:true}})).toEqual(input))
 it('기관·권한·알 수 없는 필드 주입 거절',()=>{for(const v of [{...input,organizationCode:'OTHER'},{...input,person:{...person,role:'master'}}])expect(()=>parseCenterOperationMutation(v)).toThrow()})
 it('달력·UUID·정수 버전과 보관 버전 검사',()=>{expect(isCenterDate('2024-02-29')).toBe(true);for(const d of ['2026-02-29','2026-13-01','1899-01-01'])expect(isCenterDate(d)).toBe(false);for(const patch of [{requestId:'name'},{expectedVersion:-1},{expectedVersion:1.1}])expect(()=>parseCenterOperationMutation({...input,...patch})).toThrow();expect(()=>parseCenterOperationMutation({action:'archivePerson',requestId,id,expectedVersion:0})).toThrow()})
 it('일정 인물UUID·날짜·시간·분수 검사',()=>{const visit={id,date:'2026-10-22',time:'09:30',workerId:id,patientId:requestId,service:'요양',minutes:60};expect(parseCenterOperationMutation({action:'upsertVisit',requestId,expectedVersion:0,visit})).toMatchObject({visit});for(const patch of [{time:'24:00'},{date:'2026-02-30'},{minutes:0},{workerId:'이름'}])expect(()=>parseCenterOperationMutation({action:'upsertVisit',requestId,expectedVersion:0,visit:{...visit,...patch}})).toThrow()})
})

describe('방문 제공자 수·기존 자료 호환',()=>{
 const worker='00000000-0000-4000-8000-000000000003',other='00000000-0000-4000-8000-000000000004'
 const visit={id,date:'2026-10-22',time:'09:30',workerId:worker,patientId:requestId,service:'목욕',minutes:60}
 const mutation=(value:unknown)=>({action:'upsertVisit',requestId,expectedVersion:0,visit:value})
 it('목욕 두 명과 대표 제공자 순서를 보존한다',()=>expect(parseCenterOperationMutation(mutation({...visit,workerIds:[worker,other]}))).toMatchObject({visit:{workerId:worker,workerIds:[worker,other]}}))
 it.each(['목욕','방문목욕'])('%s는 새 저장에 서로 다른 두 명이 필요하다',service=>{
  for(const workerIds of [undefined,[worker],[worker,worker],[other,worker],[worker,other,id]])expect(()=>parseCenterOperationMutation(mutation({...visit,service,workerIds}))).toThrow()
 })
 it.each(['요양','방문요양','간호','방문간호','기타'])('%s는 한 명을 선택한다',service=>{
  expect(parseCenterOperationMutation(mutation({...visit,service,workerIds:[worker]}))).toMatchObject({visit:{workerIds:[worker]}})
  expect(()=>parseCenterOperationMutation(mutation({...visit,service,workerIds:[worker,other]}))).toThrow()
 })
 it('기존 1인 목욕은 읽기만 허용하며 잘못된 새 배열은 읽기에도 거절한다',()=>{
  expect(parseCenterOperationMutation(mutation(visit),true)).toMatchObject({visit})
  expect(()=>parseCenterOperationMutation(mutation(visit))).toThrow()
  expect(()=>parseCenterOperationMutation(mutation({...visit,workerIds:[worker]}),true)).toThrow()
 })
})
