/** db/migrations/2026-09-18-change-candidate-reviews.sql(5단계)을 2·3·4단계 위에 실제 Postgres 엔진(PGlite)으로 실행해
 * 후보 판단의 중복 방지·조치 연결 검증(같은 기관·같은 수급자·열린 조치)·기록 불변을 확인한다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { planCreateAction, type CareAction, type WorkflowContext } from '../../shared/workflow.js'
import { computeRepeatCandidates, planCandidateReview } from '../../shared/changeCandidates.js'
import type { CareReportRecord } from '../../shared/careTypes.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8').replace(/create extension[^;]*;/gi, '')

let db: PGlite
let seq = 0
const ctx = (): WorkflowContext => ({ now: new Date(Date.now() + ++seq * 1000).toISOString(), organizationId: 'gadream365', newId: () => crypto.randomUUID() })

async function append(review: unknown): Promise<Record<string, unknown>> {
  return (await db.query<{ r: Record<string, unknown> }>('select candidate_review_append($1::jsonb) as r', [JSON.stringify({ review })])).rows[0].r
}

async function newAction(recipient: string, activate = true): Promise<CareAction> {
  const plan = planCreateAction({ recipientCode: recipient, kind: 'admin_direct', purpose: '보호자 안내', actionContent: 'x', activate, requestId: `c-${++seq}` }, ctx())
  expect((await db.query<{ r: { status: string } }>('select workflow_create_action($1::jsonb) as r', [JSON.stringify({ action: plan.action, obligations: plan.obligationInserts, event: plan.event })])).rows[0].r.status).toBe('ok')
  return plan.action
}

const today = '2026-09-17'
const reports = [
  { id: 'r1', recipient_code: 'A01', participant_code: 'C01', status: 'submitted', report_date: '2026-09-15', submitted_at: '2026-09-15T02:00:00Z', report_source: 'live', deleted: false, review_status: 'pending', changed_domains_json: [{ domain: 'meal', status: 'changed' }] },
  { id: 'r2', recipient_code: 'A01', participant_code: 'C01', status: 'submitted', report_date: '2026-09-16', submitted_at: '2026-09-16T02:00:00Z', report_source: 'live', deleted: false, review_status: 'pending', changed_domains_json: [{ domain: 'meal', status: 'changed' }] },
] as unknown as CareReportRecord[]
const candidate = () => computeRepeatCandidates(reports, today).candidates[0]

beforeAll(async () => {
  db = new PGlite()
  await db.exec(read('db/schema.sql'))
  await db.exec(read('db/migrations/2026-09-15-admin-workflow.sql'))
  await db.exec(read('db/migrations/2026-09-16-field-requests.sql'))
  await db.exec(read('db/migrations/2026-09-17-source-documents.sql'))
  await db.exec(read('db/migrations/2026-09-18-change-candidate-reviews.sql'))
  await db.exec(read('db/migrations/2026-09-18-change-candidate-reviews.sql')) // 다시 실행해도 안전
}, 60_000)

describe('5단계 후보 판단 저장', () => {
  it('4단계 없이 실행하면 멈춘다', async () => {
    const bare = new PGlite()
    await bare.exec(read('db/schema.sql'))
    await bare.exec(read('db/migrations/2026-09-15-admin-workflow.sql'))
    await expect(bare.exec(read('db/migrations/2026-09-18-change-candidate-reviews.sql'))).rejects.toThrow(/4단계/)
  }, 60_000)

  it('판단은 같은 요청 한 번만 쌓이고, 같은 후보의 새 판단은 이전 판단을 지우지 않는다', async () => {
    const c = candidate()
    const first = planCandidateReview(c, { candidateKey: c.key, decision: 'needs_check', reason: '식사 변화 두 번 보고', requestId: `rv-${++seq}` }, null, ctx())
    expect((await append(first)).status).toBe('ok')
    expect((await append(first)).status).toBe('duplicate')
    const second = planCandidateReview(c, { candidateKey: c.key, decision: 'within_usual', reason: '보호자 확인 — 평소 범위', requestId: `rv-${++seq}` }, null, ctx())
    expect((await append(second)).status).toBe('ok')
    const rows = (await db.query<{ decision: string; evidence: { reportIds: string[] } }>('select decision, evidence from change_candidate_reviews where candidate_key = $1 order by reviewed_at', [c.key])).rows
    expect(rows.map((r) => r.decision)).toEqual(['needs_check', 'within_usual'])
    expect(rows[0].evidence.reportIds.sort()).toEqual(['r1', 'r2'])
    await expect(db.query(`update change_candidate_reviews set decision = 'change_confirmed' where candidate_key = $1`, [c.key])).rejects.toThrow()
    await expect(db.query(`delete from change_candidate_reviews where candidate_key = $1`, [c.key])).rejects.toThrow()
  })

  it('조치 연결은 같은 수급자의 초안·진행 중 조치만 — 다른 수급자·완료 조치·다른 기관은 DB가 거부', async () => {
    const c = candidate()
    const own = await newAction('A01')
    const ok = planCandidateReview(c, { candidateKey: c.key, decision: 'change_confirmed', reason: '조치로 연결', linkedActionId: own.id, requestId: `rv-${++seq}` }, own, ctx())
    expect((await append(ok)).status).toBe('ok')
    const other = await newAction('A02')
    expect((await append({ ...ok, id: crypto.randomUUID(), request_id: `rv-${++seq}`, linked_action_id: other.id })).status).toBe('invalid')
    await db.query(`update care_actions set status = 'cancelled', cancel_reason = 'x', cancelled_at = now(), version = version + 1 where id = $1`, [own.id])
    expect((await append({ ...ok, id: crypto.randomUUID(), request_id: `rv-${++seq}` })).status).toBe('conflict')
    const foreign = await newAction('A01')
    expect((await append({ ...ok, id: crypto.randomUUID(), request_id: `rv-${++seq}`, linked_action_id: foreign.id, organization_id: 'other-org' })).status).toBe('invalid')
    await expect(db.query(`insert into change_candidate_reviews (id, organization_id, candidate_key, candidate_kind, rule_id, rule_version, recipient_code, evidence, decision, reason, reviewed_at, actor_scope, request_id)
      values ($1, 'gadream365', 'k', 'repeat_changed', 'repeat_changed', 1, 'A01', '{}', 'needs_check', '   ', now(), 'org_admin_shared', $2)`, [crypto.randomUUID(), `rv-${++seq}`])).rejects.toThrow()
  })
})
