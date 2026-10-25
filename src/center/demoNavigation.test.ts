import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CenterWorkspace from './CenterWorkspace'
import MemberGateway from './MemberGateway'

afterEach(() => vi.unstubAllGlobals())

function render(search: string, component: typeof CenterWorkspace | typeof MemberGateway) {
  vi.stubGlobal('window', { location: { search } })
  vi.stubGlobal('React', React)
  return renderToStaticMarkup(React.createElement(component))
}

describe('center links preserve explicit demo navigation', () => {
  it('keeps the administrator link inside the demo flow', () => {
    expect(render('?demo=1', CenterWorkspace)).toContain('href="/admin?demo=1"')
  })
  it('keeps the caregiver link inside the demo flow', () => {
    expect(render('?demo=1', MemberGateway)).toContain('href="/care?demo=1"')
  })
  it('preserves the real caregiver login route without explicit demo mode', () => {
    const html = render('', MemberGateway)
    expect(html).toContain('href="/care"')
    expect(html).not.toContain('/care?demo=1')
  })
})
