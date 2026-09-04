import { describe, expect, it } from 'vitest'
import { csvEscape, toCsv } from './csv.js'

describe('csvEscape', () => {
  it('빈 값은 빈 문자열로 처리한다', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
  })
  it('쉼표·줄바꿈·따옴표가 있으면 따옴표로 감싸고 내부 따옴표를 이스케이프한다', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
  })
  it('평범한 문자열은 그대로 둔다', () => {
    expect(csvEscape('C01')).toBe('C01')
  })
})

describe('toCsv', () => {
  it('UTF-8 BOM과 CRLF 줄바꿈을 포함한 CSV를 만든다', () => {
    const csv = toCsv(['이름', '점수'], [['C01', 5], ['C02', 3]])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('이름,점수\r\n')
    expect(csv).toContain('C01,5\r\n')
    expect(csv).toContain('C02,3\r\n')
  })
})
