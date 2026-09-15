import { describe, expect, it } from 'vitest'
import type { CareReportRecord } from './careTypes.js'
import { buildRecipientTimeline, buildReviewQueue, reviewReasons, storedObservations, summarizeRecipients } from './recipientHub.js'

let seq = 0
function report(overrides: Partial<CareReportRecord>): CareReportRecord {
  seq += 1
  return {
    id: `r${seq}`,
    participant_code: 'C01',
    recipient_code: 'A01',
    report_type: 'daily',
    report_date: '2026-09-14',
    status: 'submitted',
    input_method: 'text',
    started_at: '2026-09-14T01:00:00Z',
    submitted_at: '2026-09-14T01:01:00Z',
    completion_seconds: 60,
    raw_input: '오늘 식사를 평소보다 적게 하셨어요.',
    followup_questions: [],
    followup_answers: [],
    ai_generated_report: { change: 'AI 초안 관찰', action: '', result: '', escalation: '', caregiverNote: '' },
    caregiver_final_report: { change: '식사량 감소(요양보호사 확인)', action: '', result: '', escalation: '', caregiverNote: '' },
    initial_status_choice: null,
    no_change_initial_input: false,
    observed_domains_json: [],
    changed_domains_json: [],
    unobserved_domains_json: [],
    uncertain_domains_json: [],
    no_change_followup_count: 0,
    no_change_followup_answered: 0,
    initial_information_count: 0,
    final_information_count: 0,
    information_added_count: 0,
    no_information_report: false,
    report_source: 'live',
    scenario_id: null,
    emergency_flagged: false,
    ai_fallback_used: null,
    ai_fallback_stage: null,
    raw_immediately_actionable: null,
    raw_followup_needed: null,
    raw_completeness_score: null,
    raw_eval_note: null,
    raw_evaluated_at: null,
    ai_immediately_actionable: null,
    ai_followup_needed: null,
    ai_completeness_score: null,
    actual_followup_type: null,
    ai_usefulness_score: null,
    ai_inaccuracy_detected: null,
    ai_eval_note: null,
    manager_status: null,
    ai_evaluated_at: null,
    admin_first_viewed_at: null,
    admin_final_report: null,
    review_status: 'pending',
    review_note: null,
    review_note_visible_to_caregiver: false,
    reviewed_at: null,
    review_history: [],
    last_review_request_id: null,
    deleted: false,
    created_at: '2026-09-14T01:00:00Z',
    updated_at: '2026-09-14T01:01:00Z',
    ...overrides,
  }
}

describe('항목별 관찰 상태 — 저장된 값만', () => {
  it('저장된 항목이 없으면 아무 상태도 만들지 않는다("평소와 비슷함" 선택이어도)', () => {
    expect(storedObservations(report({ initial_status_choice: 'similar' }))).toEqual([])
  })

  it('저장된 목록의 상태를 그대로 쓰고, 말하지 않은 항목은 넣지 않는다', () => {
    const obs = storedObservations(
      report({
        observed_domains_json: [{ domain: 'mobility', status: 'same_as_usual' }],
        changed_domains_json: [{ domain: 'meal', status: 'changed' }],
        unobserved_domains_json: [{ domain: 'excretion', status: 'not_observed' }],
        uncertain_domains_json: [{ domain: 'sleep', status: 'uncertain' }],
      }),
    )
    expect(obs.map((o) => `${o.label}:${o.statusLabel}`)).toEqual(['식사:변화 보고', '이동:평소와 같음', '배설:미관찰', '수면:불확실'])
  })
})

describe('검토 대기 이유', () => {
  it('승인·반려가 끝났거나 제출 전이면 이유가 없다', () => {
    expect(reviewReasons(report({ review_status: 'approved' }))).toEqual([])
    expect(reviewReasons(report({ review_status: 'rejected' }))).toEqual([])
    expect(reviewReasons(report({ status: 'draft' }))).toEqual([])
  })

  it('평소와 비슷함 보고는 경고 없이 빠른 검토 대상으로만 표시한다', () => {
    const reasons = reviewReasons(report({ initial_status_choice: 'similar' }))
    expect(reasons.some((r) => r.tone === 'alert')).toBe(false)
    expect(reasons.map((r) => r.code)).toEqual(['not_reviewed', 'choice_similar'])
  })

  it('응급 표현·요양보호사 지원 요청·AI 대체 처리는 저장된 필드에서만 이유로 뽑는다', () => {
    const codes = reviewReasons(
      report({
        emergency_flagged: true,
        ai_fallback_used: true,
        caregiver_final_report: { change: '', action: '', result: '', escalation: '', caregiverNote: '오늘 제가 너무 힘들었어요' },
      }),
    ).map((r) => r.code)
    expect(codes).toEqual(['not_reviewed', 'emergency_signal', 'caregiver_note', 'ai_fallback'])
    // ai_fallback_used=null(추적 이전 기록)은 "대체 처리됨"으로 단정하지 않는다
    expect(reviewReasons(report({ ai_fallback_used: null })).map((r) => r.code)).not.toContain('ai_fallback')
  })
})

describe('기관 첫 화면 검토 대기 목록', () => {
  it('실제 제출·미검토 현장보고만 넣는다 — 연습·삭제·임시저장·검토 완료는 제외', () => {
    const queue = buildReviewQueue([
      report({ id: 'keep' }),
      report({ id: 'scenario', report_source: 'scenario' }),
      report({ id: 'deleted', deleted: true }),
      report({ id: 'draft', status: 'draft', submitted_at: null }),
      report({ id: 'approved', review_status: 'approved' }),
    ])
    expect(queue.map((q) => q.reportId)).toEqual(['keep'])
  })

  it('응급 표현 감지 보고 먼저, 그다음 제출이 오래된 순', () => {
    const queue = buildReviewQueue([
      report({ id: 'new', submitted_at: '2026-09-14T05:00:00Z' }),
      report({ id: 'old', submitted_at: '2026-09-13T05:00:00Z' }),
      report({ id: 'emergency-new', submitted_at: '2026-09-14T06:00:00Z', emergency_flagged: true }),
    ])
    expect(queue.map((q) => q.reportId)).toEqual(['emergency-new', 'old', 'new'])
  })

  it('요약 문장은 요양보호사 확인본을 우선하고 출처를 함께 준다', () => {
    const [withFinal] = buildReviewQueue([report({})])
    expect(withFinal.excerptSource).toBe('caregiver_final')
    const [rawOnly] = buildReviewQueue([report({ caregiver_final_report: null })])
    expect(rawOnly.excerptSource).toBe('raw_input')
    expect(rawOnly.excerpt).toBe('오늘 식사를 평소보다 적게 하셨어요.')
  })
})

describe('수급자 목록', () => {
  it('현재 활성 배정만 담당으로 보이고, 배정이 없으면 빈 목록(담당 미배정)이다', () => {
    const rows = summarizeRecipients(
      [
        { code: 'A01', active: true },
        { code: 'A02', active: true },
      ],
      [
        { caregiver_code: 'C01', recipient_code: 'A01', active: true },
        { caregiver_code: 'C02', recipient_code: 'A01', active: false },
      ],
      [],
    )
    expect(rows.find((r) => r.code === 'A01')?.caregivers).toEqual(['C01'])
    expect(rows.find((r) => r.code === 'A02')?.caregivers).toEqual([])
    expect(rows.find((r) => r.code === 'A02')?.lastSubmitted).toBeNull()
  })

  it('검토 대기가 있는 수급자를 먼저 보이고 표준상황 연습은 세지 않는다', () => {
    const rows = summarizeRecipients(
      [
        { code: 'A01', active: true },
        { code: 'A02', active: true },
      ],
      [],
      [
        report({ recipient_code: 'A01', review_status: 'approved' }),
        report({ recipient_code: 'A01', report_source: 'scenario' }),
        report({ recipient_code: 'A02', emergency_flagged: true }),
        report({ recipient_code: 'A02', status: 'draft', submitted_at: null }),
      ],
    )
    expect(rows.map((r) => r.code)).toEqual(['A02', 'A01'])
    expect(rows[0]).toMatchObject({ pendingReviewCount: 1, pendingEmergencyCount: 1, draftCount: 1, submittedCount: 1 })
    expect(rows[1]).toMatchObject({ pendingReviewCount: 0, submittedCount: 1 })
  })
})

describe('수급자 타임라인', () => {
  const reports = [
    report({ id: 'd14', report_date: '2026-09-14', submitted_at: '2026-09-14T03:00:00Z' }),
    report({ id: 'd09', report_date: '2026-09-09', submitted_at: '2026-09-09T03:00:00Z', review_status: 'approved', reviewed_at: '2026-09-09T04:00:00Z' }),
    report({ id: 'd01', report_date: '2026-09-01', submitted_at: '2026-09-01T03:00:00Z' }),
    report({ id: 'draft', status: 'draft', submitted_at: null, report_date: '2026-09-14', emergency_flagged: true }),
  ]

  it('기간은 보고일 기준(오늘 포함 7일)이고 최신 제출이 위, 임시저장은 따로 요약한다', () => {
    const t = buildRecipientTimeline(reports, '7', '2026-09-15')
    expect(t.since).toBe('2026-09-09')
    expect(t.entries.map((e) => e.reportId)).toEqual(['d14', 'd09'])
    expect(t.drafts).toEqual([expect.objectContaining({ reportId: 'draft', emergencyFlagged: true })])
    expect(buildRecipientTimeline(reports, 'all', '2026-09-15').entries.map((e) => e.reportId)).toEqual(['d14', 'd09', 'd01'])
  })

  it('원문·AI 초안·요양보호사 제출본·관리자 검토를 합치지 않고 따로 내려준다', () => {
    const [entry] = buildRecipientTimeline([reports[0]], 'all', '2026-09-15').entries
    expect(entry.raw.text).toBe('오늘 식사를 평소보다 적게 하셨어요.')
    expect(entry.structured.aiDraft?.change).toBe('AI 초안 관찰')
    expect(entry.structured.caregiverFinal?.change).toBe('식사량 감소(요양보호사 확인)')
    expect(entry.structured.caregiverEdited).toBe(true)
    expect(entry.review).toMatchObject({ status: 'pending', reviewedAt: null, adminFinal: null })
    expect(entry.author).toEqual({ role: 'caregiver', code: 'C01' })
  })

  it('검토가 끝난 보고는 상태를 유지하고 대기 이유를 붙이지 않는다', () => {
    const entry = buildRecipientTimeline(reports, 'all', '2026-09-15').entries.find((e) => e.reportId === 'd09')
    expect(entry?.review.status).toBe('approved')
    expect(entry?.reviewReasons).toEqual([])
  })
})
