import {describe,it,expect} from 'vitest'
import {parseCenterImportInput,validateCenterExtraction} from './centerImport.js'
const source='이름: 가상 하나\n입사일: 2026-01-02\n직종: 요양보호사'
const fields={name:'가상 하나',status:null,category:'요양보호사',start:'2026-01-02',end:null,examination:null}
const result={fields,evidence:{name:'이름: 가상 하나',category:'직종: 요양보호사',start:'입사일: 2026-01-02'},ambiguous:false}
describe('인물 자료 AI 추출 계약',()=>{
 it('명시된 값과 원문근거만 유지하고 없는값은null로 둔다',()=>expect(validateCenterExtraction(result,source)).toEqual({...result,reasons:[]}))
 it('추측·원문밖근거·비실제날짜를 저장값에서 제거한다',()=>{const r=validateCenterExtraction({...result,fields:{...fields,status:'활동',start:'2026-02-30'},evidence:{...result.evidence,status:'활동',start:'입사일: 2026-02-30'}},source);expect(r.fields.status).toBeNull();expect(r.fields.start).toBeNull();expect(r.reasons).toHaveLength(2)})
 it('여러 이름과 모델의 모호성 신호는 검토 필요로 유지한다',()=>{expect(validateCenterExtraction(result,source+'\n이름: 가상 둘').ambiguous).toBe(true);expect(validateCenterExtraction({...result,ambiguous:true},source).ambiguous).toBe(true)})
 it('명확한 날짜라도 기간이 뒤집히면 자동저장을 보류한다',()=>{const text=source+'\n종료일: 2025-12-31';const r=validateCenterExtraction({...result,fields:{...fields,end:'2025-12-31'},evidence:{...result.evidence,end:'종료일: 2025-12-31'}},text);expect(r.fields.end).toBe('2025-12-31');expect(r.reasons).toContain('시작일과 종료일의 순서를 확인해야 합니다.')})
 it('기관/역할주입·빈자료·지나친원문을 거절한다',()=>{const base={kind:'worker',sourceText:source,requestId:'00000000-0000-0000-0000-000000000001'};expect(parseCenterImportInput(base)).toEqual(base);for(const patch of [{organizationCode:'OTHER'},{kind:'master'},{sourceText:' '},{sourceText:'x'.repeat(20001)},{requestId:'bad'}])expect(()=>parseCenterImportInput({...base,...patch})).toThrow()})
})
