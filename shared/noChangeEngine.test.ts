import { describe, expect, it } from 'vitest'
import {
  buildNoChangeReport,
  classifyDomainsFromText,
  detectNoChangePhrase,
  mergeDomainEntries,
  shouldSkipSecondQuestion,
} from './noChangeEngine.js'

describe('detectNoChangePhrase', () => {
  it('"특이사항 없음" 계열 표현을 감지한다', () => {
    expect(detectNoChangePhrase('오늘은 특별히 달라진 점이 없었어요')).toBe(true)
    expect(detectNoChangePhrase('평소와 같았습니다')).toBe(true)
    expect(detectNoChangePhrase('오늘 아침부터 어지럽다고 하셨어요')).toBe(false)
  })
})

describe('classifyDomainsFromText — 사양서 예시 문장', () => {
  it('"식사는 평소만큼 드셨고 걸으시는 것도 같았어요. 배설은 확인 못했어요."', () => {
    const entries = classifyDomainsFromText('식사는 평소만큼 드셨고 걸으시는 것도 같았어요. 배설은 확인 못했어요.')
    const byDomain = Object.fromEntries(entries.map((e) => [e.domain, e.status]))
    expect(byDomain.meal_hydration).toBe('same_as_usual')
    expect(byDomain.mobility_fall).toBe('same_as_usual')
    expect(byDomain.excretion).toBe('not_observed')
  })

  it('말하지 않은 영역은 결과에 아예 포함하지 않는다 (not_mentioned를 same_as_usual로 바꾸지 않음)', () => {
    const entries = classifyDomainsFromText('식사는 평소와 같았어요')
    const domains = entries.map((e) => e.domain)
    expect(domains).toContain('meal_hydration')
    expect(domains).not.toContain('excretion')
    expect(domains).not.toContain('sleep')
  })
})

describe('shouldSkipSecondQuestion', () => {
  it('확인 항목과 미확인 항목이 모두 있으면 두 번째 질문을 생략한다', () => {
    const entries = classifyDomainsFromText('식사는 평소와 같았고 배설은 확인 못했어요')
    expect(shouldSkipSecondQuestion(entries)).toBe(true)
  })
  it('확인 항목만 있으면 두 번째 질문이 필요하다', () => {
    const entries = classifyDomainsFromText('식사는 평소와 같았어요')
    expect(shouldSkipSecondQuestion(entries)).toBe(false)
  })
})

describe('mergeDomainEntries', () => {
  it('같은 영역이 다시 언급되면 최신 분류로 덮어쓴다', () => {
    const first = [{ domain: 'excretion' as const, status: 'not_observed' as const }]
    const second = [{ domain: 'excretion' as const, status: 'same_as_usual' as const }]
    const merged = mergeDomainEntries(first, second)
    expect(merged).toEqual([{ domain: 'excretion', status: 'same_as_usual' }])
  })
})

describe('buildNoChangeReport', () => {
  it('사양서 예시: 확인/미확인이 섞인 경우', () => {
    const entries = classifyDomainsFromText('식사는 평소만큼 드셨고 걸으시는 것도 같았어요. 배설은 확인 못했어요.')
    const report = buildNoChangeReport(entries)
    expect(report.change).toContain('평소와 유사한 것으로 관찰됨')
    expect(report.change).toContain('이번 방문에서 확인하지 못함')
    expect(report.change).toContain('그 밖의 뚜렷한 상태변화는 관찰되지 않음')
  })

  it('구체적인 관찰영역이 전혀 없으면 "확인된 관찰영역 없음" 문장을 쓴다', () => {
    const report = buildNoChangeReport([])
    expect(report.change).toBe('금일 요양보호사가 별도 상태변화를 보고하지 않음. 구체적으로 확인된 관찰영역은 없음.')
  })

  it('전체가 정상이라고 확인한 것처럼 보이지 않도록 두 번째 문장을 항상 포함한다', () => {
    const report = buildNoChangeReport([])
    expect(report.change.split('.').filter(Boolean).length).toBeGreaterThanOrEqual(2)
  })
})
