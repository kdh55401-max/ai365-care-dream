import { describe, expect, it } from 'vitest'
import type { CareReportRecord } from './careTypes.js'
import { buildWorkBoard } from './workBoard.js'
import {
  isRequestVisibleTo,
  planActionMutation,
  planCreateAction,
  planFieldResponse,
  WorkflowError,
  type ActionMutationInput,
  type ActionState,
  type FieldResponse,
  type WorkflowContext,
} from './workflow.js'
import { findResponseEvidence, reportEvidenceTexts, requestWaitState, routingProblem, sanitizeEvidence, toCenterRequestView } from './fieldRequests.js'
import { summarizeAction } from './workflowViews.js'

let n = 0
const NOW = '2026-09-15T03:00:00.000Z'
const ctx = (now = NOW): WorkflowContext => ({ now, organizationId: 'gadream365', newId: () => `id-${++n}` })

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

function report(o: Partial<CareReportRecord> = {}): CareReportRecord {
  return {
    id: `r-${++n}`,
    participant_code: 'C01',
    recipient_code: 'A01',
    report_type: 'daily',
    report_date: '2026-09-15',
    status: 'submitted',
    submitted_at: '2026-09-15T04:00:00.000Z',
    started_at: '2026-09-15T03:59:00.000Z',
    created_at: '2026-09-15T03:59:00.000Z',
    updated_at: '2026-09-15T04:00:00.000Z',
    raw_input: '원문',
    review_status: 'pending',
    emergency_flagged: false,
    report_source: 'live',
    deleted: false,
    followup_answers: [],
    ...o,
  } as CareReportRecord
}

/** 진행 중인 현장 확인 요청 조치 한 건의 상태(요청·응답·배정 포함). */
function fieldState(assignees = ['C01', 'C02']): ActionState {
  const plan = planCreateAction(
    {
      recipientCode: 'A01',
      kind: 'field_request',
      purpose: '식사량 재확인',
      fieldMessageDraft: '다음 방문 때 식사량을 확인해 주세요',
      internalNote: '보호자 민원 이력 있음(내부)',
      activate: true,
      responseDue: { kind: 'next_actual_visit' },
      verificationDue: { kind: 'unset' },
      requestId: `c-${++n}`,
    },
    ctx(),
  )
  return { action: plan.action, obligations: plan.obligations, requests: [], responses: [], assignees }
}

function apply(state: ActionState, op: Record<string, unknown>, now = NOW): ActionState {
  const plan = planActionMutation(state, { actionId: state.action.id, expectedVersion: state.action.version, requestId: `m-${++n}`, ...op } as ActionMutationInput, ctx(now))
  const requests = (state.requests ?? []).map((r) => plan.requestUpdates.find((u) => u.id === r.id) ?? r).concat(plan.requestInserts)
  return { ...state, action: plan.action, obligations: plan.obligations, requests }
}

function respond(state: ActionState, rep: CareReportRecord, responder: string, status: FieldResponse['response_status'] = 'observed', now = NOW) {
  const request = state.requests![state.requests!.length - 1]
  const plan = planFieldResponse(
    { report: rep, responderCode: responder, assignees: state.assignees ?? [], request, action: state.action, obligation: state.obligations.find((o) => o.id === request.obligation_id) ?? null },
    { fieldRequestId: request.id, status, text: null, requestId: `resp-${++n}` },
    ctx(now),
  )
  const next: ActionState = {
    ...state,
    action: plan.actionUpdate ?? state.action,
    obligations: state.obligations.map((o) => (plan.obligationUpdate?.id === o.id ? plan.obligationUpdate : o)),
    requests: state.requests!.map((r) => (plan.requestUpdate?.id === r.id ? plan.requestUpdate : r)),
    responses: [...(state.responses ?? []), plan.response],
  }
  return { plan, next }
}

describe('게시', () => {
  it('게시하면 요청 문구가 고정되고 현장 응답기한이 시작된다(내부 메모는 요청에 없다)', () => {
    const s = apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' })
    const req = s.requests![0]
    expect(req).toMatchObject({ status: 'published', message: '다음 방문 때 식사량을 확인해 주세요', target_mode: 'recipient_assignees', target_caregiver_code: null, first_shown_at: null })
    expect(JSON.stringify(req)).not.toContain('민원')
    expect(JSON.stringify(toCenterRequestView(req, null))).not.toContain('민원')
    expect(s.obligations.find((o) => o.obligation_type === 'field_response')).toMatchObject({ status: 'active', activated_at: NOW, current_due_kind: 'next_actual_visit', current_due_at: null })
    expect(s.action.field_message_status).toBe('published')
  })

  it('배정된 요양보호사가 없거나 지정 대상이 배정 밖이면 게시하지 않는다, 같은 주기 중복 게시도 막는다', () => {
    expectError(() => apply(fieldState([]), { op: 'publish', targetMode: 'recipient_assignees' }), 409, /배정된 요양보호사가 없어/)
    expectError(() => apply(fieldState(['C01']), { op: 'publish', targetMode: 'specific_caregiver', targetCaregiverCode: 'C09' }), 409, /배정되어 있지 않습니다/)
    const s = apply(fieldState(), { op: 'publish', targetMode: 'specific_caregiver', targetCaregiverCode: 'c02' })
    expect(s.requests![0].target_caregiver_code).toBe('C02')
    expectError(() => apply(s, { op: 'publish', targetMode: 'recipient_assignees' }), 409, /이미 게시/)
  })

  it('초안·관리자 직접 조치는 게시할 수 없다', () => {
    const draft = planCreateAction({ recipientCode: 'A01', kind: 'field_request', purpose: 'x', fieldMessageDraft: 'y', activate: false, requestId: `c-${++n}` }, ctx())
    expectError(() => apply({ action: draft.action, obligations: draft.obligations, assignees: ['C01'] }, { op: 'publish', targetMode: 'recipient_assignees' }), 409)
    const direct = planCreateAction({ recipientCode: 'A01', kind: 'admin_direct', purpose: 'x', actionContent: 'y', activate: true, requestId: `c-${++n}` }, ctx())
    expectError(() => apply({ action: direct.action, obligations: direct.obligations, assignees: ['C01'] }, { op: 'publish', targetMode: 'recipient_assignees' }), 400)
  })
})

describe('현장 화면 노출 · 배정 변경', () => {
  it('현재 배정·지정 대상에게만, 게시 중인 요청만 보인다', () => {
    const all = apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' }).requests![0]
    expect(isRequestVisibleTo(all, 'C01', ['A01'])).toBe(true)
    expect(isRequestVisibleTo(all, 'C03', ['A02'])).toBe(false) // 배정 해제된 사람
    const one = apply(fieldState(), { op: 'publish', targetMode: 'specific_caregiver', targetCaregiverCode: 'C01' }).requests![0]
    expect(isRequestVisibleTo(one, 'C01', ['A01'])).toBe(true)
    expect(isRequestVisibleTo(one, 'C02', ['A01'])).toBe(false)
    expect(isRequestVisibleTo({ ...one, status: 'answered' }, 'C01', ['A01'])).toBe(false) // 이미 답한 요청은 다시 묻지 않는다
  })

  it('배정이 바뀌어 아무에게도 안 보이면 재배정 필요로 표시한다', () => {
    const one = apply(fieldState(), { op: 'publish', targetMode: 'specific_caregiver', targetCaregiverCode: 'C01' }).requests![0]
    expect(routingProblem(one, ['C02'])).toBe('target_unassigned')
    expect(routingProblem(one, [])).toBe('no_assignee')
    expect(routingProblem(one, ['C01'])).toBeNull()
  })

  it('대상 변경은 지금 배정된 사람으로만, 문구·기한은 그대로', () => {
    const s = apply(fieldState(['C01', 'C02']), { op: 'publish', targetMode: 'specific_caregiver', targetCaregiverCode: 'C01' })
    const moved = apply({ ...s, assignees: ['C02'] }, { op: 'retarget', fieldRequestId: s.requests![0].id, targetMode: 'specific_caregiver', targetCaregiverCode: 'C02', reason: '담당 변경' })
    expect(moved.requests![0]).toMatchObject({ target_caregiver_code: 'C02', message: s.requests![0].message, version: 2 })
    expectError(() => apply({ ...s, assignees: ['C02'] }, { op: 'retarget', fieldRequestId: s.requests![0].id, targetMode: 'specific_caregiver', targetCaregiverCode: 'C01', reason: 'x' }), 409)
  })
})

describe('현장 응답', () => {
  it('첫 응답은 현장 응답 대기를 풀지만 조치를 완료하지 않는다(관리자 재확인 의무는 남는다)', () => {
    const s = apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' })
    const { plan, next } = respond(s, report(), 'C01')
    expect(plan.response).toMatchObject({ fulfilled_obligation: true, request_state_at_response: 'published', responder_code: 'C01' })
    expect(next.requests![0].status).toBe('answered')
    expect(next.obligations.find((o) => o.obligation_type === 'field_response')?.status).toBe('fulfilled')
    expect(next.obligations.find((o) => o.obligation_type === 'admin_verification')?.status).toBe('active')
    expect(next.action.status).toBe('open')
    expect(plan.event).toMatchObject({ event_type: 'response_received', actor_scope: 'caregiver_session' })
    const summary = summarizeAction(next.action, next.obligations, new Date(NOW), { requests: next.requests!, responses: next.responses!, reports: [], assigneesByRecipient: { A01: ['C01'] } })
    expect(summary.awaitingVerification).toBe(true)
    // 두 번째 응답은 보조 기록 — 의무·버전을 다시 바꾸지 않는다.
    const second = respond(next, report({ participant_code: 'C02' }), 'C02')
    expect(second.plan.response.fulfilled_obligation).toBe(false)
    expect(second.plan.actionUpdate).toBeNull()
  })

  it('권한: 배정 밖·다른 대상·남의 보고·다른 수급자 보고·연습 보고·미제출 보고는 거부', () => {
    const s = apply(fieldState(['C01', 'C02']), { op: 'publish', targetMode: 'specific_caregiver', targetCaregiverCode: 'C01' })
    expectError(() => respond(s, report({ participant_code: 'C02' }), 'C02'), 403, /다른 요양보호사/)
    expectError(() => respond({ ...s, assignees: ['C02'] }, report(), 'C01'), 403, /배정되지 않은/)
    expectError(() => respond(s, report({ participant_code: 'C02' }), 'C01'), 403, /본인이 작성한/)
    expectError(() => respond(s, report({ recipient_code: 'A02' }), 'C01'), 400)
    expectError(() => respond(s, report({ report_source: 'scenario' }), 'C01'), 400)
    expectError(() => respond(s, report({ status: 'draft' }), 'C01'), 409)
  })

  it('철회·취소 뒤 늦게 온 응답은 기록만 남고 조치를 되살리지 않는다', () => {
    const s = apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' })
    const withdrawn = apply(s, { op: 'withdraw', fieldRequestId: s.requests![0].id, reason: '보호자가 직접 확인' })
    expect(withdrawn.obligations.find((o) => o.obligation_type === 'field_response')?.status).toBe('pending_publish')
    const late = respond(withdrawn, report(), 'C01')
    expect(late.plan.response).toMatchObject({ fulfilled_obligation: false, request_state_at_response: 'withdrawn' })
    expect(late.plan.event.detail).toMatchObject({ late: true })
    expect(late.plan.requestUpdate).toBeNull()
    expect(late.plan.obligationUpdate).toBeNull()
    // 같은 주기에서 문구를 고쳐 새 요청으로 다시 게시할 수 있다(철회 기록은 그대로).
    const republished = apply(withdrawn, { op: 'publish', targetMode: 'recipient_assignees' })
    expect(republished.requests!.map((r) => r.status)).toEqual(['withdrawn', 'published'])

    const cancelled = apply(apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' }), { op: 'cancel', reason: '입원' })
    expect(cancelled.requests![0].status).toBe('withdrawn')
    expect(cancelled.obligations.every((o) => o.status === 'cancelled')).toBe(true)
    expect(respond(cancelled, report(), 'C01').plan.response.fulfilled_obligation).toBe(false)
  })
})

describe('결과 확인 · 종결 · 재개방', () => {
  const answered = () => respond(apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' }), report(), 'C01').next
  const verify = (extra: Record<string, unknown>) => ({ op: 'verify', outcome: 'no_change', summary: '식사량 평소와 같음', evidence: '현장 응답(C01)', closeAction: true, ...extra })

  it('현장 요청은 "완료" 대신 결과 확인으로만 끝내며, 요약·근거·시각·연결 응답을 남긴다', () => {
    const s = answered()
    expectError(() => apply(s, { op: 'complete', evidence: 'x' }), 409, /결과 확인/)
    const plan = planActionMutation(s, { actionId: s.action.id, expectedVersion: s.action.version, requestId: `v-${++n}`, ...verify({}) } as ActionMutationInput, ctx('2026-09-16T01:00:00.000Z'))
    expect(plan.verificationInserts[0]).toMatchObject({ outcome: 'no_change', summary: '식사량 평소와 같음', evidence: '현장 응답(C01)', verified_at: '2026-09-16T01:00:00.000Z', closes_action: true, actor_scope: 'org_admin_shared' })
    expect(plan.verificationInserts[0].response_ids).toEqual(s.responses!.map((r) => r.id))
    expect(plan.action).toMatchObject({ status: 'completed', closure_outcome: 'no_change' })
    expect(plan.obligations.find((o) => o.obligation_type === 'admin_verification')?.status).toBe('fulfilled')
  })

  it('확인 불가·거절·연락 불가·외부 인계는 남은 문제와 다음 책임이 있어야 한다', () => {
    for (const outcome of ['unable_to_confirm', 'refused', 'unreachable', 'external_handoff']) {
      expectError(() => apply(answered(), verify({ outcome })), 400, /남은 문제와 다음 책임/)
      const ok = apply(answered(), verify({ outcome, remaining: '식사 거부 지속', nextResponsibility: '사회복지사가 보호자 통화' }))
      expect(ok.action.closure_outcome).toBe(outcome)
    }
  })

  it('응답이 없어도 결과 확인은 가능하고 게시 중인 요청은 함께 내려간다(미응답 실패로 기록하지 않음)', () => {
    const s = apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' })
    const done = apply(s, verify({ outcome: 'unable_to_confirm', remaining: '방문 없었음', nextResponsibility: '다음 주 재요청' }))
    expect(done.requests![0].status).toBe('closed')
    expect(done.obligations.find((o) => o.obligation_type === 'field_response')?.status).toBe('cancelled')
  })

  it('추가 확인은 새 후속 주기를 열고, 재개방도 과거 기한·완료 기록을 지우지 않는다', () => {
    const s = answered()
    const follow = apply(s, verify({ closeAction: false, followUp: { responseDue: { kind: 'next_actual_visit' }, verificationDue: { kind: 'unset' }, fieldMessageDraft: '저녁 식사량도 확인해 주세요' } }))
    expect(follow.action).toMatchObject({ status: 'open', current_cycle: 2, field_message_draft: '저녁 식사량도 확인해 주세요', field_message_status: 'unpublished' })
    expect(follow.obligations.filter((o) => o.cycle_no === 1).map((o) => o.status).sort()).toEqual(['fulfilled', 'fulfilled'])
    expect(follow.obligations.find((o) => o.cycle_no === 2 && o.obligation_type === 'field_response')?.status).toBe('pending_publish')
    const again = apply(follow, { op: 'publish', targetMode: 'recipient_assignees' })
    expect(again.requests!.map((r) => [r.cycle_no, r.status])).toEqual([
      [1, 'answered'],
      [2, 'published'],
    ])
    const closed = apply(again, verify({}))
    const reopened = apply(closed, { op: 'reopen', reason: '다시 식사량 감소', responseDue: { kind: 'next_actual_visit' } })
    expect(reopened.action).toMatchObject({ status: 'open', current_cycle: 3 })
    expect(reopened.obligations.filter((o) => o.cycle_no < 3).length).toBe(closed.obligations.length)
    expect(reopened.obligations.find((o) => o.cycle_no === 3 && o.obligation_type === 'field_response')?.status).toBe('pending_publish')
  })
})

describe('응답 대기 상태 · 근거 문장', () => {
  it('다음 방문이 있었는지 모르면 방문 대기, 게시 뒤 보고가 있었으면 따로 표시, 기한이 지나면 기한 지남', () => {
    const s = apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' })
    const req = s.requests![0]
    const ob = s.obligations.find((o) => o.id === req.obligation_id)!
    expect(requestWaitState(req, ob, [], NOW)?.state).toBe('awaiting_visit')
    expect(requestWaitState(req, ob, [report({ submitted_at: '2026-09-15T02:00:00.000Z' })], NOW)?.state).toBe('awaiting_visit') // 게시 전 보고는 세지 않는다
    expect(requestWaitState(req, ob, [report()], NOW)).toMatchObject({ state: 'reports_without_answer', reportsSincePublish: 1 })
    const dated = { ...ob, current_due_kind: 'datetime' as const, current_due_at: '2026-09-15T02:30:00.000Z' }
    expect(requestWaitState(req, dated, [], NOW)?.state).toBe('overdue')
  })

  it('이번 보고 원문에서 요청과 같은 돌봄 영역을 말한 문장을 찾는다(없으면 null)', () => {
    const msg = '다음 방문 때 식사량을 확인해 주세요'
    expect(findResponseEvidence(msg, ['오늘은 기분이 좋아 보이셨어요. 점심 식사는 반 정도 드셨어요.'])).toBe('점심 식사는 반 정도 드셨어요.')
    expect(findResponseEvidence(msg, ['산책을 함께 했어요.'])).toBeNull()
  })

  it('근거 문장이 저장된 보고 원문에 없으면 원문 근거로 저장하지 않고 입력한 답으로 옮긴다', () => {
    const texts = reportEvidenceTexts({ raw_input: '점심 식사는 반 정도 드셨어요.', followup_answers: [{ answer: '물은 잘 드셨어요' }] })
    const [kept, moved] = sanitizeEvidence(
      [
        { text: null, evidenceExcerpt: '점심 식사는 반 정도 드셨어요.' },
        { text: '추가', evidenceExcerpt: '저녁은 거르셨어요' },
      ],
      texts,
    )
    expect(kept.evidenceExcerpt).toBe('점심 식사는 반 정도 드셨어요.')
    expect(moved).toEqual({ text: '추가 / 저녁은 거르셨어요', evidenceExcerpt: null })
  })
})

describe('업무 보드(3단계 카드)', () => {
  it('게시 요청·응답 도착·재배정 필요를 서버 전체 기준으로 세고, 응답 도착은 결과 확인 대기로 통합 목록에 오른다', () => {
    const waiting = apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' })
    const arrived = respond(apply(fieldState(), { op: 'publish', targetMode: 'recipient_assignees' }), report(), 'C01').next
    const lost = apply(fieldState(['C01']), { op: 'publish', targetMode: 'specific_caregiver', targetCaregiverCode: 'C01' })
    const states = [waiting, arrived, lost]
    const board = buildWorkBoard({
      reports: [],
      safetyReviews: [],
      actions: states.map((s) => s.action),
      obligations: states.flatMap((s) => s.obligations),
      reportEvents: [],
      workflowReady: true,
      fieldRequestsReady: true,
      requests: states.flatMap((s) => s.requests!),
      responses: states.flatMap((s) => s.responses ?? []),
      assigneesByRecipient: { A01: ['C02'] },
      now: new Date(NOW),
    })
    expect(board.cards.requests).toMatchObject({ ready: true, requests: 2, awaitingVisit: 2 })
    expect(board.cards.verification).toEqual({ ready: true, actions: 1 })
    expect(board.cards.reassign.requests).toBe(1) // C01 지정인데 지금 담당은 C02
    expect(board.combined.find((c) => c.actionId === arrived.action.id)?.category).toBe('verification_pending')
    expect(board.combined.find((c) => c.actionId === lost.action.id)?.category).toBe('reassign')
  })

  it('3단계 저장소가 없으면 카드는 준비 중(가짜 0 아님)', () => {
    const board = buildWorkBoard({ reports: [], safetyReviews: [], actions: [], obligations: [], reportEvents: [], workflowReady: true, fieldRequestsReady: false, now: new Date(NOW) })
    expect(board.cards.requests.ready).toBe(false)
    expect(board.cards.verification.ready).toBe(false)
    expect(board.fieldRequestsReady).toBe(false)
  })
})
