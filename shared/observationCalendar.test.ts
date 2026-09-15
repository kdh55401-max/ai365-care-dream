import { describe, expect, it } from 'vitest'
import type { CareReportRecord, DomainEntry } from './careTypes.js'
import { buildObservationCalendar, shiftDate } from './observationCalendar.js'
import { compareScaleValues, computeRepeatCandidates, planCandidateReview, repeatHeadline, reviewStateOf, REPEAT_RULE } from './changeCandidates.js'
import { buildRecipientObservations } from './observationViews.js'
import { buildWorkBoard } from './workBoard.js'
import { planCreateAction, WorkflowError, type WorkflowContext } from './workflow.js'
import type { BaselineEntry } from './baseline.js'

const TODAY = '2026-09-17'
let n = 0
const ctx = (): WorkflowContext => ({ now: '2026-09-17T03:00:00.000Z', organizationId: 'gadream365', newId: () => `id-${++n}` })

function report(date: string, entries: Partial<Record<'observed' | 'changed' | 'unobserved' | 'uncertain', DomainEntry[]>> = {}, o: Partial<CareReportRecord> = {}): CareReportRecord {
  return {
    id: `r-${++n}`,
    participant_code: 'C01',
    recipient_code: 'A01',
    report_type: 'additional',
    report_date: date,
    status: 'submitted',
    submitted_at: `${date}T02:00:00.000Z`,
    created_at: `${date}T01:59:00.000Z`,
    started_at: `${date}T01:59:00.000Z`,
    updated_at: `${date}T02:00:00.000Z`,
    raw_input: `${date} 원문`,
    review_status: 'pending',
    report_source: 'live',
    deleted: false,
    emergency_flagged: false,
    initial_status_choice: null,
    observed_domains_json: entries.observed ?? [],
    changed_domains_json: entries.changed ?? [],
    unobserved_domains_json: entries.unobserved ?? [],
    uncertain_domains_json: entries.uncertain ?? [],
    ...o,
  } as CareReportRecord
}
const ch = (domain: DomainEntry['domain']): DomainEntry => ({ domain, status: 'changed' })

function expectError(fn: () => unknown, status: number) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(WorkflowError)
    expect((e as WorkflowError).status).toBe(status)
    return
  }
  throw new Error('오류가 나야 합니다')
}

describe('관찰 달력', () => {
  it('보고 없음·항목 저장 없음·미언급·상태를 구분하고, 같은 날 상충 기록은 모두 펼친다', () => {
    const cal = buildObservationCalendar(
      [
        report(shiftDate(TODAY, -1), { changed: [ch('meal')] }),
        report(shiftDate(TODAY, -1), { observed: [{ domain: 'meal', status: 'same_as_usual' }] }), // 같은 날 상충
        report(shiftDate(TODAY, -2)), // 항목 저장 없음
        report(shiftDate(TODAY, -3), { unobserved: [{ domain: 'hydration', status: 'not_observed' }], uncertain: [{ domain: 'sleep', status: 'uncertain' }] }),
      ],
      7,
      TODAY,
    )
    expect(cal.basis).toBe('report_date')
    expect(cal.start).toBe(shiftDate(TODAY, -6))
    const row = (d: string) => cal.groups.flatMap((g) => g.rows).find((r) => r.domain === d)!
    const cell = (d: string, date: string) => row(d).cells.find((c) => c.date === date)!
    expect(cell('meal', TODAY).state).toBe('no_report')
    expect(cell('meal', shiftDate(TODAY, -1))).toMatchObject({ state: 'mixed' })
    expect(cell('meal', shiftDate(TODAY, -1)).entries.map((e) => e.status).sort()).toEqual(['changed', 'same_as_usual'])
    expect(cell('meal', shiftDate(TODAY, -2)).state).toBe('not_stored')
    expect(cell('hydration', shiftDate(TODAY, -3)).state).toBe('not_observed')
    expect(cell('sleep', shiftDate(TODAY, -3)).state).toBe('uncertain')
    expect(cell('meal', shiftDate(TODAY, -3)).state).toBe('not_mentioned') // 그날 항목을 저장한 보고는 있지만 식사는 없음
    expect(cal.counts).toMatchObject({ reports: 4, reportsWithItems: 3, reportsWithoutItems: 1, daysWithReports: 3 })
  })

  it('세부 키를 유지하고 과거 복합 키는 추정 분해하지 않고 기록이 있을 때만 따로 보인다', () => {
    const plain = buildObservationCalendar([report(TODAY, { changed: [ch('hydration')] })], 7, TODAY)
    const keys = plain.groups.flatMap((g) => g.rows.map((r) => r.domain))
    expect(keys).toContain('meal')
    expect(keys).toContain('hydration')
    expect(keys).toContain('fall')
    expect(keys).not.toContain('meal_hydration')
    const legacy = buildObservationCalendar([report(TODAY, { changed: [ch('meal_hydration')] })], 7, TODAY)
    const rows = legacy.groups.flatMap((g) => g.rows)
    expect(rows.find((r) => r.domain === 'meal_hydration')).toMatchObject({ legacy: true })
    expect(rows.find((r) => r.domain === 'meal')?.cells.find((c) => c.date === TODAY)?.state).toBe('not_mentioned') // 분해하지 않음
  })

  it('30일 창과 연습·삭제·미제출 보고 제외', () => {
    const cal = buildObservationCalendar([report(shiftDate(TODAY, -29), { changed: [ch('meal')] }), report(TODAY, {}, { report_source: 'scenario' }), report(TODAY, {}, { deleted: true }), report(TODAY, {}, { status: 'draft' })], 30, TODAY)
    expect(cal.days).toHaveLength(30)
    expect(cal.counts.reports).toBe(1)
  })
})

describe('반복 보고 후보(초기 운영 규칙 v1)', () => {
  it('같은 날 변화 3건은 하루 — 서로 다른 날 2일부터 후보, 표시는 "식사 변화가 2일 보고됨"', () => {
    const sameDay = [report(TODAY, { changed: [ch('meal')] }), report(TODAY, { changed: [ch('meal')] }), report(TODAY, { changed: [ch('meal')] })]
    expect(computeRepeatCandidates(sameDay, TODAY).candidates).toHaveLength(0)
    const r = computeRepeatCandidates([...sameDay, report(shiftDate(TODAY, -3), { changed: [ch('meal')] })], TODAY)
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0]).toMatchObject({ headline: '식사 변화가 2일 보고됨', basis: 'report_date', ruleId: 'repeat_changed', ruleVersion: 1, days: [shiftDate(TODAY, -3), TODAY] })
    expect(r.candidates[0].signals).toHaveLength(4)
    expect(r.signalsInWindow).toBe(4)
    expect(r.observationDateBasis).toEqual({ available: false, excludedSignals: 4 })
    expect(repeatHeadline('hydration', 3)).toBe('수분 변화가 3일 보고됨')
  })

  it('세부 영역·수급자를 섞지 않고, 창(7일) 밖·반려된 보고는 세지 않는다', () => {
    const r = computeRepeatCandidates(
      [
        report(TODAY, { changed: [ch('meal')] }),
        report(shiftDate(TODAY, -1), { changed: [ch('hydration')] }), // 다른 세부 영역
        report(shiftDate(TODAY, -2), { changed: [ch('meal')] }, { recipient_code: 'A02' }), // 다른 수급자
        report(shiftDate(TODAY, -REPEAT_RULE.windowDays), { changed: [ch('meal')] }), // 창 밖(8일 전)
        report(shiftDate(TODAY, -4), { changed: [ch('meal')] }, { review_status: 'rejected' }), // 반려
      ],
      TODAY,
    )
    expect(r.candidates).toHaveLength(0)
    expect(r.excludedRejected).toBe(1)
    expect(r.changedRecipients).toBe(2)
  })

  it('후보 열쇠는 에피소드 시작일로 고정돼 날이 지나도 같은 후보로 남는다', () => {
    const reports = [report('2026-09-10', { changed: [ch('meal')] }), report('2026-09-13', { changed: [ch('meal')] }), report('2026-09-16', { changed: [ch('meal')] })]
    const a = computeRepeatCandidates(reports, '2026-09-14').candidates[0]
    const b = computeRepeatCandidates(reports, '2026-09-18').candidates[0]
    expect(a.key).toBe(b.key)
    expect(a.episodeStart).toBe('2026-09-10')
    expect(b.days).toEqual(['2026-09-13', '2026-09-16'])
    // 7일 이상 끊겼다가 다시 반복되면 새 에피소드
    const later = computeRepeatCandidates([...reports, report('2026-09-26', { changed: [ch('meal')] }), report('2026-09-27', { changed: [ch('meal')] })], '2026-09-27').candidates[0]
    expect(later.episodeStart).toBe('2026-09-26')
    expect(later.key).not.toBe(a.key)
  })

  it('판단은 후보와 분리돼 쌓이고, 새 근거·반려는 판단을 바꾸지 않고 알린다', () => {
    const base = [report(shiftDate(TODAY, -2), { changed: [ch('meal')] }), report(shiftDate(TODAY, -1), { changed: [ch('meal')] })]
    const c1 = computeRepeatCandidates(base, TODAY).candidates[0]
    const action = planCreateAction({ recipientCode: 'A01', kind: 'field_request', purpose: '식사량 재확인', fieldMessageDraft: '식사량 확인', activate: true, requestId: `c-${++n}` }, ctx()).action
    expectError(() => planCandidateReview(c1, { candidateKey: c1.key, decision: 'needs_check', reason: ' ', requestId: 'x' }, null, ctx()), 400)
    const other = planCreateAction({ recipientCode: 'A02', kind: 'admin_direct', purpose: 'x', actionContent: 'y', activate: true, requestId: `c-${++n}` }, ctx()).action
    expectError(() => planCandidateReview(c1, { candidateKey: c1.key, decision: 'needs_check', reason: '확인', linkedActionId: other.id, requestId: 'y' }, other, ctx()), 400)
    const review = planCandidateReview(c1, { candidateKey: c1.key, decision: 'needs_check', reason: '두 번 적게 드심 — 기존 식사 확인 요청에 연결', linkedActionId: action.id, requestId: 'rv-1' }, action, ctx())
    expect(review).toMatchObject({ candidate_key: c1.key, rule_id: 'repeat_changed', rule_version: 1, basis: 'report_date', linked_action_id: action.id, actor_scope: 'org_admin_shared' })
    expect(review.evidence.reportIds).toHaveLength(2)
    // 새 보고가 오면 같은 후보 + "판단 뒤 새 근거 1건"
    const more = [...base, report(TODAY, { changed: [ch('meal')] })]
    const c2 = computeRepeatCandidates(more, TODAY).candidates[0]
    expect(c2.key).toBe(c1.key)
    expect(reviewStateOf(c2.key, c2, [review], more).newEvidenceSinceReview).toBe(1)
    // 근거 보고가 반려되면 재검토 필요(판단 이력은 그대로)
    const rejected = more.map((r) => (r.id === base[0].id ? { ...r, review_status: 'rejected' as const } : r))
    const st = reviewStateOf(c1.key, computeRepeatCandidates(rejected, TODAY).candidates[0] ?? null, [review], rejected)
    expect(st.latest?.id).toBe(review.id)
    expect(st.recheckReasons).toContain('판단 당시 근거 보고가 반려됨')
  })
})

describe('비교 가능한 값 차이', () => {
  const entry = (o: Partial<BaselineEntry>): BaselineEntry =>
    ({
      id: `e-${++n}`,
      organization_id: 'gadream365',
      recipient_code: 'A01',
      lineage_id: `l-${n}`,
      version: 1,
      supersedes_entry_id: null,
      kind: 'scale_result',
      domain: 'cognition_communication',
      statement: null,
      value_text: null,
      value_numeric: 24,
      unit: '점',
      tool_name: 'MMSE-K',
      tool_version: '1989',
      reference_date: '2026-03-01',
      valid_until: null,
      source_type: 'document',
      document_id: 'd-1',
      page_ref: null,
      excerpt: null,
      source_note: null,
      status: 'confirmed',
      created_at: '2026-09-01T00:00:00.000Z',
      created_by_scope: 'org_admin_shared',
      entered_by_label: null,
      confirmed_at: '2026-09-01T00:00:00.000Z',
      confirmed_by_label: null,
      retracted_at: null,
      retract_reason: null,
      superseded_at: null,
      status_request_id: null,
      row_version: 2,
      request_id: `q-${n}`,
      ...o,
    }) as BaselineEntry

  it('같은 도구·버전·단위·다른 측정일·다른 값만 비교 — 같은 값·다른 버전·계획·초안·같은 날 상충은 비교하지 않는다', () => {
    const a = entry({})
    const b = entry({ value_numeric: 21, reference_date: '2026-08-20' })
    const same = entry({ value_numeric: 21, reference_date: '2026-09-01' })
    const otherVersion = entry({ tool_version: '2020', value_numeric: 18, reference_date: '2026-09-05' })
    const plan = entry({ kind: 'plan_goal', value_numeric: 26, reference_date: '2026-09-10' })
    const draft = entry({ status: 'draft', confirmed_at: null, value_numeric: 10, reference_date: '2026-09-11' })
    const clash1 = entry({ tool_name: 'Braden', unit: '점', value_numeric: 15, reference_date: '2026-07-01' })
    const clash2 = entry({ tool_name: 'Braden', unit: '점', value_numeric: 18, reference_date: '2026-07-01' })
    const obs = entry({ kind: 'observation_assessment', tool_name: null, tool_version: null, value_numeric: 60, unit: '%' })
    const r = compareScaleValues([a, b, same, otherVersion, plan, draft, clash1, clash2, obs])
    expect(r.comparisons).toHaveLength(1)
    expect(r.comparisons[0]).toMatchObject({ earlier: { id: a.id }, later: { id: b.id }, difference: -3, headline: 'MMSE-K 1989: 24점 (2026-03-01) → 21점 (2026-08-20)' })
    const reasons = r.excluded.map((x) => x.reason).join('|')
    expect(reasons).toMatch(/계획·목표/)
    expect(reasons).toMatch(/초안·철회·이전 버전/)
    expect(reasons).toMatch(/같은 측정일에 값이 상충/)
    expect(reasons).toMatch(/측정 맥락이 기록되지 않아/)
  })
})

describe('화면 한 벌과 업무 보드', () => {
  it('열린 조치를 함께 보이고, 보드 카드는 후보 수·수급자 수·신호 수를 구분한다', () => {
    const reports = [report(shiftDate(TODAY, -2), { changed: [ch('meal')] }), report(shiftDate(TODAY, -1), { changed: [ch('meal'), ch('sleep')] })]
    const action = planCreateAction({ recipientCode: 'A01', kind: 'field_request', purpose: '식사량 재확인', fieldMessageDraft: 'x', activate: true, requestId: `c-${++n}` }, ctx()).action
    const view = buildRecipientObservations({ recipientCode: 'A01', reports, window: 7, today: TODAY, now: new Date(), reviews: [], reviewsReady: false, baselineEntries: null, actions: [action] })
    expect(view.repeat.items.map((x) => x.candidate.headline)).toEqual(['식사 변화가 2일 보고됨'])
    expect(view.openActions.map((a) => a.purpose)).toEqual(['식사량 재확인'])
    expect(view.values).toBeNull()
    const board = buildWorkBoard({ reports, safetyReviews: [], actions: [], obligations: [], reportEvents: [], workflowReady: true, now: new Date(`${TODAY}T03:00:00.000Z`) })
    expect(board.cards.repeat).toMatchObject({ candidates: 1, recipients: 1, unreviewed: 1, signals: 3, changedRecipients: 1 })
  })
})
