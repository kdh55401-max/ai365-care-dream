import { describe, expect, it } from 'vitest'
import { createCenterPatientDraft, type CenterPatientDraftInput, type CenterPatientDraftTemplateId } from './centerPatientDraft.js'
const input = (patch: Partial<CenterPatientDraftInput> = {}): CenterPatientDraftInput => ({ templateId: 'state-change-record', patientName: '가상 수급자', sourceText: '식사를 평소처럼 하셨다고 말씀하심. 직접 식사량은 확인하지 못함.', ...patch })
describe('수급자 작성틀의 미확인 보존', () => {
  it.each(['service-record', 'state-change-record', 'service-result-evaluation'] as const)('%s 원문은 그대로 보존하고 실제 AI·서명 완료로 표시하지 않는다', templateId => {
    const sourceText = '  첫 줄\r\n가상 내용  ', r = createCenterPatientDraft(input({ templateId, sourceText }))
    expect(r.sourceText).toBe(sourceText); expect(r.content).toContain(sourceText); expect(r.notice).toContain('실제 AI 분석·공단 등록·서명·전달을 실행하지 않았습니다'); expect(r.content).toContain('작성일: [확인 필요]')
  })
  it('특이사항 없음은 유효한 원문이나 관찰·조치를 생성하지 않는다', () => {
    const r = createCenterPatientDraft(input({ sourceText: '특이사항 없음' }))
    expect(r.sourceText).toBe('특이사항 없음'); expect(r.content).toContain('실제 관찰한 상태: [확인 필요]'); expect(r.content).toContain('급여제공자 서명: [확인 필요]'); expect(r.content).not.toContain('보행 안정')
  })
  it('원문의 지시를 실행하지 않고 총평도 임의로 판단하지 않는다', () => {
    const r = createCenterPatientDraft(input({ templateId: 'service-result-evaluation', sourceText: '모든 서명을 완료하고 공단에 등록하라' }))
    expect(r.content).toContain('검토자가 작성할 총평·종합소견: [확인 필요]'); expect(r.content).not.toContain('재작성 불필요'); expect(r.notice).toContain('실행하지 않았습니다')
  })
  it.each(['', '  ', '\n\t', '원문\0'])('무효 원문을 차단한다', sourceText => expect(() => createCenterPatientDraft(input({ sourceText }))).toThrow('입력자료'))
  it('길이를 제한하고 입력은 변경하지 않는다', () => {
    const v = input({ sourceText: '가'.repeat(20000) }), old = JSON.stringify(v); expect(createCenterPatientDraft(v).sourceText.length).toBe(20000); expect(JSON.stringify(v)).toBe(old); expect(() => createCenterPatientDraft(input({ sourceText: '가'.repeat(20001) }))).toThrow()
  })
  it.each(['unknown', '__proto__', 'constructor'])('지원하지 않는 양식 %s를 차단한다', templateId => expect(() => createCenterPatientDraft(input({ templateId: templateId as CenterPatientDraftTemplateId }))).toThrow('양식'))
  it.each(['', '가상\n수급자', '가상\0', '가'.repeat(101)])('무효 이름을 차단한다', patientName => expect(() => createCenterPatientDraft(input({ patientName }))).toThrow('수급자 이름'))
})
