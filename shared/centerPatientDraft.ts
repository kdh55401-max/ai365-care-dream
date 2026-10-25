export type CenterPatientDraftTemplateId = 'service-record' | 'state-change-record' | 'service-result-evaluation'
export interface CenterPatientDraftInput { templateId: CenterPatientDraftTemplateId; patientName: string; sourceText: string }
const templates: Record<CenterPatientDraftTemplateId, { label: string; fields: string[] }> = {
  'service-record': { label: '급여제공기록지', fields: ['실제 급여제공일', '실제 제공 시작·종료 시각', '실제 제공한 급여 내용', '실제 관찰한 상태·특이사항', '실제 급여제공자', '급여제공자 서명', '수급자·보호자에게 제공한 일자·방법', '수령인 및 전달 증빙'] },
  'state-change-record': { label: '상태변화기록지', fields: ['실제 관찰일·시각', '확인할 대상 기간', '실제 관찰한 상태', '이전 상태와의 차이 또는 동일하다고 판단한 근거', '실제로 실시한 조치', '실제로 보고·전달한 대상과 내용', '실제 작성한 급여제공자', '급여제공자 서명'] },
  'service-result-evaluation': { label: '급여제공 결과평가', fields: ['실제 평가일', '평가 대상 기간', '연결할 급여제공계획', '실제 제공 결과와 확인 근거', '검토자가 작성할 총평·종합소견', '계획 반영 내용 또는 재작성 예외 판단근거', '실제 작성자', '필요한 검토·확인 및 서명'] },
}
export const CENTER_PATIENT_DRAFT_NOTICE = '입력자료를 정리한 작성틀입니다. 실제 AI 분석·공단 등록·서명·전달을 실행하지 않았습니다. 원문과 실제 수행 사실을 확인하여 빈 항목을 작성하세요.'
/** Source-preserving local scaffold; no AI inference, clock, signing or approval. */
export function createCenterPatientDraft(input: CenterPatientDraftInput) {
  if (!input || typeof input.templateId !== 'string' || !Object.prototype.hasOwnProperty.call(templates, input.templateId)) throw new Error('지원하는 수급자 기록 양식을 선택하세요.')
  if (typeof input.patientName !== 'string' || !input.patientName.trim() || input.patientName.trim().length > 100 || /[\0\r\n]/.test(input.patientName)) throw new Error('수급자 이름은 한 줄의 1~100자로 확인하세요.')
  if (typeof input.sourceText !== 'string' || !input.sourceText.trim() || input.sourceText.length > 20000 || input.sourceText.includes('\0')) throw new Error('입력자료는 내용이 있는 20,000자 이내의 일반 텍스트여야 합니다.')
  const template = templates[input.templateId], name = input.patientName.trim()
  return { title: `${name} · ${template.label}`, sourceText: input.sourceText, notice: CENTER_PATIENT_DRAFT_NOTICE,
    content: [template.label, '구분: 입력자료를 정리한 작성틀', `수급자: ${name}`, '작성일: [확인 필요]', '', CENTER_PATIENT_DRAFT_NOTICE, '아래 원문은 사용자가 입력한 자료이며, 확인되지 않은 내용을 사실로 확정하지 않습니다.', '', '━━ 입력자료 원문 시작 ━━', input.sourceText, '━━ 입력자료 원문 끝 ━━', '', '━━ 확인 후 작성할 항목 ━━', ...template.fields.map(field => `${field}: [확인 필요]`), '', '확인되지 않은 관찰 내용·일시·행위·서명·전달 증빙을 임의로 채우지 마세요.', '이 작성틀의 생성·저장은 평가 기준 충족이나 최종 문서 확정을 뜻하지 않습니다.'].join('\n') }
}
