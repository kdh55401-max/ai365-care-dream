import { describe, expect, it } from 'vitest'
import { emptyStateChange } from './centerStateChange.js'
import { stateChangePrintHtml } from './centerStateChangePrint.js'

describe('상태변화 기록지 인쇄 문서', () => {
  it('서식 제목·주차 행·체크 표시를 담고 입력은 이스케이프한다', () => {
    const record = emptyStateChange()
    record.weeks[0] = { ...record.weeks[0], date: '2026-10-06', remarks: '<b>부축</b>\n관찰', result: '지원' }
    record.weeks[0].checks.safety = true
    const html = stateChangePrintHtml(record, { centerName: '센터', patientName: '가상 수급자', grade: '4등급', period: '2026-10', draft: true })
    expect(html).toContain('( 2026 )년 ( 10 )월 상태변화 기록지')
    expect(html).toContain('10/6'); expect(html).toContain('☑안전'); expect(html).toContain('□신체')
    expect(html).toContain('&lt;b&gt;부축&lt;/b&gt;<br>관찰'); expect(html).not.toContain('<b>부축')
    expect(html.match(/<td class="c">\d<\/td><td class="c">/g)).toHaveLength(5)
    expect(html).toContain('초안 · 확정 전 출력물'); expect(html).toContain('급여제공자 서명'); expect(html.match(/class="sig"/g)).toHaveLength(5)
  })
})
