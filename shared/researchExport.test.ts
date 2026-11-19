import { describe, expect, it } from 'vitest'
import { consentedMap, dailyRows, phaseOf, preRows, weeklyRows, DAILY_HEADERS, WEEKLY_HEADERS } from './researchExport.js'

const people = consentedMap([
  { caregiver_code: 'C01', consented: true, consent_date: '2026-11-01', high_baseline: true, note: null },
  { caregiver_code: 'C02', consented: false, consent_date: null, high_baseline: false, note: null },
])

describe('사전·사후 구분', () => {
  it('기준일이 있으면 날짜로 나누고, 기준일 당일은 사후', () => {
    expect(phaseOf('2026-11-30', 'app', '2026-12-01').phase).toBe('사전')
    expect(phaseOf('2026-12-01', 'pre_record', '2026-12-01').phase).toBe('사후')
  })
  it('기준일이 없으면 앱 기록은 사후, 옮겨 적은 기록은 사전', () => {
    expect(phaseOf('2026-11-30', 'app', null)).toEqual({ phase: '사후', basis: '앱 기록(기준일 미설정)' })
    expect(phaseOf('2026-11-30', 'pre_record', null)).toEqual({ phase: '사전', basis: '도입 전 기록(기준일 미설정)' })
  })
})

describe('내보내기 행', () => {
  it('동의하지 않은 요양보호사 기록은 빠지고, 고수준 태그가 붙는다', () => {
    const rows = dailyRows([
      { id: 'r1', participant_code: 'C01', recipient_code: 'A01', report_date: '2026-11-19', completion_seconds: 30, input_method: 'voice', ai_questions_source: 'ai', raw_input: '평소와 같았어요', followup_answers: [{ question: 'q', answer: 'a' }] },
      { id: 'r2', participant_code: 'C02', recipient_code: 'A02', report_date: '2026-11-19', completion_seconds: 10, input_method: 'text', raw_input: '기침', followup_answers: [] },
    ], people, null)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(DAILY_HEADERS.length)
    expect(rows[0]).toEqual(['r1', '사후', '앱 기록(기준일 미설정)', 'C01', 'A01', '2026-11-19', 30, '음성', 'AI', '예', '요양보호사: 평소와 같았어요\nAI: q\n요양보호사: a', '예'])
  })
  it('주간 행은 AI 초안·수정본·확정본을 각각 다른 열에 두고 수정 여부를 표시한다', () => {
    const rows = weeklyRows([{ id: 'w1', participant_code: 'C01', recipient_code: 'A01', week_start: '2026-11-16', source_report_ids: ['a', 'b'], ai_model: 'm', ai_draft: '초안', caregiver_text: '수정본', caregiver_edit_seconds: 12, admin_final_text: '확정본', admin_note: '상담', admin_followup: '후속', status: 'confirmed', sent_at: 's', admin_confirmed_at: 'c' }], people, '2026-12-01')
    expect(rows[0]).toHaveLength(WEEKLY_HEADERS.length)
    expect(rows[0].slice(1, 3)).toEqual(['사전', '기준일 2026-12-01'])
    expect(rows[0].slice(8, 16)).toEqual(['초안', '수정본', '예', 12, '확정본', '상담', '후속', '관리자 확정'])
  })
  it('사전 기록은 출처를 한글로 적는다', () => {
    const rows = preRows([{ id: 'p1', caregiver_code: 'C01', recipient_code: 'A01', record_date: '2026-10-01', record_text: '식사량 감소', writing_seconds: null, source: 'easycare' }], people, null)
    expect(rows[0]).toEqual(['p1', '사전', '도입 전 기록(기준일 미설정)', 'C01', 'A01', '2026-10-01', '', '이지케어', '식사량 감소', '예'])
  })
})
