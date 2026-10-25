import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CenterEvaluationEvidence } from './CenterEvaluationEvidence'
import type { CenterDocumentView } from './CenterDocuments'
const view: CenterDocumentView = { documents: [], loading: false, error: '', reload: async () => {}, saved: () => {}, repository: { list: async () => [], mutate: async () => { throw new Error('not used') } } }
function render(preview: boolean, year = 2026, error = '') {
  return renderToStaticMarkup(createElement(CenterEvaluationEvidence, { preview, year, people: [], peopleLoading: false, peopleError: error, view, openDocuments: () => {} }))
}
describe('평가 증빙 UI의 운영·시연 경계', () => {
  it('운영에서 네 기준은 확인 필요이고 가상 승인 버튼이 없다', () => {
    const html = render(false)
    expect((html.match(/data-status="unknown"/g) || []).length).toBe(4)
    expect(html).not.toContain('가상 상태 변화 시연')
    expect(html).not.toContain('data-status="satisfied"')
    expect(html).toContain('제공 증빙·서명·공단 전송 확인은 아직 연결 전')
  })
  it('데모 상태 전환은 비저장 시연임을 명시한다', () => {
    const html = render(true)
    expect(html).toContain('가상 상태 변화 시연')
    expect(html).toContain('반영·저장되지 않습니다')
    expect(html).toContain('확인 후 문서 개정')
    expect(html).not.toContain('data-status="satisfied"')
  })
  it('다른 연도 기준과 조회 실패를 완료로 표시하지 않는다', () => {
    expect(render(false, 2027)).toContain('해당 연도 판정에 적용하지 않습니다')
    expect(render(false, 2026, '조회 오류')).toContain('수급자 조회 실패')
  })
})
