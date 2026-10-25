import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { CenterDocumentCoverage } from './CenterDocumentCoverage'
const props = { documents: [], patients: [{ id: 'synthetic', name: '가상 대상' }], loading: false, error: false, busy: false, onOpen: () => {} }
it('조회 실패나 로딩 중에는 미작성 칸을 렌더하지 않는다', () => {
  for (const patch of [{ error: true }, { loading: true }]) {
    const html = renderToStaticMarkup(createElement(CenterDocumentCoverage, { ...props, ...patch }))
    expect(html).not.toContain('cd-coverage-state')
    expect(html).not.toContain('<table>')
  }
})
it('조회가 완료된 명부에서만 미작성 칸과 상태 설명을 보여준다', () => {
  const html = renderToStaticMarkup(createElement(CenterDocumentCoverage, props))
  expect(html.match(/cd-coverage-missing/g)).toHaveLength(5)
  expect(html).toContain('실제 서명·제공·평가 충족을 뜻하지 않습니다')
})
