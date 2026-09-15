import { describe, expect, it } from 'vitest'
import type { CareReportRecord } from './careTypes.js'
import { buildWorkBoard } from './workBoard.js'
import {
  kstDayRange,
  kstLocalToIso,
  planActionMutation,
  planCreateAction,
  planDecision,
  planSafetyReview,
  WorkflowError,
  type ActionObligation,
  type CareAction,
  type ReportEvent,
  type SafetyReview,
  type WorkflowContext,
} from './workflow.js'
import { filterActions, summarizeAction } from './workflowViews.js'

let n = 0
const ctx = (now = '2026-09-15T03:00:00.000Z'): WorkflowContext => ({ now, organizationId: 'gadream365', newId: () => `id-${++n}` })

function expectError(fn: () => unknown, status: number, message?: RegExp) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(WorkflowError)
    expect((e as WorkflowError).status).toBe(status)
    if (message) expect((e as WorkflowError).message).toMatch(message)
    return
  }
  throw new Error('오류가 나야 합니다')
}

function report(o: Partial<CareReportRecord>): CareReportRecord {
  return {
    id: `r-${++n}`,
    participant_code: 'C01',
    recipient_code: 'A01',
    report_type: 'daily',
    report_date: '2026-09-15',
    status: 'submitted',
    submitted_at: '2026-09-15T01:00:00.000Z',
    started_at: '2026-09-15T00:59:00.000Z',
    created_at: '2026-09-15T00:59:00.000Z',
    updated_at: '2026-09-15T01:00:00.000Z',
    raw_input: '원문',
    review_status: 'pending',
    emergency_flagged: false,
    report_source: 'live',
    deleted: false,
    ...o,
  } as CareReportRecord
}

const fieldRequest = (extra: Partial<Parameters<typeof planCreateAction>[0]> = {}) =>
  planCreateAction(
    { recipientCode: 'A01', kind: 'field_request', purpose: '식사량 재확인', fieldMessageDraft: '다음 방문 때 식사량을 확인해 주세요', activate: true, responseDue: { kind: 'next_actual_visit' }, verificationDue: { kind: 'unset' }, requestId: `c-${++n}`, ...extra },
    ctx(),
  )

describe('조치 생성 규칙', () => {
  it('다음 실제 방문에는 날짜를 만들지 않고, 현장 응답 의무는 게시 전이라 시작되지 않는다', () => {
    const plan = fieldRequest()
    const response = plan.obligations.find((o) => o.obligation_type === 'field_response')!
    expect(response).toMatchObject({ initial_due_kind: 'next_actual_visit', initial_due_at: null, status: 'pending_publish', activated_at: null })
    expect(plan.action).toMatchObject({ status: 'open', field_message_status: 'unpublished', version: 1 })
    expect(plan.obligations.find((o) => o.obligation_type === 'admin_verification')).toMatchObject({ current_due_kind: 'unset', status: 'active' })
  })

  it('관리자 재확인기한에는 다음 방문을 쓸 수 없고, 요청 내용 없이 진행 중으로 만들 수 없다', () => {
    expectError(() => fieldRequest({ verificationDue: { kind: 'next_actual_visit' } }), 400, /다음 실제 방문/)
    expectError(() => fieldRequest({ fieldMessageDraft: '  ' }), 400, /요청 내용/)
    // 초안은 요청 내용 없이도, 담당 미지정으로도 저장할 수 있다 — 기한도 돌지 않는다.
    const draft = fieldRequest({ fieldMessageDraft: '', activate: false })
    expect(draft.action.status).toBe('draft')
    expect(draft.action.owner_label).toBeNull()
    expect(draft.obligations.every((o) => o.status === 'inactive')).toBe(true)
  })

  it('날짜가 잘못되면 거부한다', () => {
    expectError(() => fieldRequest({ verificationDue: { kind: 'datetime', at: 'not-a-date' } }), 400)
  })
})

describe('조치 변경 규칙', () => {
  const direct = () =>
    planCreateAction(
      { recipientCode: 'A01', kind: 'admin_direct', purpose: '보호자 연락', activate: true, executionDue: { kind: 'datetime', at: '2026-09-15T02:00:00.000Z' }, verificationDue: { kind: 'datetime', at: '2026-09-16T02:00:00.000Z' }, requestId: `c-${++n}` },
      ctx('2026-09-15T00:00:00.000Z'),
    )

  it('버전이 다르면 충돌, 기한 변경은 이유가 필요하고 최초 기한과 당시 연체 여부를 남긴다', () => {
    const s = direct()
    const exec = s.obligations.find((o) => o.obligation_type === 'admin_execution')!
    expectError(() => planActionMutation(s, { actionId: s.action.id, op: 'activate', expectedVersion: 0, requestId: 'x' }, ctx()), 409)
    expectError(() => planActionMutation(s, { actionId: s.action.id, op: 'change_due', obligationId: exec.id, due: { kind: 'datetime', at: '2026-09-17T00:00:00.000Z' }, reason: ' ', expectedVersion: 1, requestId: 'x' }, ctx()), 400, /이유/)
    const p = planActionMutation(s, { actionId: s.action.id, op: 'change_due', obligationId: exec.id, due: { kind: 'datetime', at: '2026-09-17T00:00:00.000Z' }, reason: '보호자 부재', expectedVersion: 1, requestId: 'x' }, ctx())
    const changed = p.obligations.find((o) => o.id === exec.id)!
    expect(changed).toMatchObject({ initial_due_at: '2026-09-15T02:00:00.000Z', current_due_at: '2026-09-17T00:00:00.000Z' })
    expect(p.event).toMatchObject({ event_type: 'due_changed', obligation_id: exec.id, reason: '보호자 부재' })
    expect(p.event.detail).toMatchObject({ was_overdue: true })
    expect(p.action.version).toBe(2)
  })

  it('현장 확인 요청은 답변 확인 전 완료할 수 없고, 직접 조치 완료는 근거가 필요하다', () => {
    const f = fieldRequest()
    expectError(() => planActionMutation(f, { actionId: f.action.id, op: 'complete', evidence: '했음', expectedVersion: 1, requestId: 'y' }, ctx()), 409, /결과 확인/)
    const d = direct()
    expectError(() => planActionMutation(d, { actionId: d.action.id, op: 'complete', evidence: '', expectedVersion: 1, requestId: 'y' }, ctx()), 400)
    const done = planActionMutation(d, { actionId: d.action.id, op: 'complete', evidence: '보호자와 통화, 병원 동행 예정', expectedVersion: 1, requestId: 'y' }, ctx())
    expect(done.action).toMatchObject({ status: 'completed', completion_evidence: '보호자와 통화, 병원 동행 예정' })
    expect(done.obligations.every((o) => o.status === 'fulfilled')).toBe(true)
  })

  it('재개는 기존 주기·완료 기록을 두고 새 주기를 만든다, 완료된 조치는 바로 고칠 수 없다', () => {
    const d = direct()
    const done = planActionMutation(d, { actionId: d.action.id, op: 'complete', evidence: '통화함', expectedVersion: 1, requestId: 'z1' }, ctx())
    expectError(() => planActionMutation(done, { actionId: d.action.id, op: 'update', purpose: '수정', expectedVersion: 2, requestId: 'z2' }, ctx()), 409)
    const reopened = planActionMutation(done, { actionId: d.action.id, op: 'reopen', reason: '보호자 재연락 필요', verificationDue: { kind: 'unset' }, expectedVersion: 2, requestId: 'z3' }, ctx())
    expect(reopened.action).toMatchObject({ status: 'open', current_cycle: 2 })
    expect(reopened.obligations.filter((o) => o.cycle_no === 1).every((o) => o.status === 'fulfilled')).toBe(true)
    expect(reopened.obligationInserts.map((o) => [o.cycle_no, o.obligation_type, o.status])).toEqual([
      [2, 'admin_execution', 'active'],
      [2, 'admin_verification', 'active'],
    ])
    expect(reopened.event.detail).toMatchObject({ previous_evidence: '통화함', new_cycle: 2 })
  })

  it('취소는 이유를 남기고 끝나지 않은 의무를 모두 취소한다', () => {
    const f = fieldRequest()
    const c = planActionMutation(f, { actionId: f.action.id, op: 'cancel', reason: '보호자가 직접 확인', expectedVersion: 1, requestId: 'q' }, ctx())
    expect(c.action).toMatchObject({ status: 'cancelled', cancel_reason: '보호자가 직접 확인' })
    expect(c.obligations.every((o) => o.status === 'cancelled')).toBe(true)
  })
})

describe('판단·안전 검토 규칙', () => {
  it('판단은 제출된 보고에만, 최신 판단을 모르면 충돌', () => {
    expectError(() => planDecision({ id: 'r', status: 'draft' }, null, { reportId: 'r', decision: 'no_action_needed', expectedLatestDecisionId: null, requestId: 'a' }, ctx()), 409)
    const first = planDecision({ id: 'r', status: 'submitted' }, null, { reportId: 'r', decision: 'no_action_needed', expectedLatestDecisionId: null, requestId: 'a' }, ctx())
    expect(first).toMatchObject({ actor_scope: 'org_admin_shared', previous_decision_id: null, entered_by_label: null })
    expectError(() => planDecision({ id: 'r', status: 'submitted' }, first, { reportId: 'r', decision: 'action_needed', expectedLatestDecisionId: null, requestId: 'b' }, ctx()), 409)
  })

  it('안전 검토는 신호가 있는 보고에만, 조치 연결은 같은 수급자 조치가 있어야', () => {
    const flagged = { id: 'r', status: 'submitted', emergency_flagged: true, updated_at: '2026-09-15T01:00:00Z', recipient_code: 'A01' }
    expectError(() => planSafetyReview({ ...flagged, emergency_flagged: false }, null, null, { reportId: 'r', outcome: 'no_further_action', reason: '확인', expectedLatestReviewId: null, requestId: 's' }, ctx()), 409)
    expectError(() => planSafetyReview(flagged, null, null, { reportId: 'r', outcome: 'action_linked', reason: '확인', expectedLatestReviewId: null, requestId: 's' }, ctx()), 400, /조치를 선택/)
    expectError(() => planSafetyReview(flagged, null, { id: 'a', recipient_code: 'A02', status: 'open' }, { reportId: 'r', outcome: 'action_linked', reason: '확인', relatedActionId: 'a', expectedLatestReviewId: null, requestId: 's' }, ctx()), 400, /같은 수급자/)
    const ok = planSafetyReview(flagged, null, null, { reportId: 'r', outcome: 'no_further_action', reason: '현장에서 119 연결 확인', enteredByLabel: '사회복지사1', expectedLatestReviewId: null, requestId: 's' }, ctx())
    expect(ok).toMatchObject({ report_status_at_review: 'submitted', report_updated_at_at_review: '2026-09-15T01:00:00Z', entered_by_label: '사회복지사1', actor_scope: 'org_admin_shared' })
  })
})

describe('한국 시간 날짜 경계', () => {
  it('오늘은 한국 자정부터 다음 자정 전까지', () => {
    expect(kstDayRange(new Date('2026-09-15T14:59:59Z'))).toEqual({ date: '2026-09-15', start: '2026-09-14T15:00:00.000Z', end: '2026-09-15T15:00:00.000Z' })
    expect(kstDayRange(new Date('2026-09-15T15:00:00Z')).date).toBe('2026-09-16')
    expect(kstLocalToIso('2026-09-16T09:00')).toBe('2026-09-16T00:00:00.000Z')
    expect(kstLocalToIso('bad')).toBeNull()
  })
})

describe('업무 카드와 목록', () => {
  const now = new Date('2026-09-15T03:00:00.000Z') // 한국 12:00
  const ev = (reportId: string, type: ReportEvent['event_type']): ReportEvent => ({ id: `e-${++n}`, report_id: reportId, event_type: type, occurred_at: '2026-09-15T02:00:00Z', actor_scope: 'x', actor_ref: null, request_id: null, recorded_at: '2026-09-15T02:00:00Z' })

  it('보고 승인만으로 안전 신호가 검토된 것으로 바뀌지 않는다, 이전 보고·임시저장 신호는 따로 센다', () => {
    const approvedAfter = report({ emergency_flagged: true, review_status: 'approved', recipient_code: 'A01' })
    const approvedLegacy = report({ emergency_flagged: true, review_status: 'approved', recipient_code: 'A02' })
    const pending = report({ emergency_flagged: true, recipient_code: 'A01' })
    const draft = report({ emergency_flagged: true, status: 'draft', submitted_at: null })
    const reviewed = report({ emergency_flagged: true })
    const review = { id: 'sr', report_id: reviewed.id, reviewed_at: '2026-09-15T02:30:00Z', outcome: 'no_further_action' } as SafetyReview
    const board = buildWorkBoard({
      reports: [approvedAfter, approvedLegacy, pending, draft, reviewed],
      safetyReviews: [review],
      actions: [],
      obligations: [],
      reportEvents: [ev(approvedAfter.id, 'review_approved')],
      workflowReady: true,
      now,
    })
    expect(board.lists.safety.map((s) => s.reportId).sort()).toEqual([approvedAfter.id, pending.id].sort())
    expect(board.cards.safety).toMatchObject({ ready: true, signals: 2, recipients: 1, draftSignals: 1, legacyUnclear: 1 })
    expect(board.lists.safetyLegacy.map((s) => s.reportId)).toEqual([approvedLegacy.id])
  })

  it('저장소 준비 전에는 조치 카드를 "준비 중"으로 두고, 안전 신호는 검토 여부 미확인으로만 보인다', () => {
    const board = buildWorkBoard({ reports: [report({ emergency_flagged: true, review_status: 'approved' })], safetyReviews: [], actions: [], obligations: [], reportEvents: [], workflowReady: false, now })
    expect(board.cards.overdue.ready).toBe(false)
    expect(board.cards.today.ready).toBe(false)
    expect(board.cards.safety.ready).toBe(false)
    expect(board.combined[0].notes[0]).toMatch(/검토 여부 미확인/)
  })

  it('기한 지난 조치는 고유 조치 수, 게시 전 현장 응답·초안·완료·취소는 세지 않는다, 오늘 재확인은 한국 날짜 기준', () => {
    const mk = (over: Partial<CareAction>, obs: Array<Partial<ActionObligation>>) => {
      const id = `a-${++n}`
      const action = { id, recipient_code: 'A01', kind: 'admin_direct', status: 'open', purpose: `조치 ${id}`, owner_label: null, source_report_id: null, version: 1, current_cycle: 1, created_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T00:00:00Z', ...over } as CareAction
      const obligations = obs.map((o, i) => ({ id: `${id}-o${i}`, action_id: id, cycle_no: 1, obligation_type: 'admin_verification', status: 'active', initial_due_kind: 'datetime', current_due_kind: 'datetime', initial_due_at: o.current_due_at ?? null, ...o }) as ActionObligation)
      return { action, obligations }
    }
    const twoLate = mk({}, [
      { obligation_type: 'admin_execution', current_due_at: '2026-09-14T01:00:00Z' },
      { obligation_type: 'admin_verification', current_due_at: '2026-09-15T01:00:00Z' }, // 오늘 한국 10시 — 지남 + 오늘
    ])
    const fieldPending = mk({ kind: 'field_request' }, [{ obligation_type: 'field_response', status: 'pending_publish', current_due_at: '2026-09-10T00:00:00Z' }])
    const draft = mk({ status: 'draft' }, [{ status: 'inactive', current_due_at: '2026-09-10T00:00:00Z' }])
    const cancelled = mk({ status: 'cancelled' }, [{ status: 'cancelled', current_due_at: '2026-09-10T00:00:00Z' }])
    const tomorrowKst = mk({}, [{ current_due_at: '2026-09-15T15:30:00Z' }]) // 한국 9/16 00:30
    const laterToday = mk({}, [{ current_due_at: '2026-09-15T10:00:00Z' }]) // 한국 19:00
    const all = [twoLate, fieldPending, draft, cancelled, tomorrowKst, laterToday]
    const board = buildWorkBoard({ reports: [], safetyReviews: [], actions: all.map((x) => x.action), obligations: all.flatMap((x) => x.obligations), reportEvents: [], workflowReady: true, now })
    expect(board.cards.overdue).toEqual({ ready: true, actions: 1, obligations: 2 })
    expect(board.cards.today).toEqual({ ready: true, actions: 2, obligations: 2 })
    expect(board.lists.today.map((a) => a.actionId)).toEqual([twoLate.action.id, laterToday.action.id])
    // 통합 목록에서는 같은 조치가 한 번만(앞 범주인 '기한 지난 조치'로)
    expect(board.combined.filter((c) => c.actionId === twoLate.action.id).map((c) => c.category)).toEqual(['overdue'])
    // 조치 목록 필터도 같은 판정을 쓴다
    const summaries = all.map((x) => summarizeAction(x.action, x.obligations, now))
    expect(filterActions(summaries, 'overdue').map((s) => s.id)).toEqual([twoLate.action.id])
    expect(filterActions(summaries, 'today').map((s) => s.id).sort()).toEqual([twoLate.action.id, laterToday.action.id].sort())
    expect(filterActions(summaries, 'unassigned').length).toBe(5) // 진행 중·초안 중 담당 미지정
  })

  it('통합 목록 순서는 안전 신호 → 기한 지남 → 오늘 재확인 → 변화·확인 필요 → 일반, 같은 보고는 한 번', () => {
    const safetyReport = report({ emergency_flagged: true, submitted_at: '2026-09-15T02:00:00Z' })
    const changed = report({ initial_status_choice: 'changed', submitted_at: '2026-09-15T01:30:00Z' })
    const usualOld = report({ initial_status_choice: 'similar', submitted_at: '2026-09-14T01:00:00Z' })
    const board = buildWorkBoard({ reports: [usualOld, changed, safetyReport], safetyReviews: [], actions: [], obligations: [], reportEvents: [], workflowReady: true, now })
    expect(board.combined.map((c) => [c.category, c.reportId])).toEqual([
      ['safety', safetyReport.id],
      ['report_attention', changed.id],
      ['report_general', usualOld.id],
    ])
    expect(board.cards.reports).toEqual({ reports: 3, recipients: 1 })
  })

  it('보고가 많아도 잘라내지 않는다(카드 수 = 목록 길이)', () => {
    const many = Array.from({ length: 1200 }, (_, i) => report({ recipient_code: `A${(i % 9) + 1}`, submitted_at: new Date(Date.UTC(2026, 8, 1) + i * 60000).toISOString() }))
    const board = buildWorkBoard({ reports: many, safetyReviews: [], actions: [], obligations: [], reportEvents: [], workflowReady: true, now })
    expect(board.cards.reports.reports).toBe(1200)
    expect(board.lists.reports).toHaveLength(1200)
  })
})
