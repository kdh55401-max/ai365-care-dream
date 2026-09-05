import { describe, expect, it } from 'vitest'
import {
  buildNoChangeReport,
  classifyDomainsFromText,
  computeInformationAddedCount,
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

/** 핵심 버그 회귀 테스트: information_added_count가 "질문한 횟수/언급된 도메인 수"가
 * 아니라 "실제로 새로 발견된(=changed로 분류된) 정보의 수"만 세는지 검증한다.
 * "평소와 같아요"류 답변은 도메인이 언급돼도 same_as_usual이라 카운트에 잡히면 안 된다. */
describe('computeInformationAddedCount — TEST A~C (특이사항 없음 → 추가정보 발견률 버그)', () => {
  it('TEST A: 모든 후속 답변이 "평소와 같아요"/"없어요"이면 0이어야 한다', () => {
    const initial = classifyDomainsFromText('특이사항 없어요.')
    expect(initial).toEqual([]) // 초기 발화에는 도메인 언급 자체가 없다

    let entries = initial
    entries = mergeDomainEntries(entries, classifyDomainsFromText('식사는 평소와 같아요.'))
    entries = mergeDomainEntries(entries, classifyDomainsFromText('이동도 평소와 같아요.'))
    entries = mergeDomainEntries(entries, classifyDomainsFromText('다른 문제 없어요.'))

    const byDomain = Object.fromEntries(entries.map((e) => [e.domain, e.status]))
    expect(byDomain.meal_hydration).toBe('same_as_usual')
    expect(byDomain.mobility_fall).toBe('same_as_usual')
    expect(entries.filter((e) => e.status === 'changed')).toEqual([])
    expect(computeInformationAddedCount(initial, entries)).toBe(0)
  })

  it('TEST B: 후속 답변에서 식사량 감소가 새로 발견되면 1 이상이어야 한다', () => {
    const initial = classifyDomainsFromText('특이사항 없어요.')
    const entries = mergeDomainEntries(initial, classifyDomainsFromText('오늘 식사를 절반 정도밖에 못 드셨어요.'))

    expect(entries.find((e) => e.domain === 'meal_hydration')?.status).toBe('changed')
    expect(computeInformationAddedCount(initial, entries)).toBeGreaterThanOrEqual(1)
  })

  it('TEST C: 후속 답변에서 어지럼증이 새로 발견되면 관련 도메인이 changed로 기록된다', () => {
    const initial = classifyDomainsFromText('특이사항 없어요.')
    const entries = mergeDomainEntries(initial, classifyDomainsFromText('오늘 일어날 때 어지럽다고 하셨어요.'))

    expect(entries.find((e) => e.domain === 'mobility_fall')?.status).toBe('changed')
    expect(computeInformationAddedCount(initial, entries)).toBeGreaterThanOrEqual(1)
  })

  it('부정 표현과 함께면 증상 단어가 있어도 changed로 잘못 뒤집히지 않는다 (예: "낙상 없었어요")', () => {
    const entries = classifyDomainsFromText('낙상 없었어요.')
    expect(entries.find((e) => e.domain === 'mobility_fall')?.status).toBe('same_as_usual')
  })
})
