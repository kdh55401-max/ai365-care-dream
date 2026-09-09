import { describe, expect, it } from 'vitest'
import {
  buildNoChangeReport,
  classifyDomainsFromText,
  computeInformationAddedCount,
  detectNoChangePhrase,
  mergeDomainEntries,
  shouldSkipFirstQuestion,
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
    expect(byDomain.meal).toBe('same_as_usual')
    expect(byDomain.mobility).toBe('same_as_usual')
    expect(byDomain.excretion).toBe('not_observed')
  })

  it('말하지 않은 영역은 결과에 아예 포함하지 않는다 (not_mentioned를 same_as_usual로 바꾸지 않음)', () => {
    const entries = classifyDomainsFromText('식사는 평소와 같았어요')
    const domains = entries.map((e) => e.domain)
    expect(domains).toContain('meal')
    expect(domains).not.toContain('excretion')
    expect(domains).not.toContain('sleep')
  })

  // 설계 검토 결정 D1: '식사·수분'/'이동·낙상'을 하나의 도메인으로 묶으면 한쪽만
  // 언급됐을 때 다른 쪽 상태(특히 미관찰)가 사라진다 — 반드시 독립적으로 분류된다.
  it('식사는 평소와 같음 + 수분은 관찰 못함 — 서로 다른 도메인으로 분리된다(D1)', () => {
    const entries = classifyDomainsFromText('식사는 평소와 같았어요. 수분은 확인 못했어요.')
    const byDomain = Object.fromEntries(entries.map((e) => [e.domain, e.status]))
    expect(byDomain.meal).toBe('same_as_usual')
    expect(byDomain.hydration).toBe('not_observed')
  })

  // CD-01 회귀 테스트(Codex 재현 원문 그대로): '확인'이 아니라 '관찰'로 말해도
  // not_observed로 분류돼야 한다 — 예전에는 단서 미검출로 same_as_usual(정상)이
  // 됐다.
  it('Codex 재현: "수분 섭취는 관찰하지 못했어요"는 not_observed로 분류된다', () => {
    const entries = classifyDomainsFromText('수분 섭취는 관찰하지 못했어요.')
    expect(entries.find((e) => e.domain === 'hydration')?.status).toBe('not_observed')
  })

  it('Codex 재현 전체 시나리오: 식사·이동·배설 정상 + 수분 관찰하지 못함이 최종 보고문에서 정상으로 뭉개지지 않는다', () => {
    const t1 = '식사, 이동, 배설 모두 평소와 같아요.'
    const t2 = '수분 섭취는 관찰하지 못했어요.'
    const entries = mergeDomainEntries(classifyDomainsFromText(t1), classifyDomainsFromText(t2))
    const report = buildNoChangeReport(entries, [t1, t2])
    expect(report.change).toContain('수분 상태는 이번 방문에서 관찰하지 못했다고 보고함')
    expect(report.change).not.toContain('식사·이동·배설·수분 상태는 평소와 같다고 보고함')
    expect(report.escalation).toContain('수분')
    expect(report.escalation).toContain('확인 필요')
  })

  it('이동은 평소와 같음 + 낙상은 미응답(언급 자체가 없음) — 이동 언급만으로 낙상까지 확인된 것으로 보지 않는다(D1)', () => {
    const entries = classifyDomainsFromText('이동은 평소와 같았어요.')
    const byDomain = Object.fromEntries(entries.map((e) => [e.domain, e.status]))
    expect(byDomain.mobility).toBe('same_as_usual')
    expect(byDomain.fall).toBeUndefined()
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

// 설계 검토 결정 D2: 최초 발화에서 이미 도메인이 나왔다면 1번 질문("평소와 같았던
// 내용을 말씀해주세요")은 방금 한 말을 그대로 되묻는 것이라 생략해야 한다.
describe('shouldSkipFirstQuestion', () => {
  it('최초 발화에 도메인 언급이 하나라도 있으면 1번 질문을 생략한다', () => {
    const entries = classifyDomainsFromText('식사·이동·배설 모두 평소와 같아요')
    expect(entries.length).toBeGreaterThan(0)
    expect(shouldSkipFirstQuestion(entries)).toBe(true)
  })
  it('최초 발화에 도메인 언급이 전혀 없으면("평소와 비슷했어요"류) 1번 질문이 필요하다', () => {
    const entries = classifyDomainsFromText('평소와 비슷했어요')
    expect(entries).toEqual([])
    expect(shouldSkipFirstQuestion(entries)).toBe(false)
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
  it('사양서 예시: 확인/미확인이 섞인 경우 — 자기보고 형태로, 조치/센터확인은 미응답·미검토로 남긴다', () => {
    const entries = classifyDomainsFromText('식사는 평소만큼 드셨고 걸으시는 것도 같았어요. 배설은 확인 못했어요.')
    const report = buildNoChangeReport(entries)
    expect(report.change).toContain('평소와 같다고 보고함')
    expect(report.change).toContain('관찰하지 못했다고 보고함')
    // 언급되지 않은 영역까지 "변화 없음"으로 확대하는 문장을 붙이지 않는다(D1.5).
    expect(report.change).not.toContain('그 밖의')
    expect(report.action).toBe('조치 내용은 미응답.')
    expect(report.escalation).toContain('아직 검토되지 않음')
  })

  it('구체적인 관찰영역이 전혀 없으면 "확인된 관찰영역 없음" 문장을 쓴다', () => {
    const report = buildNoChangeReport([])
    expect(report.change).toBe('금일 요양보호사가 구체적인 관찰영역을 언급하지 않음. 확인된 관찰영역 없음.')
  })

  it('조치를 묻지 않았으므로 "조치 없음"을 단정하지 않고 미응답으로 남긴다(D4.4)', () => {
    const report = buildNoChangeReport([])
    expect(report.action).not.toContain('없음')
    expect(report.action).toBe('조치 내용은 미응답.')
  })

  it('센터 확인 필요 여부는 관리자 판단 전이라 "확인할 사항 없음"을 단정하지 않는다(D4.4)', () => {
    const report = buildNoChangeReport([])
    expect(report.escalation).not.toContain('확인할 사항 없음')
    expect(report.escalation).toContain('검토되지 않음')
  })

  it('미확인 영역이 있으면 다음 방문 확인 필요 문구에 센터 검토 상태를 함께 남긴다', () => {
    const entries = classifyDomainsFromText('배설은 확인 못했어요.')
    const report = buildNoChangeReport(entries)
    expect(report.escalation).toContain('배설')
    expect(report.escalation).toContain('확인 필요')
    expect(report.escalation).toContain('아직 검토되지 않음')
  })

  it('rawTexts를 안 넘기면 caregiverNote는 빈 문자열(기존 호출부 하위호환)', () => {
    const report = buildNoChangeReport([])
    expect(report.caregiverNote).toBe('')
  })

  it('시나리오 D: "특이사항 없는데 힘들어요"류 — 어르신은 정상 처리, caregiverNote는 보존', () => {
    const firstText = '어르신은 오늘 특이사항 없는데, 제가 너무 지쳐서 도움을 받고 싶어요.'
    const entries = classifyDomainsFromText(firstText)
    const report = buildNoChangeReport(entries, [firstText])
    // 어르신에 대해 새로 발견된 변화는 없어야 한다(무근거로 상태변화를 만들지 않음).
    expect(entries.some((e) => e.status === 'changed')).toBe(false)
    // 요양보호사 본인의 어려움·지원요청은 caregiverNote에 그대로 남아야 한다.
    expect(report.caregiverNote).not.toBe('')
    expect(report.caregiverNote).toContain('지쳐서')
  })

  it('특이사항없음 흐름의 추가답변에서 나온 어려움 호소도 caregiverNote에 보존된다', () => {
    const firstText = '평소와 비슷했어요'
    const entries = classifyDomainsFromText(firstText)
    const answer = '식사, 이동은 평소와 같았어요. 그런데 오늘 제가 너무 힘들었어요.'
    const report = buildNoChangeReport(entries, [firstText, answer])
    expect(report.caregiverNote).not.toBe('')
    expect(report.caregiverNote).toContain('힘들었어요')
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
    expect(byDomain.meal).toBe('same_as_usual')
    expect(byDomain.mobility).toBe('same_as_usual')
    expect(entries.filter((e) => e.status === 'changed')).toEqual([])
    expect(computeInformationAddedCount(initial, entries)).toBe(0)
  })

  it('TEST B: 후속 답변에서 식사량 감소가 새로 발견되면 1 이상이어야 한다', () => {
    const initial = classifyDomainsFromText('특이사항 없어요.')
    const entries = mergeDomainEntries(initial, classifyDomainsFromText('오늘 식사를 절반 정도밖에 못 드셨어요.'))

    expect(entries.find((e) => e.domain === 'meal')?.status).toBe('changed')
    expect(computeInformationAddedCount(initial, entries)).toBeGreaterThanOrEqual(1)
  })

  it('TEST F: 이미 changed인 도메인에 더 구체적인 세부정보가 추가돼도 카운트가 다시 늘지 않는다', () => {
    const initial = classifyDomainsFromText('특이사항 없어요.')
    const firstMention = mergeDomainEntries(initial, classifyDomainsFromText('식사를 절반 정도밖에 못 드셨어요.'))
    expect(firstMention.find((e) => e.domain === 'meal')?.status).toBe('changed')
    expect(computeInformationAddedCount(initial, firstMention)).toBe(1)

    // 같은 영역(meal)에 대해 숟가락 수처럼 더 구체적인 세부정보가 추가돼도
    // 이미 changed였던 도메인이므로 information_added_count는 그대로 1이어야 한다 —
    // 다만 이 세부정보 자체(원문)는 이 함수와 별개로 followup_answers에 그대로
    // 보존된다(CareApp.tsx 구조상 항상 원문을 저장하므로 정보가 사라지지 않음).
    const moreDetailed = mergeDomainEntries(firstMention, classifyDomainsFromText('정확히 말씀드리면 세 숟갈밖에 못 드셨어요.'))
    expect(moreDetailed.find((e) => e.domain === 'meal')?.status).toBe('changed')
    expect(computeInformationAddedCount(initial, moreDetailed)).toBe(1)
  })

  it('TEST C: 후속 답변에서 어지럼증이 새로 발견되면 관련 도메인이 changed로 기록된다', () => {
    const initial = classifyDomainsFromText('특이사항 없어요.')
    const entries = mergeDomainEntries(initial, classifyDomainsFromText('오늘 일어날 때 어지럽다고 하셨어요.'))

    expect(entries.find((e) => e.domain === 'fall')?.status).toBe('changed')
    expect(computeInformationAddedCount(initial, entries)).toBeGreaterThanOrEqual(1)
  })

  it('부정 표현과 함께면 증상 단어가 있어도 changed로 잘못 뒤집히지 않는다 (예: "낙상 없었어요")', () => {
    const entries = classifyDomainsFromText('낙상 없었어요.')
    expect(entries.find((e) => e.domain === 'fall')?.status).toBe('same_as_usual')
  })
})

/** 발화 변형 Robustness 테스트 — 키워드 한두 개가 아니라 실제 요양보호사가 쓸 법한
 * 여러 표현으로 분류가 안정적인지 검증한다. */
describe('classifyDomainsFromText — 발화 변형 robustness', () => {
  describe('정상/변화 없음 표현 → same_as_usual (또는 도메인 언급 자체가 없음)', () => {
    const cases = ['별일 없어요', '평소랑 똑같아요', '괜찮으셨어요', '특별한 건 없었습니다', '오늘도 평소대로예요']
    it.each(cases)('%s', (text) => {
      const entries = classifyDomainsFromText(text)
      expect(entries.every((e) => e.status === 'same_as_usual')).toBe(true)
    })
  })

  describe('식사 변화 표현 → meal이 changed', () => {
    const cases = [
      '밥을 반밖에 못 드셨어요',
      '몇 숟갈 안 드셨어요',
      '오늘 식사를 거의 안 하셨어요',
    ]
    it.each(cases)('%s', (text) => {
      const entries = classifyDomainsFromText(text)
      expect(entries.find((e) => e.domain === 'meal')?.status).toBe('changed')
    })

    // "입맛이 없다고 하셨어요"는 식사 관련 키워드('식사'/'드시' 등)가 문장에 아예
    // 없어서 현재 키워드 목록으로는 도메인 자체가 매칭되지 않는다 — 알려진 한계로
    // 기록해 둔다(과도한 키워드 확장은 이번 범위 밖).
    it('입맛이 없다고 하셨어요 (알려진 한계: 도메인 미매칭)', () => {
      const entries = classifyDomainsFromText('입맛이 없다고 하셨어요.')
      expect(entries.find((e) => e.domain === 'meal')).toBeUndefined()
    })
  })

  describe('이동/낙상 변화 표현 → fall이 changed', () => {
    const cases = ['일어나실 때 어지럽대요', '걸을 때 휘청거리셨어요', '넘어질 뻔했어요', '오늘 한 번 넘어지셨어요']
    it.each(cases)('%s', (text) => {
      const entries = classifyDomainsFromText(text)
      expect(entries.find((e) => e.domain === 'fall')?.status).toBe('changed')
    })
  })

  describe('부정 표현 → changed로 잘못 분류되지 않음', () => {
    const cases = ['어지럽지는 않았어요', '넘어진 적 없어요', '통증 없으세요', '식사도 잘 하셨어요']
    it.each(cases)('%s', (text) => {
      const entries = classifyDomainsFromText(text)
      expect(entries.some((e) => e.status === 'changed')).toBe(false)
    })
  })
})
