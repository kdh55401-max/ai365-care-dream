import { describe, expect, it } from 'vitest'
import { emptyStateChange } from './centerStateChange.js'
import { stateChangeHml } from './centerStateChangeHml.js'

describe('상태변화 기록지 .hml', () => {
  it('서식 문구·입력값을 담고 특수문자는 이스케이프하며 표 칸 수가 맞는다', () => {
    const record = emptyStateChange()
    record.weeks[0] = { ...record.weeks[0], date: '2026-10-06', remarks: 'A & B <관찰>', result: '지원' }
    record.weeks[0].checks.safety = true
    const hml = stateChangeHml(record, { centerName: '센터', patientName: '가상 수급자', grade: '4등급', period: '2026-10', draft: true })
    expect(hml).toContain('( 2026 )년 ( 10 )월 상태변화 기록지'); expect(hml).toContain('급여제공자 서명')
    expect(hml).toContain('A &amp; B &lt;관찰&gt;'); expect(hml).toContain('☑안전'); expect(hml).toContain('<CHAR>10/6</CHAR>')
    const rows = hml.match(/<ROW>/g)!.length
    expect(hml).toContain(`RowCount="${rows}"`)
    for (const row of hml.split('<ROW>').slice(1)) {
      const widths = [...row.matchAll(/ColSpan="(\d)"[^>]* Width="(\d+)"/g)].map(m => Number(m[2]))
      expect(widths.reduce((a, b) => a + b, 0)).toBe(53759)
    }
    expect(hml).not.toMatch(/이지케어|이지엠소프트/)
  })
})


it('초안과 시연 표시를 출력 파일에 보존하고 XML 태그 입력을 실행하지 않는다', () => {
 const record = emptyStateChange()
 record.weeks[0].remarks = '<가상관찰> & 결과'
 const h = { patientName: '가상 대상', centerName: '', grade: '', period: '2026-10', draft: true, preview: true }
 const text = stateChangeHml(record, h)
 expect(text).toContain('초안 · 확정 전 출력물')
 expect(text).toContain('가상자료 시연 · 실제 기관 기록 아님')
 expect(text).toContain('&lt;가상관찰&gt; &amp; 결과')
 expect(text).not.toContain('<가상관찰>')
 const finalText = stateChangeHml(record, { ...h, draft: false, preview: false })
 expect(finalText).not.toContain('초안 · 확정 전 출력물')
 expect(finalText).not.toContain('가상자료 시연 · 실제 기관 기록 아님')
})

describe('한글 서식 시각 개선', () => {
  it('날짜에 요일, 체크한 항목만 굵게·음영, 빈 칸에는 손글씨 줄선, 추가한 서식 정의 번호가 목록에 있다', () => {
    const record = emptyStateChange()
    record.weeks[0] = { ...record.weeks[0], date: '2026-10-06', remarks: '관찰함' }
    record.weeks[0].checks.safety = true
    for (const orientation of ['portrait', 'landscape'] as const) {
      const hml = stateChangeHml(record, { centerName: '센터', patientName: '가상', grade: '4등급', period: '2026-10', draft: false }, orientation)
      expect(hml).toContain('<CHAR>(화)</CHAR>')
      expect(hml.match(/<TEXT CharShape="20"><CHAR>/g)).toHaveLength(1)
      expect(hml.match(/<P ParaShape="20" Style="0">/g)!.length).toBeGreaterThanOrEqual(4 * 4)
      for (const [list, tag] of [['CHARSHAPELIST', 'CHARSHAPE'], ['PARASHAPELIST', 'PARASHAPE'], ['BORDERFILLLIST', 'BORDERFILL']]) {
        const body = hml.match(new RegExp(`<${list} Count="(\\d+)">([\\s\\S]*?)</${list}>`))!
        expect(body[2].match(new RegExp(`<${tag} `, 'g'))).toHaveLength(Number(body[1]))
      }
    }
  })
})
