/** db/migrations/2026-09-15-admin-workflow.sql 을 실제 Postgres 엔진(PGlite, WASM)에서 실행해
 * 검증한다. 운영 Supabase에 접근할 수 없는 환경이라, 테이블·트리거·원자적 함수의 동작을
 * 여기서 확인한다(Supabase의 PostgREST·권한 계층은 이 테스트 범위 밖). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { planActionMutation, planCreateAction, planDecision, planSafetyReview, type ActionObligation, type CareAction } from '../../shared/workflow.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const stripExtensions = (sql: string) => sql.replace(/create extension[^;]*;/gi, '')
const schemaSql = stripExtensions(readFileSync(`${root}db/schema.sql`, 'utf8'))
const migrationSql = stripExtensions(readFileSync(`${root}db/migrations/2026-09-15-admin-workflow.sql`, 'utf8'))

let db: PGlite
let seq = 0
const ctx = () => ({ now: new Date(Date.now() + ++seq).toISOString(), organizationId: 'gadream365', newId: () => crypto.randomUUID() })

async function call(fn: string, payload: unknown): Promise<Record<string, unknown>> {
  const res = await db.query<{ r: Record<string, unknown> }>(`select ${fn}($1::jsonb) as r`, [JSON.stringify(payload)])
  return res.rows[0].r
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]
}

async function newReport(opts: { status?: 'draft' | 'submitted'; emergency?: boolean; recipient?: string } = {}): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into reports (participant_code, recipient_code, report_type, report_date, status, submitted_at, raw_input, emergency_flagged)
     values ('C01', $1, 'daily', '2026-09-15', $2, $3, '원문', $4) returning id`,
    [opts.recipient ?? 'A01', opts.status ?? 'draft', opts.status === 'submitted' ? new Date().toISOString() : null, opts.emergency ?? false],
  )
  return r.id
}

async function loadAction(id: string): Promise<{ action: CareAction; obligations: ActionObligation[] }> {
  const action = await one<CareAction>('select * from care_actions where id = $1', [id])
  const obligations = (await db.query<ActionObligation>('select * from action_obligations where action_id = $1', [id])).rows
  // PGlite는 timestamptz를 Date로 준다 — 앱이 받는 ISO 문자열 형태로 맞춘다.
  const iso = <T extends object>(row: T): T =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) as T
  return { action: iso(action), obligations: obligations.map(iso) }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(schemaSql)
  // 마이그레이션 전에 이미 제출·승인된 보고 — 이벤트를 소급 생성하지 않아야 한다.
  await db.exec(`insert into reports (id, participant_code, recipient_code, report_type, report_date, status, submitted_at, review_status, reviewed_at)
                 values ('00000000-0000-0000-0000-000000000001', 'C01', 'A01', 'daily', '2026-09-10', 'submitted', now(), 'approved', now())`)
  await db.exec(migrationSql)
  await db.exec(migrationSql) // 두 번 실행해도 안전해야 한다
}, 60_000)

describe('보고 이벤트 트리거', () => {
  it('이전 보고는 소급하지 않고, 제출은 한 번만·검토는 할 때마다 남긴다', async () => {
    const legacy = await one<{ n: number }>(`select count(*)::int as n from report_events where report_id = '00000000-0000-0000-0000-000000000001'`)
    expect(legacy.n).toBe(0)

    const id = await newReport()
    await db.query(`update reports set status = 'submitted', submitted_at = now() where id = $1`, [id])
    await db.query(`update reports set raw_input = '수정' where id = $1`, [id])
    await db.query(`update reports set review_status = 'approved', reviewed_at = now(), last_review_request_id = 'rv-1' where id = $1`, [id])
    await db.query(`update reports set review_note_visible_to_caregiver = true where id = $1`, [id]) // 공개 여부만 바꾸는 후속 갱신
    await db.query(`update reports set review_status = 'rejected', review_note = '재작성', reviewed_at = now() + interval '1 minute', last_review_request_id = 'rv-2' where id = $1`, [id])
    const rows = (await db.query<{ event_type: string; actor_scope: string; actor_ref: string | null; request_id: string | null }>(
      `select event_type, actor_scope, actor_ref, request_id from report_events where report_id = $1 order by occurred_at`, [id],
    )).rows
    expect(rows).toEqual([
      { event_type: 'submitted', actor_scope: 'caregiver_session', actor_ref: 'C01', request_id: null },
      { event_type: 'review_approved', actor_scope: 'org_admin_shared', actor_ref: null, request_id: 'rv-1' },
      { event_type: 'review_rejected', actor_scope: 'org_admin_shared', actor_ref: null, request_id: 'rv-2' },
    ])
  })

  it('이벤트는 수정·삭제할 수 없다', async () => {
    await expect(db.exec(`update report_events set actor_scope = 'x'`)).rejects.toThrow(/이력 테이블/)
    await expect(db.exec(`delete from report_events`)).rejects.toThrow(/이력 테이블/)
  })
})

describe('관리자 판단', () => {
  it('저장·재전송 중복·동시 수정 충돌·미제출 거부', async () => {
    const reportId = await newReport({ status: 'submitted' })
    const first = planDecision({ id: reportId, status: 'submitted' }, null, { reportId, decision: 'no_action_needed', expectedLatestDecisionId: null, requestId: 'd-1' }, ctx())
    expect((await call('workflow_append_decision', first)).status).toBe('ok')
    expect((await call('workflow_append_decision', first)).status).toBe('duplicate')

    // 다른 화면이 아직 첫 판단을 모르는 채로 저장 → 충돌
    const stale = planDecision({ id: reportId, status: 'submitted' }, null, { reportId, decision: 'action_needed', expectedLatestDecisionId: null, requestId: 'd-2' }, ctx())
    expect((await call('workflow_append_decision', stale)).status).toBe('conflict')

    const next = planDecision({ id: reportId, status: 'submitted' }, first, { reportId, decision: 'action_needed', reason: '식사량 재확인', expectedLatestDecisionId: first.id, requestId: 'd-3' }, ctx())
    expect((await call('workflow_append_decision', next)).status).toBe('ok')
    const history = await one<{ n: number }>('select count(*)::int as n from admin_decisions where report_id = $1', [reportId])
    expect(history.n).toBe(2) // 이전 판단은 지워지지 않는다

    const draftId = await newReport()
    const onDraft = { ...next, id: crypto.randomUUID(), report_id: draftId, request_id: 'd-4', previous_decision_id: null }
    expect((await call('workflow_append_decision', onDraft)).status).toBe('invalid')
  })
})

describe('조치와 의무', () => {
  it('생성은 한 트랜잭션, 같은 요청 재전송은 한 건만 만든다', async () => {
    const reportId = await newReport({ status: 'submitted' })
    const plan = planCreateAction(
      { recipientCode: 'A01', sourceReportId: reportId, kind: 'field_request', purpose: '식사량 재확인', fieldMessageDraft: '다음 방문 때 식사량을 확인해 주세요.', activate: true, responseDue: { kind: 'next_actual_visit' }, verificationDue: { kind: 'datetime', at: '2026-09-20T09:00:00.000Z' }, requestId: 'a-1' },
      ctx(),
    )
    expect((await call('workflow_create_action', { action: plan.action, obligations: plan.obligationInserts, event: plan.event })).status).toBe('ok')
    expect((await call('workflow_create_action', { action: { ...plan.action, id: crypto.randomUUID() }, obligations: [], event: plan.event })).status).toBe('duplicate')
    const { action, obligations } = await loadAction(plan.action.id)
    expect(action.status).toBe('open')
    expect(obligations.find((o) => o.obligation_type === 'field_response')).toMatchObject({ status: 'pending_publish', current_due_kind: 'next_actual_visit', current_due_at: null })
    expect(obligations.find((o) => o.obligation_type === 'admin_verification')).toMatchObject({ status: 'active', current_due_kind: 'datetime' })
  })

  it('다른 수급자의 보고를 근거로 붙일 수 없다', async () => {
    const reportId = await newReport({ status: 'submitted', recipient: 'A02' })
    const plan = planCreateAction({ recipientCode: 'A01', sourceReportId: reportId, kind: 'admin_direct', purpose: '보호자 안내', activate: false, requestId: 'a-x' }, ctx())
    expect((await call('workflow_create_action', { action: plan.action, obligations: plan.obligationInserts, event: plan.event })).status).toBe('invalid')
  })

  it('기한 변경은 최초 기한을 보존하고, 버전 충돌·재전송을 막고, 실패하면 전부 되돌린다', async () => {
    const plan = planCreateAction(
      { recipientCode: 'A01', kind: 'admin_direct', purpose: '보호자 연락', activate: true, executionDue: { kind: 'datetime', at: '2026-09-16T01:00:00.000Z' }, verificationDue: { kind: 'unset' }, requestId: 'a-2' },
      ctx(),
    )
    await call('workflow_create_action', { action: plan.action, obligations: plan.obligationInserts, event: plan.event })
    const state = await loadAction(plan.action.id)
    const exec = state.obligations.find((o) => o.obligation_type === 'admin_execution')!
    const change = planActionMutation(state, { actionId: plan.action.id, op: 'change_due', obligationId: exec.id, due: { kind: 'datetime', at: '2026-09-18T01:00:00.000Z' }, reason: '보호자 부재', expectedVersion: 1, requestId: 'm-1' }, ctx())
    const payload = { action_id: plan.action.id, expected_version: 1, request_id: 'm-1', action: change.action, obligation_updates: change.obligationUpdates, obligation_inserts: change.obligationInserts, event: change.event }
    expect((await call('workflow_apply_action_change', payload)).status).toBe('ok')
    expect((await call('workflow_apply_action_change', payload)).status).toBe('duplicate')
    expect((await call('workflow_apply_action_change', { ...payload, request_id: 'm-2', event: { ...change.event, id: crypto.randomUUID(), request_id: 'm-2' } })).status).toBe('conflict')

    const after = await loadAction(plan.action.id)
    expect(after.action.version).toBe(2)
    const changed = after.obligations.find((o) => o.id === exec.id)!
    expect(changed.initial_due_at).toBe('2026-09-16T01:00:00.000Z')
    expect(changed.current_due_at).toBe('2026-09-18T01:00:00.000Z')
    await expect(db.query(`update action_obligations set initial_due_at = now() where id = $1`, [exec.id])).rejects.toThrow(/최초 기한/)
    await expect(db.query(`delete from action_obligations where id = $1`, [exec.id])).rejects.toThrow(/이력 테이블/)

    // 의무 추가가 제약(날짜 없는 '특정 일시')에 걸리면 조치 상태·이력도 함께 되돌려져야 한다.
    const complete = planActionMutation(after, { actionId: plan.action.id, op: 'complete', evidence: '보호자와 통화함', expectedVersion: 2, requestId: 'm-3' }, ctx())
    const broken = { ...complete.obligationUpdates[0], id: crypto.randomUUID(), cycle_no: 9, current_due_kind: 'datetime', current_due_at: null }
    await expect(
      call('workflow_apply_action_change', { action_id: plan.action.id, expected_version: 2, request_id: 'm-3', action: complete.action, obligation_updates: complete.obligationUpdates, obligation_inserts: [broken], event: complete.event }),
    ).rejects.toThrow()
    const untouched = await loadAction(plan.action.id)
    expect(untouched.action.status).toBe('open')
    expect(untouched.action.version).toBe(2)
    const events = await one<{ n: number }>('select count(*)::int as n from action_events where action_id = $1', [plan.action.id])
    expect(events.n).toBe(2) // created + due_changed — 실패한 완료 이벤트는 남지 않는다

    expect((await call('workflow_apply_action_change', { action_id: plan.action.id, expected_version: 2, request_id: 'm-3', action: complete.action, obligation_updates: complete.obligationUpdates, obligation_inserts: [], event: complete.event })).status).toBe('ok')
    const done = await loadAction(plan.action.id)
    expect(done.action).toMatchObject({ status: 'completed', completion_evidence: '보호자와 통화함', version: 3 })
    expect(done.obligations.every((o) => o.status === 'fulfilled')).toBe(true)
  })
})

describe('안전 신호 검토', () => {
  it('보고 승인과 별개로 저장되고, 조치 연결은 같은 수급자만, 동시 검토는 충돌', async () => {
    const reportId = await newReport({ status: 'submitted', emergency: true })
    await db.query(`update reports set review_status = 'approved', reviewed_at = now() where id = $1`, [reportId])
    const report = await one<{ id: string; status: string; emergency_flagged: boolean; updated_at: Date; recipient_code: string }>('select * from reports where id = $1', [reportId])
    const r = { ...report, updated_at: report.updated_at.toISOString() }
    const none = await one<{ n: number }>('select count(*)::int as n from safety_reviews where report_id = $1', [reportId])
    expect(none.n).toBe(0) // 보고 승인만으로 안전 검토가 생기지 않는다

    const otherAction = planCreateAction({ recipientCode: 'A02', kind: 'admin_direct', purpose: '다른 수급자 조치', activate: false, requestId: 'a-other' }, ctx())
    await call('workflow_create_action', { action: otherAction.action, obligations: otherAction.obligationInserts, event: otherAction.event })
    const wrongLink = planSafetyReview(r, null, { id: otherAction.action.id, recipient_code: 'A01', status: 'draft' }, { reportId, outcome: 'action_linked', reason: '연결', relatedActionId: otherAction.action.id, expectedLatestReviewId: null, requestId: 's-0' }, ctx())
    expect((await call('workflow_append_safety_review', wrongLink)).status).toBe('invalid')

    const review = planSafetyReview(r, null, null, { reportId, outcome: 'no_further_action', reason: '현장에서 119 연결 확인', expectedLatestReviewId: null, requestId: 's-1' }, ctx())
    expect((await call('workflow_append_safety_review', review)).status).toBe('ok')
    const again = planSafetyReview(r, null, null, { reportId, outcome: 'signal_not_applicable', reason: '다른 판단', expectedLatestReviewId: null, requestId: 's-2' }, ctx())
    expect((await call('workflow_append_safety_review', again)).status).toBe('conflict')

    const plain = await newReport({ status: 'submitted' })
    expect((await call('workflow_append_safety_review', { ...review, id: crypto.randomUUID(), report_id: plain, request_id: 's-3', previous_review_id: null })).status).toBe('invalid')
  })
})
