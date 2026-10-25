import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CenterDocuments, type CenterDocumentView } from './CenterDocuments'
const patient = {id:'00000000-0000-0000-0000-000000000011',kind:'patient' as const,name:'가상 대상',status:'',category:'',start:'',end:'',examination:'',notes:{}}
const view: CenterDocumentView = {documents:[],loading:false,error:'',reload:async()=>{},saved:()=>{},repository:{list:async()=>[],mutate:async()=>{throw new Error('not used')}}}
describe('수급자 기록 작성 진입',()=>{
  it('평가에서 받은 수급자와 양식으로 작성 폼을 열고 실제 AI와 구분한다',()=>{
    const html=renderToStaticMarkup(createElement(CenterDocuments,{view,preview:true,people:[patient],start:{templateId:'state-change-record',personId:patient.id}}))
    expect(html).toContain('새 문서 작성');expect(html).toContain('상태변화기록지');expect(html).toContain('가상 대상');expect(html).toContain('원문을 보존한 작성틀 넣기');expect(html).toContain('AI 분석·공단 등록·실제 서명은 실행하지 않습니다')
  })
})


it('수급자 후보가 없는 작성 화면은 안내하고 저장을 막는다', () => {
 const html = renderToStaticMarkup(createElement(CenterDocuments, { view, preview: true, people: [], start: { templateId: 'state-change-record', personId: '' } }))
 expect(html).toContain('문서 대상 안내')
 expect(html).toContain('수급자관리에서 등록·조회 상태를 확인')
 expect(html).toMatch(/<button class="cd-primary" disabled="">초안 저장<\/button>/)
})
