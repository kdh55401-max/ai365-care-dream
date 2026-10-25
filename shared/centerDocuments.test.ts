import { emptyStateChange, serializeStateChange } from './centerStateChange.js'
import { describe, expect, it } from 'vitest'
import { applyCenterDocumentMutation, parseCenterDocumentMutation, summarizeCenterDocuments } from './centerDocuments.js'
import type { CenterDocument, CenterDocumentMutation } from './centerDocuments.js'
const requestId = '00000000-0000-0000-0000-000000000001'
const id = '00000000-0000-0000-0000-000000000002'
const fields = { templateId:'case-management', title:'사례관리', subjectKind:'agency', subjectId:null, period:'2026-06', content:'가상 문서 본문', resultEvaluationCompleted:false } as const
const ctx = { organizationCode:'TEST', documentId:id, now:'2026-10-21T00:00:00.000Z' }
const create = () => applyCenterDocumentMutation(null, {action:'create',requestId,...fields}, ctx)
describe('센터 문서 입력·명시 확정·현황 계약', () => {
  it('서버 소유 상태·기관·버전을 입력에 주입할 수 없다', () => {
    for (const key of ['organizationCode','status','version','confirmedAt']) expect(() => parseCenterDocumentMutation({action:'create',requestId,...fields,[key]:'injected'})).toThrow()
  })
  it('연월·본문·boolean·요청번호·대상/양식 관계를 검사한다', () => {
    for (const patch of [{period:'2026-13'},{period:'0000-01'},{content:'x'.repeat(80001)},{resultEvaluationCompleted:'true'},{requestId:'not-uuid'},{subjectKind:'patient',subjectId:'A01'},{templateId:'staff-meeting',resultEvaluationCompleted:true}]) expect(() => parseCenterDocumentMutation({action:'create',requestId,...fields,...patch})).toThrow()
  })
  it('create는 초안이고 수정은 버전 증가, 확정은 명시 요청이어야 한다', () => {
    const draft=create()
    expect(draft).toMatchObject({status:'draft',version:1,confirmedAt:null})
    const revised=applyCenterDocumentMutation(draft,{action:'revise',id,expectedVersion:1,requestId,...fields,content:'수정 본문'},ctx)
    expect(revised).toMatchObject({version:2,status:'draft',content:'수정 본문'})
    const confirmed=applyCenterDocumentMutation(revised,{action:'confirm',id,expectedVersion:2,requestId},ctx)
    expect(confirmed).toMatchObject({version:3,status:'confirmed',confirmedAt:ctx.now})
    expect(() => applyCenterDocumentMutation(confirmed,{action:'confirm',id,expectedVersion:3,requestId},ctx)).toThrow('확정')
  })
  it('다른 기관·오래된 버전·빈 본문의 확정을 거부한다', () => {
    expect(() => applyCenterDocumentMutation(create(),{action:'confirm',id,expectedVersion:1,requestId},{...ctx,organizationCode:'OTHER'})).toThrow('기관')
    expect(() => applyCenterDocumentMutation(create(),{action:'confirm',id,expectedVersion:2,requestId},ctx)).toThrow('변경')
    expect(() => applyCenterDocumentMutation({...create(),content:' '},{action:'confirm',id,expectedVersion:1,requestId},ctx)).toThrow('본문')
  })
  it('사례관리 반기 현황은 결과평가 true만 세며 확정 상태와 별개다', () => {
    const base=create()
    const documents: CenterDocument[]=[base,{...base,id:'b',resultEvaluationCompleted:true},{...base,id:'c',period:'2026-07',resultEvaluationCompleted:true,status:'confirmed',confirmedAt:ctx.now},{...base,id:'d',period:'2025-07',resultEvaluationCompleted:true},{...base,id:'e',resultEvaluationCompleted:'true' as unknown as boolean}]
    expect(summarizeCenterDocuments(documents,2026).find(row=>row.templateId==='case-management')?.periods.map(row=>row.count)).toEqual([1,1])
  })
  it('같은 문서 중복 집계와 다른 연도 혼입을 막는다', () => {
    const document={...create(),templateId:'staff-meeting',resultEvaluationCompleted:false}
    const summary=summarizeCenterDocuments([document,document,{...document,id:'past',period:'2025-06'}],2026).find(row=>row.templateId==='staff-meeting')!
    expect(summary.periods).toHaveLength(12)
    expect(summary.periods[5].documentIds).toEqual([id])
    expect(summary.periods.reduce((sum,row)=>sum+row.count,0)).toBe(1)
  })
  it('confirm는 수정 내용과 함께 보낼 수 없다', () => {
    expect(() => parseCenterDocumentMutation({action:'confirm',id,expectedVersion:1,requestId,content:'숨은 수정'})).toThrow()
  })
  it('공유 mutation 타입의 완전한 필드를 정규화한다', () => {
    const mutation: CenterDocumentMutation={action:'create',requestId,...fields,title:'  제목  '}
    expect(parseCenterDocumentMutation({...mutation})).toMatchObject({title:'제목',subjectId:null})
  })
})

it('수급자 기록은 UUID와 대상·양식 불변을 요구하고 평가 충족으로 합산하지 않는다',()=>{const patientId='00000000-0000-0000-0000-000000000003';for(const templateId of ['service-record','state-change-record','service-result-evaluation']){const input={action:'create' as const,requestId,...fields,templateId,subjectKind:'patient' as const,subjectId:patientId};const d=applyCenterDocumentMutation(null,input,ctx);expect(d.subjectId).toBe(patientId);expect(d.resultEvaluationCompleted).toBe(false);expect(()=>parseCenterDocumentMutation({...input,subjectId:'A01'})).toThrow();expect(()=>applyCenterDocumentMutation(d,{...input,action:'revise',id,expectedVersion:1,subjectId:'00000000-0000-0000-0000-000000000004'},ctx)).toThrow('대상');expect(summarizeCenterDocuments([d],2026).find(r=>r.templateId==='case-management')?.periods.every(p=>p.count===0)).toBe(true)}})


describe('상태변화 구조화 문서 저장 검증', () => {
  const patient = { ...fields, templateId: 'state-change-record', subjectKind: 'patient' as const, subjectId: '00000000-0000-0000-0000-000000000003', period: '2026-06' }
  it('화면 밖 create/revise도 실제 날짜와 기준월을 검사한다', () => {
    const record = emptyStateChange()
    record.weeks[0] = { ...record.weeks[0], date: '2026-06-05', remarks: '가상 관찰: 부축 후 휴식함.' }
    const draft = applyCenterDocumentMutation(null, { action: 'create', requestId, ...patient, content: serializeStateChange(record) }, ctx)
    for (const date of ['2026-05-31', '2026-06-31']) {
      record.weeks[0].date = date
      const content = ' \n' + serializeStateChange(record)
      expect(() => parseCenterDocumentMutation({ action: 'create', requestId, ...patient, content })).toThrow(date === '2026-05-31' ? '기준월' : '올바른 날짜')
      expect(() => applyCenterDocumentMutation(draft, { action: 'revise', requestId, id, expectedVersion: 1, ...patient, content }, ctx)).toThrow()
    }
    expect(draft).toMatchObject({ version: 1, content: expect.stringContaining('2026-06-05') })
  })
  it('빈 구조화 서식은 저장하지 않고 기존 자유서술 기록은 보존한다', () => {
    expect(() => parseCenterDocumentMutation({ action: 'create', requestId, ...patient, content: serializeStateChange(emptyStateChange()) })).toThrow('한 주 이상')
    expect(parseCenterDocumentMutation({ action: 'create', requestId, ...patient, content: '기존 자유서술 상태변화 기록' })).toMatchObject({ content: '기존 자유서술 상태변화 기록' })
  })
})
