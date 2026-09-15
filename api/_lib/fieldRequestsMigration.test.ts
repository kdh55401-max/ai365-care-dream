/** db/migrations/2026-09-16-field-requests.sql(3단계)을 2단계 위에 실제 Postgres 엔진(PGlite)으로
 * 실행해, 관리자 요청 → 현장 응답 → 관리자 결과 확인 → 종결이 DB id로 이어지는지와 권한·중복·늦은
 * 응답·동시 수정을 검증한다. 운영 Supabase(PostgREST 계층)는 이 테스트 범위 밖이다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  planActionMutation,
  planCreateAction,
  planDecision,
  type ActionMutationInput,
  type ActionObligation,
  type CareAction,
  type FieldRequest,
  type FieldResponse,
  type WorkflowContext,
} from '../../shared/workflow.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const strip = (sql: string) => sql.replace(/create extension[^;]*;/gi, '')
const read = (p: string) => strip(readFileSync(`${root}${p}`, 'utf8'))

let db: PGlite
let seq = 0
const ctx = (): WorkflowContext => ({ now: new Date(Date.now() + ++seq).toISOString(), organizationId: 'gadream365', newId: () => crypto.randomUUID() })

async function call(fn: string, payload: unknown): Promise<Record<string, unknown>> {
  return (await db.query<{ r: Record<string, unknown> }>(`select ${fn}($1::jsonb) as r`, [JSON.stringify(payload)])).rows[0].r
}
async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]
}
const iso = <T extends object>(row: T): T => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) as T

async function report(caregiver: string, recipient: string, text: string): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into reports (participant_code, recipient_code, report_type, report_date, status, submitted_at, raw_input)
     values ($1, $2, 'additional', '2026-09-16', 'submitted', now(), $3) returning id`,
    [caregiver, recipient, text],
  )
  return r.id
}

async function state(actionId: string, assignees: string[]) {
  const action = iso(await one<CareAction>('select * from care_actions where id = $1', [actionId]))
  const obligations = (await db.query<ActionObligation>('select * from action_obligations where action_id = $1', [actionId])).rows.map(iso)
  const requests = (await db.query<FieldRequest>('select * from field_requests where action_id = $1', [actionId])).rows.map(iso)
  const responses = (await db.query<FieldResponse>('select * from field_responses where action_id = $1', [actionId])).rows.map(iso)
  return { action, obligations, requests, responses, assignees }
}

async function mutate(actionId: string, assignees: string[], m: Record<string, unknown>) {
  const s = await state(actionId, assignees)
  const input = { actionId, expectedVersion: s.action.version, requestId: `m-${++seq}`, ...m } as ActionMutationInput
  const plan = planActionMutation(s, input, ctx())
  const r = await call('workflow_apply_action_change', {
    action_id: actionId,
    expected_version: input.expectedVersion,
    request_id: input.requestId,
    action: plan.action,
    obligation_updates: plan.obligationUpdates,
    obligation_inserts: plan.obligationInserts,
    request_inserts: plan.requestInserts,
    request_updates: plan.requestUpdates,
    verification_inserts: plan.verificationInserts,
    event: plan.event,
  })
  return { r, plan }
}

async function newFieldAction(recipient = 'A01', sourceReportId: string | null = null, decisionId: string | null = null) {
  const plan = planCreateAction(
    { recipientCode: recipient, sourceReportId, decisionId, kind: 'field_request', purpose: '식사량 재확인', fieldMessageDraft: '다음 방문 때 식사량을 다시 확인해 주세요.', internalNote: '보호자 민원 이력 있음(내부)', activate: true, responseDue: { kind: 'next_actual_visit' }, verificationDue: { kind: 'unset' }, requestId: `c-${++seq}` },
    ctx(),
  )
  expect((await call('workflow_create_action', { action: plan.action, obligations: plan.obligationInserts, event: plan.event })).status).toBe('ok')
  return plan.action.id
}

async function respond(requestId: string, reportId: string, responder: string, status = 'observed', reqId = `r-${++seq}`) {
  return call('workflow_record_field_response', {
    response_id: crypto.randomUUID(),
    event_id: crypto.randomUUID(),
    field_request_id: requestId,
    report_id: reportId,
    responder_code: responder,
    response_status: status,
    response_text: '점심 반 공기 드심',
    evidence_excerpt: '점심은 반 공기 정도 드셨어요',
    evidence_source: 'report_text',
    request_id: reqId,
  })
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(read('db/schema.sql'))
  await db.exec(read('db/migrations/2026-09-15-admin-workflow.sql'))
  await db.exec(read('db/migrations/2026-09-16-field-requests.sql'))
  await db.exec(read('db/migrations/2026-09-16-field-requests.sql')) // 다시 실행해도 안전
  await db.exec(`insert into caregiver_assignments (caregiver_code, recipient_code) values ('C01', 'A01'), ('C02', 'A02'), ('C03', 'A01')`)
}, 60_000)

describe('3단계 마이그레이션 적용 순서', () => {
  it('2단계 없이 실행하면 멈춘다', async () => {
    const bare = new PGlite()
    await bare.exec(read('db/schema.sql'))
    await expect(bare.exec(read('db/migrations/2026-09-16-field-requests.sql'))).rejects.toThrow(/2단계/)
  })
})

describe('관리자 요청 → 현장 응답 → 관리자 결과 확인 → 종결 (DB id 연결)', () => {
  it('원 보고·판단·조치·요청·응답 보고·결과 확인이 id로 이어지고, 응답 도착은 완료가 아니다', async () => {
    const original = await report('C01', 'A01', '오늘 식사를 평소보다 적게 하셨어요.')
    const decision = planDecision({ id: original, status: 'submitted' }, null, { reportId: original, decision: 'action_needed', expectedLatestDecisionId: null, requestId: `d-${++seq}` }, ctx())
    expect((await call('workflow_append_decision', decision)).status).toBe('ok')
    const actionId = await newFieldAction('A01', original, decision.id)

    // 게시 전: 현장 응답 의무는 시작되지 않는다
    const before = await state(actionId, ['C01', 'C03'])
    expect(before.obligations.find((o) => o.obligation_type === 'field_response')?.status).toBe('pending_publish')

    const { r: pub } = await mutate(actionId, ['C01', 'C03'], { op: 'publish', targetMode: 'recipient_assignees' })
    expect(pub.status).toBe('ok')
    const published = await state(actionId, ['C01', 'C03'])
    const req = published.requests[0]
    expect(req).toMatchObject({ status: 'published', message: '다음 방문 때 식사량을 다시 확인해 주세요.', first_shown_at: null })
    expect(published.obligations.find((o) => o.obligation_type === 'field_response')).toMatchObject({ status: 'active', current_due_kind: 'next_actual_visit', current_due_at: null })
    expect(published.action.field_message_status).toBe('published')
    // 내부 메모는 요청 행에 없다
    expect(JSON.stringify(req)).not.toContain('민원')

    // 다음 방문 보고로 응답
    const followReport = await report('C01', 'A01', '점심은 반 공기 정도 드셨어요.')
    const resp = await respond(req.id, followReport, 'C01')
    expect(resp).toMatchObject({ status: 'ok', fulfilled_obligation: true, request_state_at_response: 'published' })
    const answered = await state(actionId, ['C01', 'C03'])
    expect(answered.requests[0]).toMatchObject({ status: 'answered', version: 2 })
    expect(answered.obligations.find((o) => o.obligation_type === 'field_response')?.status).toBe('fulfilled')
    expect(answered.obligations.find((o) => o.obligation_type === 'admin_verification')?.status).toBe('active') // 관리자 재확인은 남는다
    expect(answered.action.status).toBe('open') // 응답 도착 ≠ 완료

    const { r: ver, plan } = await mutate(actionId, ['C01', 'C03'], { op: 'verify', outcome: 'no_change', summary: '식사량 반 공기 유지', evidence: '9/16 현장 응답(C01)', closeAction: true })
    expect(ver.status).toBe('ok')
    const done = await state(actionId, ['C01', 'C03'])
    expect(done.action).toMatchObject({ status: 'completed', closure_outcome: 'no_change' })

    const chain = await one<Record<string, unknown>>(
      `select d.id as decision_id, a.id as action_id, fr.id as request_id, r.id as response_id, r.report_id as response_report_id, v.id as verification_id, v.response_ids
       from care_actions a
       join admin_decisions d on d.id = a.decision_id
       join field_requests fr on fr.action_id = a.id
       join field_responses r on r.field_request_id = fr.id
       join action_verifications v on v.action_id = a.id
       where a.id = $1 and a.source_report_id = $2`,
      [actionId, original],
    )
    expect(chain).toMatchObject({ decision_id: decision.id, action_id: actionId, request_id: req.id, response_report_id: followReport, verification_id: plan.verificationInserts[0].id })
    expect(chain.response_ids).toEqual([chain.response_id])
    const events = (await db.query<{ event_type: string }>('select event_type from action_events where action_id = $1 order by occurred_at', [actionId])).rows.map((e) => e.event_type)
    expect(events).toEqual(['created', 'published', 'response_received', 'verified'])
  })
})

describe('권한 · 중복 · 동시 수정', () => {
  it('중복 제출은 한 건, 배정 안 된 요양보호사·지정 대상 밖·배정 해제 후 응답은 거부', async () => {
    const actionId = await newFieldAction('A01')
    await mutate(actionId, ['C01', 'C03'], { op: 'publish', targetMode: 'specific_caregiver', targetCaregiverCode: 'C01' })
    const req = (await state(actionId, [])).requests[0]

    // 지정 대상이 아닌 C03(배정은 됨)
    const r3 = await report('C03', 'A01', '식사 잘 하셨어요')
    expect((await respond(req.id, r3, 'C03')).status).toBe('forbidden')
    // A01에 배정되지 않은 C02
    const r2 = await report('C02', 'A01', '식사 잘 하셨어요')
    expect((await respond(req.id, r2, 'C02')).status).toBe('forbidden')
    // 남의 보고로 응답
    expect((await respond(req.id, r3, 'C01')).status).toBe('forbidden')

    const r1 = await report('C01', 'A01', '점심은 반 공기 정도 드셨어요')
    expect((await respond(req.id, r1, 'C01', 'observed', 'same-req')).status).toBe('ok')
    expect((await respond(req.id, r1, 'C01', 'observed', 'same-req')).status).toBe('duplicate') // 재시도
    expect((await respond(req.id, r1, 'C01', 'observed', 'other-req')).status).toBe('duplicate') // 같은 보고 재제출
    const n = await one<{ n: number }>('select count(*)::int as n from field_responses where field_request_id = $1', [req.id])
    expect(n.n).toBe(1)
  })

  it('배정이 바뀌면 이전 지정 대상은 답할 수 없다', async () => {
    const actionId = await newFieldAction('A01')
    await mutate(actionId, ['C01', 'C03'], { op: 'publish', targetMode: 'specific_caregiver', targetCaregiverCode: 'C03' })
    const req = (await state(actionId, [])).requests[0]
    await db.exec(`update caregiver_assignments set active = false where caregiver_code = 'C03' and recipient_code = 'A01'`)
    const r = await report('C03', 'A01', '식사 확인함')
    expect((await respond(req.id, r, 'C03')).status).toBe('forbidden')
    await db.exec(`update caregiver_assignments set active = true where caregiver_code = 'C03' and recipient_code = 'A01'`)
  })

  it('관리자가 불러온 뒤 현장 응답이 먼저 오면 관리자의 철회는 충돌로 되돌려진다', async () => {
    const actionId = await newFieldAction('A01')
    await mutate(actionId, ['C01'], { op: 'publish', targetMode: 'recipient_assignees' })
    const stale = await state(actionId, ['C01'])
    const r = await report('C01', 'A01', '식사 확인함')
    expect((await respond(stale.requests[0].id, r, 'C01')).status).toBe('ok')
    const input = { actionId, op: 'withdraw', fieldRequestId: stale.requests[0].id, reason: '중복 요청', expectedVersion: stale.action.version, requestId: `w-${++seq}` } as ActionMutationInput
    const plan = planActionMutation(stale, input, ctx())
    const res = await call('workflow_apply_action_change', { action_id: actionId, expected_version: input.expectedVersion, request_id: input.requestId, action: plan.action, obligation_updates: plan.obligationUpdates, obligation_inserts: [], request_inserts: [], request_updates: plan.requestUpdates, verification_inserts: [], event: plan.event })
    expect(res.status).toBe('conflict')
    expect((await state(actionId, [])).requests[0].status).toBe('answered')
  })
})

describe('철회·취소 뒤 늦은 응답 · 재개방 · 추가 확인', () => {
  it('철회·취소 뒤 늦게 온 응답은 기록만 남고 조치를 되살리지 않는다', async () => {
    const a1 = await newFieldAction('A01')
    await mutate(a1, ['C01'], { op: 'publish', targetMode: 'recipient_assignees' })
    const req1 = (await state(a1, [])).requests[0]
    expect((await mutate(a1, ['C01'], { op: 'withdraw', fieldRequestId: req1.id, reason: '보호자가 직접 확인' })).r.status).toBe('ok')
    const afterWithdraw = await state(a1, [])
    // 요청만 철회하면 현장 응답 의무는 게시 전으로 돌아간다(기한은 그대로) — 같은 주기에서 다시 게시 가능.
    const respOb = afterWithdraw.obligations.find((o) => o.obligation_type === 'field_response')!
    expect(respOb.status).toBe('pending_publish')
    const late1 = await respond(req1.id, await report('C01', 'A01', '식사 확인'), 'C01')
    expect(late1).toMatchObject({ status: 'ok', fulfilled_obligation: false, request_state_at_response: 'withdrawn' })
    const afterLate = await state(a1, [])
    expect(afterLate.action.version).toBe(afterWithdraw.action.version) // 상태 변화 없음
    expect(afterLate.obligations.find((o) => o.id === respOb.id)?.status).toBe('pending_publish')
    expect((await mutate(a1, ['C01'], { op: 'publish', targetMode: 'recipient_assignees' })).r.status).toBe('ok')
    const republished = await state(a1, [])
    expect(republished.requests.map((r) => r.status).sort()).toEqual(['published', 'withdrawn'])
    expect(republished.obligations.find((o) => o.id === respOb.id)?.status).toBe('active')

    const a2 = await newFieldAction('A01')
    await mutate(a2, ['C01'], { op: 'publish', targetMode: 'recipient_assignees' })
    const req2 = (await state(a2, [])).requests[0]
    expect((await mutate(a2, ['C01'], { op: 'cancel', reason: '입원으로 방문 중단' })).r.status).toBe('ok')
    const late2 = await respond(req2.id, await report('C01', 'A01', '식사 확인'), 'C01')
    expect(late2).toMatchObject({ status: 'ok', fulfilled_obligation: false, request_state_at_response: 'withdrawn' })
    const s2 = await state(a2, [])
    expect(s2.action.status).toBe('cancelled')
    expect(s2.requests[0].status).toBe('withdrawn')
    await expect(db.query(`update field_requests set status = 'published' where id = $1`, [req2.id])).rejects.toThrow(/다시 열 수 없습니다/)
  })

  it('확인 불가 종결은 남은 문제·다음 책임 없이는 DB가 거부하고, 추가 확인은 새 주기로 이어진다, 재개방은 과거 주기를 보존한다', async () => {
    const actionId = await newFieldAction('A01')
    await mutate(actionId, ['C01'], { op: 'publish', targetMode: 'recipient_assignees' })
    await expect(
      db.query(`insert into action_verifications (id, action_id, cycle_no, outcome, summary, evidence, closes_action, actor_scope, request_id) values ($1, $2, 1, 'unable_to_confirm', '확인 못함', '방문 없음', true, 'x', $3)`, [crypto.randomUUID(), actionId, `v-${++seq}`]),
    ).rejects.toThrow()

    // 응답 없이 '추가 확인'(새 주기) — 게시 중이던 요청은 결과 확인과 함께 게시 종료
    const { r } = await mutate(actionId, ['C01'], {
      op: 'verify', outcome: 'unable_to_confirm', summary: '이번 주 방문 없음', evidence: '담당자 통화', remaining: '식사량 미확인', nextResponsibility: '다음 방문 담당 C01', closeAction: false,
      followUp: { responseDue: { kind: 'next_actual_visit' }, verificationDue: { kind: 'unset' }, fieldMessageDraft: '이번 방문 때 식사량을 꼭 확인해 주세요.' },
    })
    expect(r.status).toBe('ok')
    const s = await state(actionId, ['C01'])
    expect(s.action).toMatchObject({ status: 'open', current_cycle: 2, field_message_status: 'unpublished' })
    expect(s.requests[0]).toMatchObject({ status: 'closed', cycle_no: 1 })
    expect(s.obligations.filter((o) => o.cycle_no === 1).map((o) => o.status).sort()).toEqual(['cancelled', 'fulfilled'])
    expect(s.obligations.filter((o) => o.cycle_no === 2).map((o) => o.status).sort()).toEqual(['active', 'pending_publish'])

    // 새 주기에 다시 게시 → 응답 → 종결 → 재개방(3주기)
    expect((await mutate(actionId, ['C01'], { op: 'publish', targetMode: 'recipient_assignees' })).r.status).toBe('ok')
    const req2 = (await state(actionId, [])).requests.find((x) => x.cycle_no === 2)!
    await respond(req2.id, await report('C01', 'A01', '식사 반 공기'), 'C01')
    await mutate(actionId, ['C01'], { op: 'verify', outcome: 'no_change', summary: '반 공기 유지', evidence: '2주기 응답', closeAction: true })
    expect((await mutate(actionId, ['C01'], { op: 'reopen', reason: '보호자가 체중 감소 문의', responseDue: { kind: 'next_actual_visit' }, verificationDue: { kind: 'unset' } })).r.status).toBe('ok')
    const reopened = await state(actionId, ['C01'])
    expect(reopened.action).toMatchObject({ status: 'open', current_cycle: 3 })
    const verifications = await one<{ n: number }>('select count(*)::int as n from action_verifications where action_id = $1', [actionId])
    expect(verifications.n).toBe(2) // 과거 결과 확인 보존
    expect(reopened.obligations.filter((o) => o.cycle_no === 3 && o.obligation_type === 'field_response')[0].status).toBe('pending_publish')
  })

  it('요청 문구와 첫 표시 시각은 바뀌지 않고, 응답·결과 확인은 수정·삭제할 수 없다', async () => {
    const actionId = await newFieldAction('A01')
    await mutate(actionId, ['C01'], { op: 'publish', targetMode: 'recipient_assignees' })
    const req = (await state(actionId, [])).requests[0]
    await db.query(`update field_requests set first_shown_at = now(), first_shown_to = 'C01' where id = $1 and first_shown_at is null`, [req.id])
    await expect(db.query(`update field_requests set message = '바꿈' where id = $1`, [req.id])).rejects.toThrow(/바꿀 수 없습니다/)
    await expect(db.query(`update field_requests set first_shown_at = now() + interval '1 day' where id = $1`, [req.id])).rejects.toThrow(/바꿀 수 없습니다/)
    await respond(req.id, await report('C01', 'A01', '식사 확인'), 'C01')
    await expect(db.exec(`update field_responses set response_text = 'x'`)).rejects.toThrow(/이력 테이블/)
    await expect(db.exec(`delete from action_verifications`)).rejects.toThrow(/이력 테이블/)
  })
})
