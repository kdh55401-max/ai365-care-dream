import { describe, expect, it } from 'vitest'
import type { CareReportRecord } from './careTypes.js'
import { buildOperationMetrics, operationWindow, parseOperationPeriod, percentileSeconds, type OperationMetric, type OperationMetricsInput } from './operationMetrics.js'
import type {
  ActionEvent,
  ActionObligation,
  ActionVerification,
  AdminDecision,
  CareAction,
  FieldRequest,
  FieldResponse,
  ReportEvent,
} from './workflow.js'

// 기준시각: 한국시간 2026-09-17 12:00 (= 2026-09-17T03:00Z). 최근 7일 = 09-11 ~ 09-17.
const NOW = new Date('2026-09-17T03:00:00.000Z')
let n = 0
const id = () => `id-${++n}`

function base(over: Partial<OperationMetricsInput> = {}): OperationMetricsInput {
  return {
    now: NOW,
    days: 7,
    workflowReady: true,
    fieldRequestsReady: true,
    reports: [],
    reportEvents: [],
    decisions: [],
    actions: [],
    obligations: [],
    actionEvents: [],
    requests: [],
    responses: [],
    verifications: [],
    ...over,
  }
}

const metric = (input: OperationMetricsInput, metricId: string): OperationMetric => {
  const m = buildOperationMetrics(input).metrics.find((x) => x.id === metricId)
  if (!m) throw new Error(`지표 없음: ${metricId}`)
  return m
}

function action(over: Partial<CareAction> = {}): CareAction {
  return {
    id: id(),
    organization_id: 'gadream365',
    recipient_code: 'A01',
    source_report_id: null,
    decision_id: null,
    kind: 'field_request',
    purpose: '식사량 재확인',
    action_content: null,
    field_message_draft: null,
    field_message_status: 'unpublished',
    internal_note: null,
    owner_label: null,
    status: 'open',
    version: 1,
    current_cycle: 1,
    completion_evidence: null,
    completion_remaining: null,
    completed_at: null,
    cancel_reason: null,
    cancelled_at: null,
    created_at: '2026-09-12T00:00:00.000Z',
    updated_at: '2026-09-12T00:00:00.000Z',
    created_by_scope: 'org_admin_shared',
    create_request_id: id(),
    ...over,
  }
}

function obligation(actionId: string, over: Partial<ActionObligation> = {}): ActionObligation {
  const due = over.initial_due_at ?? '2026-09-14T00:00:00.000Z'
  return {
    id: id(),
    action_id: actionId,
    cycle_no: 1,
    obligation_type: 'field_response',
    initial_due_kind: 'datetime',
    initial_due_at: due,
    current_due_kind: 'datetime',
    current_due_at: due,
    status: 'active',
    activated_at: '2026-09-12T00:00:00.000Z',
    fulfilled_at: null,
    cancelled_at: null,
    created_at: '2026-09-12T00:00:00.000Z',
    ...over,
  }
}

function request(actionId: string, obligationId: string, over: Partial<FieldRequest> = {}): FieldRequest {
  return {
    id: id(),
    organization_id: 'gadream365',
    action_id: actionId,
    obligation_id: obligationId,
    cycle_no: 1,
    recipient_code: 'A01',
    message: '다음 방문 때 식사량을 확인해 주세요.',
    target_mode: 'recipient_assignees',
    target_caregiver_code: null,
    status: 'published',
    published_at: '2026-09-12T01:00:00.000Z',
    first_shown_at: null,
    first_shown_to: null,
    answered_at: null,
    ended_at: null,
    end_reason: null,
    version: 1,
    publish_request_id: id(),
    ...over,
  }
}

function response(requestId: string, actionId: string, obligationId: string, submittedAt: string, over: Partial<FieldResponse> = {}): FieldResponse {
  return {
    id: id(),
    field_request_id: requestId,
    action_id: actionId,
    obligation_id: obligationId,
    report_id: id(),
    recipient_code: 'A01',
    responder_code: 'C01',
    response_status: 'observed',
    response_text: '확인했습니다',
    evidence_excerpt: null,
    evidence_source: null,
    request_state_at_response: 'published',
    fulfilled_obligation: true,
    submitted_at: submittedAt,
    request_id: id(),
    ...over,
  }
}

function verification(actionId: string, verifiedAt: string, over: Partial<ActionVerification> = {}): ActionVerification {
  return {
    id: id(),
    action_id: actionId,
    cycle_no: 1,
    outcome: 'no_change',
    summary: '변화 없음',
    evidence: '현장 응답 확인',
    response_ids: [],
    remaining_issue: null,
    next_responsibility: null,
    closes_action: true,
    verified_at: verifiedAt,
    actor_scope: 'org_admin_shared',
    entered_by_label: null,
    request_id: id(),
    ...over,
  }
}

function decision(reportId: string, decidedAt: string, over: Partial<AdminDecision> = {}): AdminDecision {
  return {
    id: id(),
    organization_id: 'gadream365',
    report_id: reportId,
    decision: 'action_needed',
    reason: '식사량 감소',
    decided_at: decidedAt,
    actor_scope: 'org_admin_shared',
    entered_by_label: null,
    request_id: id(),
    previous_decision_id: null,
    ...over,
  }
}

function reportEvent(reportId: string, type: ReportEvent['event_type'], at: string): ReportEvent {
  return { id: id(), report_id: reportId, event_type: type, occurred_at: at, actor_scope: 'x', actor_ref: null, request_id: null, recorded_at: at }
}

function actionEvent(actionId: string, type: ActionEvent['event_type'], at: string, reason: string | null = null): ActionEvent {
  return {
    id: id(),
    action_id: actionId,
    obligation_id: null,
    event_type: type,
    reason,
    detail: {},
    actor_scope: 'org_admin_shared',
    entered_by_label: null,
    owner_label_at_event: null,
    request_id: id(),
    occurred_at: at,
  }
}

function report(over: Partial<CareReportRecord> = {}): CareReportRecord {
  return {
    id: id(),
    participant_code: 'C01',
    recipient_code: 'A01',
    report_type: 'daily',
    report_date: '2026-09-15',
    status: 'submitted',
    submitted_at: '2026-09-15T02:00:00.000Z',
    review_status: 'pending',
    report_source: 'live',
    deleted: false,
    ...over,
  } as CareReportRecord
}

describe('운영 지표 기간', () => {
  it('한국시간 자정 경계로 기간을 잡고 오늘 하루를 포함한다', () => {
    const w = operationWindow(NOW, 7)
    expect(w.startDate).toBe('2026-09-11')
    expect(w.endDate).toBe('2026-09-17')
    // 종료는 한국시간 09-18 00:00(= 09-17T15:00Z) 미포함.
    expect(w.endIso).toBe('2026-09-17T15:00:00.000Z')
    // 시작은 한국시간 09-11 00:00(= 09-10T15:00Z) 포함.
    expect(w.startIso).toBe('2026-09-10T15:00:00.000Z')
    expect(operationWindow(NOW, 0).startIso).toBeNull()
  })

  it('한국시간 자정 직전·직후 보고가 다른 날로 갈린다', () => {
    // 한국시간 09-11 00:00 정각 제출은 포함, 그 1밀리초 전은 제외.
    const inside = report({ id: 'a', submitted_at: '2026-09-10T15:00:00.000Z' })
    const outside = report({ id: 'b', submitted_at: '2026-09-10T14:59:59.999Z' })
    const m = metric(
      base({
        reports: [inside, outside],
        reportEvents: [reportEvent('a', 'submitted', inside.submitted_at!), reportEvent('b', 'submitted', outside.submitted_at!)],
      }),
      'first_review_time',
    )
    expect(m.denominator).toBe(1)
  })

  it('알 수 없는 기간 값은 30일로 돌아간다', () => {
    expect(parseOperationPeriod('7')).toBe(7)
    expect(parseOperationPeriod('0')).toBe(0)
    expect(parseOperationPeriod('999')).toBe(30)
    expect(parseOperationPeriod(null)).toBe(30)
  })
})

describe('최초 검토시간', () => {
  it('제출→첫 검토 경과시간의 중앙값·90백분위를 내고, 미검토는 대기로 따로 센다', () => {
    const events = [
      reportEvent('r1', 'submitted', '2026-09-15T00:00:00.000Z'),
      reportEvent('r1', 'review_approved', '2026-09-15T01:00:00.000Z'),
      reportEvent('r2', 'submitted', '2026-09-15T00:00:00.000Z'),
      reportEvent('r2', 'review_rejected', '2026-09-15T03:00:00.000Z'),
      reportEvent('r3', 'submitted', '2026-09-16T00:00:00.000Z'), // 아직 미검토
    ]
    const m = metric(base({ reportEvents: events }), 'first_review_time')
    expect(m.state).toBe('ok')
    expect(m.denominator).toBe(3)
    expect(m.numerator).toBe(2)
    expect(m.values.find((v) => v.label === '중앙값')?.text).toBe('1시간')
    expect(m.values.find((v) => v.label === '90백분위')?.text).toBe('3시간')
    expect(m.values.find((v) => v.label === '아직 미검토')?.text).toContain('1건')
  })

  it('제출 이벤트가 없는 이전 보고는 시각을 만들어 채우지 않고 제외로만 남긴다', () => {
    const m = metric(base({ reports: [report({ submitted_at: '2026-09-15T02:00:00.000Z' })] }), 'first_review_time')
    expect(m.denominator).toBe(0)
    expect(m.state).toBe('not_applicable')
    expect(m.excluded.find((x) => x.label.includes('제출 이벤트가 없는'))?.count).toBe(1)
  })

  it('90백분위는 최근접 순위법이며 보간값을 만들지 않는다', () => {
    expect(percentileSeconds([60, 120, 180], 90)).toBe(180)
    expect(percentileSeconds([], 50)).toBeNull()
  })

  it('2단계 저장소가 없으면 0%가 아니라 미측정이다', () => {
    const m = metric(base({ workflowReady: false }), 'first_review_time')
    expect(m.state).toBe('not_measurable')
    expect(m.percent).toBeNull()
  })
})

describe('요청 응답률', () => {
  it('최초 기한이 기간 안에 도래한 의무만 세고, 늦은 응답도 응답으로 세되 따로 표시한다', () => {
    const a = action()
    const o1 = obligation(a.id, { initial_due_at: '2026-09-14T00:00:00.000Z' })
    const o2 = obligation(a.id, { initial_due_at: '2026-09-14T00:00:00.000Z' })
    const o3 = obligation(a.id, { initial_due_at: '2026-09-25T00:00:00.000Z' }) // 아직 기한 전 → 분모 밖
    const r1 = request(a.id, o1.id)
    const r2 = request(a.id, o2.id)
    const r3 = request(a.id, o3.id)
    const m = metric(
      base({
        actions: [a],
        obligations: [o1, o2, o3],
        requests: [r1, r2, r3],
        responses: [response(r1.id, a.id, o1.id, '2026-09-15T00:00:00.000Z')], // 기한 뒤 도착
      }),
      'request_response_rate',
    )
    expect(m.denominator).toBe(2)
    expect(m.numerator).toBe(1)
    expect(m.percent).toBe(50)
    expect(m.values.find((v) => v.label === '기한 지나 도착한 응답')?.text).toBe('1건')
    expect(m.breakdown.find((b) => b.label.includes('관찰함'))?.count).toBe(1)
  })

  it('취소된 의무는 분모에서 빼되 취소 전 지연을 숨기지 않고, 게시된 적 없는 의무도 미응답 실패로 세지 않는다', () => {
    const a = action()
    const cancelledLate = obligation(a.id, { status: 'cancelled', cancelled_at: '2026-09-16T00:00:00.000Z' })
    const neverPublished = obligation(a.id)
    const m = metric(
      base({ actions: [a], obligations: [cancelledLate, neverPublished], requests: [request(a.id, cancelledLate.id)] }),
      'request_response_rate',
    )
    expect(m.denominator).toBe(0)
    expect(m.state).toBe('not_applicable')
    expect(m.excluded.find((x) => x.label === '취소된 의무')?.note).toContain('1건')
    expect(m.excluded.find((x) => x.label.includes('게시된 적 없어'))?.count).toBe(1)
  })

  it("'다음 실제 방문' 기한은 응답률 분모에 섞지 않고 별도 집계로만 보인다", () => {
    const a = action()
    const visit = obligation(a.id, { initial_due_kind: 'next_actual_visit', initial_due_at: null, current_due_kind: 'next_actual_visit', current_due_at: null })
    const input = base({ actions: [a], obligations: [visit], requests: [request(a.id, visit.id)] })
    expect(metric(input, 'request_response_rate').denominator).toBe(0)
    const nv = metric(input, 'next_visit_requests')
    expect(nv.state).toBe('not_measurable')
    expect(nv.percent).toBeNull()
    expect(nv.values.find((v) => v.label === '게시된 요청')?.text).toBe('1건')
    expect(nv.values.find((v) => v.label === '방문 발생 확인 불가')?.text).toBe('1건')
  })

  it('3단계 저장소가 없으면 미측정이다', () => {
    expect(metric(base({ fieldRequestsReady: false }), 'request_response_rate').state).toBe('not_measurable')
  })
})

describe('기한 내 결과확인율', () => {
  it('기한을 미뤄도 최초 기한으로 판정하고, 기한이 바뀐 건수를 함께 보인다', () => {
    const a = action()
    const moved = obligation(a.id, {
      obligation_type: 'admin_verification',
      initial_due_at: '2026-09-14T00:00:00.000Z',
      current_due_at: '2026-09-20T00:00:00.000Z',
    })
    const m = metric(
      base({ actions: [a], obligations: [moved], verifications: [verification(a.id, '2026-09-16T00:00:00.000Z')] }),
      'verification_on_time',
    )
    expect(m.denominator).toBe(1)
    expect(m.numerator).toBe(0) // 최초 기한(09-14) 뒤에 확인됨
    expect(m.values.find((v) => v.label === '기한 뒤에 확인됨')?.text).toBe('1건')
    expect(m.values.find((v) => v.label === '기한이 바뀐 의무')?.text).toContain('1건')
  })

  it('새 후속 주기의 의무는 같은 주기의 결과 확인으로만 채워진다', () => {
    const a = action({ current_cycle: 2 })
    const cycle2 = obligation(a.id, { obligation_type: 'admin_verification', cycle_no: 2, initial_due_at: '2026-09-16T00:00:00.000Z' })
    const m = metric(
      base({ actions: [a], obligations: [cycle2], verifications: [verification(a.id, '2026-09-13T00:00:00.000Z', { cycle_no: 1 })] }),
      'verification_on_time',
    )
    expect(m.numerator).toBe(0)
    expect(m.values.find((v) => v.label === '아직 결과 확인 없음')?.text).toBe('1건')
  })
})

describe('조치 연결률', () => {
  it('조치 없는 이슈를 분모에 남기고, 다시 판단한 옛 판단은 두 번 세지 않는다', () => {
    const linked = decision('r1', '2026-09-14T00:00:00.000Z')
    const bare = decision('r2', '2026-09-14T00:00:00.000Z')
    const old = decision('r3', '2026-09-13T00:00:00.000Z')
    const now = decision('r3', '2026-09-15T00:00:00.000Z', { decision: 'no_action_needed', previous_decision_id: old.id })
    const m = metric(
      base({ decisions: [linked, bare, old, now], actions: [action({ decision_id: linked.id })] }),
      'action_link_rate',
    )
    expect(m.denominator).toBe(2)
    expect(m.numerator).toBe(1)
    expect(m.excluded.find((x) => x.label.includes('옛'))?.count).toBe(1)
  })

  it('취소만 된 조치는 연결로 세지 않는다', () => {
    const d = decision('r1', '2026-09-14T00:00:00.000Z')
    const m = metric(base({ decisions: [d], actions: [action({ decision_id: d.id, status: 'cancelled' })] }), 'action_link_rate')
    expect(m.numerator).toBe(0)
    expect(m.breakdown.find((b) => b.label.includes('취소만'))?.count).toBe(1)
  })
})

describe('결과 근거 보유율 · 재개방', () => {
  it('취소는 종결과 구분해 분모에 넣지 않고, 근거 글만 있는 주기를 따로 센다', () => {
    const a = action()
    const b = action({ status: 'cancelled', cancelled_at: '2026-09-15T00:00:00.000Z' })
    const m = metric(
      base({
        actions: [a, b],
        verifications: [
          verification(a.id, '2026-09-15T00:00:00.000Z', { response_ids: ['x'] }),
          verification(a.id, '2026-09-16T00:00:00.000Z', { closes_action: false, outcome: 'unable_to_confirm' }),
        ],
      }),
      'outcome_evidence_rate',
    )
    expect(m.denominator).toBe(2)
    expect(m.numerator).toBe(1)
    expect(m.values.find((v) => v.label.includes('근거 글만'))?.text).toBe('1건')
    expect(m.values.find((v) => v.label === '새 후속 주기를 연 주기')?.text).toBe('1건')
    expect(m.excluded.find((x) => x.label === '취소된 조치')?.count).toBe(1)
  })

  it('재개방은 이벤트 수와 고유 조치 수를 나눠 세고, 0건은 오류가 아니라 해당 없음이다', () => {
    const a = action()
    const withRows = metric(
      base({ actions: [a], actionEvents: [actionEvent(a.id, 'reopened', '2026-09-15T00:00:00.000Z', '증상 재발'), actionEvent(a.id, 'reopened', '2026-09-16T00:00:00.000Z')] }),
      'reopen_count',
    )
    expect(withRows.values.find((v) => v.label === '재개방 이벤트')?.text).toBe('2건')
    expect(withRows.values.find((v) => v.label === '고유 조치')?.text).toBe('1건')
    expect(withRows.breakdown.some((b) => b.label.includes('증상 재발'))).toBe(true)
    expect(metric(base({}), 'reopen_count').state).toBe('not_applicable')
  })
})

describe('원천 상태별 건수', () => {
  it('준비되지 않은 저장소는 건수를 만들지 않고 ready:false로 남긴다', () => {
    const view = buildOperationMetrics(base({ workflowReady: false, reports: [report()] }))
    const byId = Object.fromEntries(view.sourceCounts.map((s) => [s.id, s]))
    expect(byId.reports_pending.count).toBe(1)
    expect(byId.actions_open.ready).toBe(false)
    expect(byId.actions_open.count).toBeNull()
    expect(byId.requests_published.count).toBeNull()
  })

  it('열린 조치와 기한 경과 의무는 현재 상태 기준이며 기간 지표와 분모가 다르다', () => {
    const open = action()
    const done = action({ status: 'completed' })
    const view = buildOperationMetrics(
      base({
        actions: [open, done],
        obligations: [obligation(open.id, { initial_due_at: '2026-01-01T00:00:00.000Z', current_due_at: '2026-01-01T00:00:00.000Z' })],
      }),
    )
    const byId = Object.fromEntries(view.sourceCounts.map((s) => [s.id, s]))
    expect(byId.actions_open.count).toBe(1)
    expect(byId.obligations_overdue.count).toBe(1)
    // 그 의무의 최초 기한(2026-01-01)은 최근 7일 밖이라 기간 비율의 분모에는 들어가지 않는다.
    expect(view.metrics.find((m) => m.id === 'request_response_rate')?.denominator).toBe(0)
  })
})
