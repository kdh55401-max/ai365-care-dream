import { describe, expect, it } from 'vitest'
import type { CareReportRecord } from './careTypes.js'
import {
  average,
  buildCumulativeSeries,
  buildParticipationGrid,
  computeRawInformativeness,
  computeScenarioStats,
  computeStats,
  fraction,
  gradeScenarioReport,
  median,
  pilotDateRange,
} from './statsCalc.js'

function row(overrides: Partial<CareReportRecord>): CareReportRecord {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    participant_code: 'C01',
    recipient_code: 'A01',
    report_type: 'daily',
    report_date: '2026-09-07',
    status: 'submitted',
    input_method: 'text',
    started_at: '2026-09-07T00:00:00Z',
    submitted_at: '2026-09-07T00:01:00Z',
    completion_seconds: 60,
    raw_input: '오늘 특이사항 없었어요',
    followup_questions: [],
    followup_answers: [],
    ai_generated_report: { change: 'a', action: 'b', result: 'c', escalation: 'd', caregiverNote: '' },
    caregiver_final_report: { change: 'a', action: 'b', result: 'c', escalation: 'd', caregiverNote: '' },
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
    admin_final_report: null,
    review_status: 'pending',
    review_note: null,
    review_note_visible_to_caregiver: false,
    reviewed_at: null,
    review_history: [],
    last_review_request_id: null,
    deleted: false,
    created_at: '2026-09-07T00:00:00Z',
    updated_at: '2026-09-07T00:00:00Z',
    ...overrides,
  }
}

describe('fraction / median / average / pilotDateRange (기존 동작 유지)', () => {
  it('fraction: 분모 0이면 percent는 null', () => {
    expect(fraction(0, 0)).toEqual({ numerator: 0, denominator: 0, percent: null })
  })
  it('median: 짝수 길이는 가운데 두 값 평균', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('average: 빈 배열은 null', () => {
    expect(average([])).toBeNull()
  })
  it('pilotDateRange: 시작~종료일을 하루 단위로', () => {
    expect(pilotDateRange('2026-09-07', '2026-09-09')).toEqual(['2026-09-07', '2026-09-08', '2026-09-09'])
  })
})

describe('computeRawInformativeness', () => {
  it('빈 문자열은 0점', () => {
    expect(computeRawInformativeness('')).toBe(0)
  })
  it('관찰만 있으면 1점, 조치/현재상태/센터확인 단서가 더해지면 점수가 오른다', () => {
    expect(computeRawInformativeness('휘청거렸어요')).toBe(1)
    expect(computeRawInformativeness('휘청거려서 부축했고 지금은 괜찮아요. 센터에 보고 예정입니다.')).toBe(4)
  })
})

describe('computeStats — 실제 현장보고(live)만 집계하고 scenario는 제외', () => {
  it('report_source=scenario 행은 모든 집계에서 빠진다', () => {
    const rows = [row({ status: 'submitted' }), row({ status: 'submitted', report_source: 'scenario', scenario_id: 'scenario_1' })]
    const stats = computeStats(rows, '2026-09-07')
    expect(stats.volume.totalCount).toBe(1)
  })

  it('오늘 제출/미제출 인원과 목표(90건) 진행률을 분자/분모와 함께 계산한다', () => {
    const rows = [
      row({ participant_code: 'C01', report_date: '2026-09-08' }),
      row({ participant_code: 'C02', report_date: '2026-09-07', status: 'draft' }),
    ]
    const stats = computeStats(rows, '2026-09-08')
    expect(stats.participation.todaySubmitted).toBe(1)
    expect(stats.participation.todayNotSubmitted).toBe(8)
    expect(stats.participation.todayNotSubmittedCodes).not.toContain('C01')
    expect(stats.volume.goalMain).toEqual({ numerator: 1, denominator: 90, percent: expect.any(Number) })
  })

  it('AI 적용 전후 바로판단가능률과 정보충실도(자동 0~4)를 함께 계산한다', () => {
    const rows = [
      row({
        raw_input: '휘청거렸어요',
        raw_immediately_actionable: false,
        raw_followup_needed: true,
        raw_completeness_score: 2,
        raw_evaluated_at: '2026-09-07T01:00:00Z',
        ai_generated_report: { change: '휘청거림 관찰됨', action: '부축함', result: '현재 안정적', escalation: '센터 확인 필요', caregiverNote: '' },
        caregiver_final_report: { change: '휘청거림 관찰됨', action: '부축함', result: '현재 안정적', escalation: '센터 확인 필요', caregiverNote: '' },
        ai_immediately_actionable: true,
        ai_followup_needed: false,
        ai_completeness_score: 5,
        ai_usefulness_score: 5,
        actual_followup_type: 'none',
        ai_inaccuracy_detected: false,
        ai_evaluated_at: '2026-09-07T01:01:00Z',
      }),
    ]
    const stats = computeStats(rows, '2026-09-07')
    expect(stats.beforeAfter.rawActionable).toEqual({ numerator: 0, denominator: 1, percent: 0 })
    expect(stats.beforeAfter.aiActionable).toEqual({ numerator: 1, denominator: 1, percent: 100 })
    expect(stats.beforeAfter.informativenessBefore).toBe(1) // "휘청거렸어요"만으로는 관찰 서술뿐
    expect(stats.beforeAfter.informativenessAfter).toBe(4) // 4개 영역 모두 실질 내용 있음
    expect(stats.coreHeadline).toEqual({ numerator: 1, denominator: 1, percent: 100 })
  })

  it('무정보 보고 구체화율: 최초 특이사항 없음 → 후속 질문으로 구체화된 비율', () => {
    const rows = [
      row({ no_change_initial_input: true, final_information_count: 2, initial_status_choice: 'similar' }),
      row({ no_change_initial_input: true, final_information_count: 0, no_information_report: true, initial_status_choice: 'similar' }),
    ]
    const stats = computeStats(rows, '2026-09-07')
    expect(stats.noChangeFlow.noInfoSpecificationRate).toEqual({ numerator: 1, denominator: 2, percent: 50 })
  })

  it('현장보고 유형 5분류가 서로 배타적이며 합이 전체와 같다', () => {
    const rows = [
      row({ initial_status_choice: 'changed' }),
      row({ initial_status_choice: 'similar' }),
      row({ initial_status_choice: 'uncertain' }),
      row({ initial_status_choice: 'similar', no_information_report: true }),
    ]
    const stats = computeStats(rows, '2026-09-07')
    const b = stats.reportTypeBreakdown
    expect(b.changed.numerator + b.similar.numerator + b.uncertain.numerator + b.noInfo.numerator + b.unclassified.numerator).toBe(4)
    expect(b.noInfo.numerator).toBe(1)
    expect(b.unclassified.numerator).toBe(0)
  })

  it('initial_status_choice가 없는(미선택) 보고는 "평소와 비슷함"이 아니라 "미분류"로 집계된다', () => {
    // "이야기 시작"/"글로 입력하기"로 곧바로 자유발화한 기본 돌봄보고는 평소와
    // 다른점/비슷함/확인필요 선택 화면을 거치지 않아 initial_status_choice가
    // null로 남는다. 이걸 "평소와 비슷함(정상 확인됨)"으로 잘못 세면 안 된다.
    const rows = [
      row({ initial_status_choice: null }),
      row({ initial_status_choice: 'similar' }),
    ]
    const stats = computeStats(rows, '2026-09-07')
    const b = stats.reportTypeBreakdown
    expect(b.unclassified).toEqual({ numerator: 1, denominator: 2, percent: 50 })
    expect(b.similar).toEqual({ numerator: 1, denominator: 2, percent: 50 })
  })

  it('제출 완료율: 방금 시작한(1시간 이내) draft는 실패로 세지 않고 "진행 중"으로 분리하며, 1시간 넘은 draft는 "장기 미완료"로만 표시하고 실패 확정은 하지 않는다', () => {
    const now = new Date()
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const rows = [
      row({ status: 'submitted' }),
      row({ status: 'draft', started_at: fiveMinAgo }), // 진행 중 — 분모에서 제외
      row({ status: 'draft', started_at: twoHoursAgo }), // 장기 미완료 — 분모에 포함(실패 확정 아님, 관찰값)
    ]
    const stats = computeStats(rows, '2026-09-07')
    expect(stats.quality.completionBreakdown).toEqual({ completed: 1, longPending: 1, inProgress: 1, longPendingThresholdHours: 1 })
    // 분모는 완료(1) + 장기미완료(1) = 2, 진행 중인 1건은 빠진다 — 66.7%가 아니라 50%.
    expect(stats.quality.completionRate).toEqual({ numerator: 1, denominator: 2, percent: 50 })
  })

  it('AI 폴백 발생률: ai_fallback_used가 null인(추적 이전) 기록은 분모에서 빼고 "확인 불가" 건수로 센다', () => {
    const rows = [
      row({ ai_fallback_used: false }),
      row({ ai_fallback_used: true, ai_fallback_stage: 'final_report' }),
      row({ ai_fallback_used: null }), // 과거 기록 — 확인 불가
    ]
    const stats = computeStats(rows, '2026-09-07')
    expect(stats.quality.fallbackRate).toEqual({ numerator: 1, denominator: 2, percent: 50 })
    expect(stats.quality.fallbackUnknownCount).toBe(1)
  })

  it('AI 폴백 발생률: DB에 컬럼이 아직 없어 ai_fallback_used가 undefined로 오는 배포 시점에도 "확인 불가"로 안전하게 처리한다(잘못 false로 세지 않는다)', () => {
    const r = row({ ai_fallback_used: true })
    // 마이그레이션 전 실제 Supabase select('*')는 이 컬럼을 아예 반환하지 않는다 —
    // 그 상황을 흉내내 키 자체를 지운다.
    const legacyRow = { ...r } as Partial<CareReportRecord>
    delete legacyRow.ai_fallback_used
    const stats = computeStats([legacyRow as CareReportRecord], '2026-09-07')
    expect(stats.quality.fallbackRate).toEqual({ numerator: 0, denominator: 0, percent: null })
    expect(stats.quality.fallbackUnknownCount).toBe(1)
  })

  it('재사용률: 첫 제출이 오늘인 참여자는 아직 재사용 기회가 없었으므로 "관찰 중"으로 분모에서 뺀다', () => {
    const rows = [
      // C01: 어제 첫 제출 + 오늘 한 번 더 = 관찰 기간 확보, 재사용 인정
      row({ participant_code: 'C01', report_date: '2026-09-06' }),
      row({ participant_code: 'C01', report_date: '2026-09-07', report_type: 'additional' }),
      // C02: 오늘 처음 제출 — 아직 다음날이 안 와서 재사용 여부 판단 불가
      row({ participant_code: 'C02', report_date: '2026-09-07' }),
    ]
    const stats = computeStats(rows, '2026-09-07')
    expect(stats.participation.stillObservingParticipants).toBe(1)
    // 분모에서 C02(관찰 중)가 빠지므로 1명 중 1명 재사용 = 100%, 0%로 뭉개지지 않는다.
    expect(stats.participation.repeatUserRate).toEqual({ numerator: 1, denominator: 1, percent: 100 })
  })
})

describe('buildParticipationGrid / buildCumulativeSeries', () => {
  it('9명 전원에 대해 날짜별 셀을 만들고 scenario는 제외한다', () => {
    const rows = [
      row({ participant_code: 'C03', report_date: '2026-09-08' }),
      row({ participant_code: 'C03', report_date: '2026-09-08', report_source: 'scenario', scenario_id: 'scenario_1' }),
    ]
    const grid = buildParticipationGrid(rows, ['2026-09-07', '2026-09-08'])
    expect(grid).toHaveLength(9)
    const c03 = grid.find((r) => r.participantCode === 'C03')!
    expect(c03.cells[1].dailySubmitted).toBe(true)
    expect(c03.totalSubmitted).toBe(1) // scenario 제외
  })

  it('미래 날짜에는 누적값을 만들지 않는다(0 유지, isFuture=true)', () => {
    const rows = [row({ report_date: '2026-09-07' })]
    const series = buildCumulativeSeries(rows, ['2026-09-07', '2026-09-20'], '2026-09-07')
    expect(series[0].totalCumulative).toBe(1)
    expect(series[1].isFuture).toBe(true)
    expect(series[1].totalCumulative).toBe(1) // 미래에는 증가 없음(가짜 값 생성 금지)
  })
})

describe('표준상황 연습 (scenario) — 실제 통계와 분리', () => {
  it('scenario_1 기대 키워드가 포함되면 requiredInfoCoverage가 오르고, 금지어가 있으면 fabricationCount가 오른다', () => {
    const good = row({
      report_source: 'scenario',
      scenario_id: 'scenario_1',
      caregiver_final_report: { change: '점심을 절반만 드심, 휘청거림 관찰됨', action: '앉아서 쉬게 함', result: '현재 안정적', escalation: '경과 관찰', caregiverNote: '' },
    })
    const bad = row({
      report_source: 'scenario',
      scenario_id: 'scenario_1',
      caregiver_final_report: { change: '낙상 의심, 골절 가능성', action: '119 신고', result: '응급실 이송', escalation: '즉시 확인', caregiverNote: '' },
    })
    const goodGrade = gradeScenarioReport(good)!
    const badGrade = gradeScenarioReport(bad)!
    expect(goodGrade.forbiddenTriggered).toHaveLength(0)
    expect(badGrade.forbiddenTriggered.length).toBeGreaterThan(0)

    const stats = computeScenarioStats([good, bad])
    expect(stats.totalCount).toBe(2)
    expect(stats.targetCount).toBe(18)
    expect(stats.fabricationCount).toBe(1)
    expect(stats.expertAppropriatenessStatus).toBe('not_evaluated')
  })

  it('scenario 행은 computeStats(실제 현장보고)에 절대 합산되지 않는다', () => {
    const rows = [row({ report_source: 'scenario', scenario_id: 'scenario_1' }), row({ report_source: 'live' })]
    const live = computeStats(rows, '2026-09-07')
    const scenario = computeScenarioStats(rows)
    expect(live.volume.totalCount).toBe(1)
    expect(scenario.totalCount).toBe(1)
  })
})
