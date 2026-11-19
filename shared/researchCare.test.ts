import { describe, expect, it } from 'vitest'
import {
  addDays, buildDailyUserText, dailySummaryLine, fallbackQuestions, fallbackWeeklyDraft, inWeek, isIsoDate,
  maskForAi, normalizeDraft, normalizeQuestions, transcriptText, weekEndOf, weekStartOf,
} from './researchCare.js'

describe('식별정보 가리기', () => {
  it('등록된 이름은 코드로, 전화·주민번호는 가림 표시로 바꾼다', () => {
    const out = maskForAi('홍길순 어르신 아드님 010-1234-5678, 번호 450101-2345678', [{ name: '홍길순', code: 'A01' }])
    expect(out).toBe('A01 어르신 아드님 [전화번호 가림], 번호 [주민번호 가림]')
  })
  it('한 글자 이름처럼 너무 짧은 이름은 오치환을 막기 위해 바꾸지 않는다', () => {
    expect(maskForAi('김 씨 식사', [{ name: '김', code: 'A01' }])).toBe('김 씨 식사')
  })
})

describe('주 계산(월~일)', () => {
  it('일요일은 그 주 월요일로, 월요일은 그대로', () => {
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16')
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16')
    expect(weekEndOf('2026-11-16')).toBe('2026-11-22')
    expect(inWeek('2026-11-23', '2026-11-16')).toBe(false)
    expect(addDays('2026-11-16', -7)).toBe('2026-11-09')
  })
  it('잘못된 날짜를 거른다', () => {
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-02-28')).toBe(true)
  })
})

describe('하루 되묻기', () => {
  const ctx = { usual: ['식사: 밥 반 공기'], previous: { date: '2026-11-18', text: '식사량이 줄었음' } }
  it('AI에 보내는 글에 직전 기록과 평소 상태가 들어간다', () => {
    const t = buildDailyUserText('A01', '평소와 같았어요', ctx)
    expect(t).toContain('직전 기록(2026-11-18): 식사량이 줄었음')
    expect(t).toContain('등록된 평소 상태: 식사: 밥 반 공기')
  })
  it('AI 응답은 최대 2개 질문으로 다듬고, 형식이 틀리면 null', () => {
    expect(normalizeQuestions({ questions: ['a', 'b', 'c'] })).toEqual(['a', 'b'])
    expect(normalizeQuestions({ questions: [] })).toBeNull()
    expect(normalizeQuestions('x')).toBeNull()
  })
  it('AI를 못 쓰면 직전 기록과 비교하는 규칙 질문을 낸다', () => {
    const qs = fallbackQuestions('특이사항 없어요', ctx)
    expect(qs[0]).toContain('지난번(11-18)')
    expect(qs).toHaveLength(2)
    expect(fallbackQuestions('기침을 하셨어요', { usual: [], previous: null })).toHaveLength(1)
  })
  it('특이사항 없는 날도 평소 상태와 비교한 한 줄이 남는다', () => {
    const line = dailySummaryLine({ date: '2026-11-19', rawInput: '평소와 같았어요', turns: [{ question: 'q', answer: '네 드셨어요' }], noChange: true }, ['식사: 밥 반 공기'])
    expect(line).toBe('등록된 평소 상태(식사: 밥 반 공기)와 비교해 변화 없음 확인 · 확인 질문 1개 답변')
  })
})

describe('주간 초안', () => {
  const days = [
    { date: '2026-11-17', rawInput: '기침을 하셨어요', turns: [{ question: '언제부터요?', answer: '어제부터' }], noChange: false },
    { date: '2026-11-18', rawInput: '평소와 같았어요', turns: [], noChange: true },
  ]
  it('전사본은 말한 순서대로 남는다', () => {
    expect(transcriptText(days[0])).toBe('요양보호사: 기침을 하셨어요\nAI: 언제부터요?\n요양보호사: 어제부터')
  })
  it('AI 없이 만드는 초안은 날짜별 원문을 모은다', () => {
    const d = fallbackWeeklyDraft(days, [])
    expect(d).toContain('11-17 기침을 하셨어요 (추가: 어제부터)')
    expect(d).toContain('11-18 평소 상태와 비교해 변화 없음 확인')
  })
  it('AI 초안 형식 검사', () => {
    expect(normalizeDraft({ draft: '  초안  ' })).toBe('초안')
    expect(normalizeDraft({ draft: '' })).toBeNull()
  })
})
