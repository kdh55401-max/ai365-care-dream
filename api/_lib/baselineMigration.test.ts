/** db/migrations/2026-09-17-source-documents.sql(4단계)을 2·3단계 위에 실제 Postgres 엔진(PGlite)으로 실행해
 * 원본 → 기준정보 → 확인 → 조치 근거 연결, 버전·상충 보존, 기록 불변, 권한(다른 기관·다른 수급자)을 검증한다.
 * 원본 파일 저장소(Supabase Storage 버킷)와 PostgREST 계층은 이 테스트 범위 밖이다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { planCreateAction, type CareAction, type WorkflowContext } from '../../shared/workflow.js'
import {
  buildRecipientBaseline,
  planChooseReference,
  planLinkAction,
  planRegisterDocument,
  planSaveEntry,
  planSetEntryStatus,
  type ActionBaselineLink,
  type BaselineEntry,
  type ReferenceChoice,
  type SaveEntryInput,
  type SourceDocument,
} from '../../shared/baseline.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const strip = (sql: string) => sql.replace(/create extension[^;]*;/gi, '')
const read = (p: string) => strip(readFileSync(`${root}${p}`, 'utf8'))

let db: PGlite
let seq = 0
const ctx = (org = 'gadream365'): WorkflowContext => ({ now: new Date(Date.now() + ++seq * 1000).toISOString(), organizationId: org, newId: () => crypto.randomUUID() })
const iso = <T extends object>(row: T): T =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? (/_date$|valid_until/.test(k) ? v.toISOString().slice(0, 10) : v.toISOString()) : k === 'value_numeric' && v !== null ? Number(v) : v])) as T

async function apply(payload: unknown): Promise<Record<string, unknown>> {
  return (await db.query<{ r: Record<string, unknown> }>('select baseline_apply($1::jsonb) as r', [JSON.stringify(payload)])).rows[0].r
}
async function rows<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows.map(iso)
}

const SHA = 'a'.repeat(64)
async function upload(recipient = 'A01', extra: Partial<Parameters<typeof planRegisterDocument>[0]> = {}, replaced: SourceDocument | null = null, org = 'gadream365') {
  const doc = planRegisterDocument(
    { recipientCode: recipient, docType: 'care_plan', title: '급여제공계획서', documentDate: null, sourceLabel: '센터 작성', originalFilename: '계획서.pdf', requestId: `doc-${crypto.randomUUID()}`, ...extra },
    { sizeBytes: 2048, sha256: SHA, detectedMime: 'application/pdf' },
    replaced,
    ctx(org),
  )
  const r = await apply({ op: 'register_document', document: doc })
  return { doc, r }
}

async function lineage(id: string): Promise<BaselineEntry[]> {
  return rows<BaselineEntry>('select * from baseline_entries where lineage_id = $1 order by version', [id])
}

async function save(input: Partial<SaveEntryInput>, doc: SourceDocument | null, prior: BaselineEntry[] = []) {
  const entry = planSaveEntry(
    { recipientCode: 'A01', kind: 'observation_assessment', domain: 'meal', statement: '평소 한 끼 2/3 공기', sourceType: doc ? 'document' : 'admin_input', documentId: doc?.id ?? null, requestId: `e-${crypto.randomUUID()}`, ...input } as SaveEntryInput,
    { document: doc, lineage: prior },
    ctx(),
  )
  return { entry, r: await apply({ op: 'save_entry', entry }) }
}

async function confirm(entry: BaselineEntry) {
  const current = (await rows<BaselineEntry>('select * from baseline_entries where id = $1', [entry.id]))[0]
  const [u] = planSetEntryStatus(current, await lineage(current.lineage_id), { entryId: current.id, status: 'confirmed', expectedRowVersion: current.row_version, requestId: `s-${crypto.randomUUID()}` }, ctx())
  return apply({ op: 'set_entry_status', organization_id: 'gadream365', entry_id: current.id, status: 'confirmed', expected_row_version: current.row_version, request_id: u.status_request_id, at: new Date().toISOString(), entered_by_label: null })
}

async function newAction(recipient = 'A01'): Promise<CareAction> {
  const plan = planCreateAction({ recipientCode: recipient, kind: 'admin_direct', purpose: '보호자 안내', actionContent: '식사량 안내', activate: true, requestId: `c-${++seq}` }, ctx())
  expect((await db.query<{ r: { status: string } }>('select workflow_create_action($1::jsonb) as r', [JSON.stringify({ action: plan.action, obligations: plan.obligationInserts, event: plan.event })])).rows[0].r.status).toBe('ok')
  return plan.action
}

function linkPayload(action: CareAction, entry: BaselineEntry, links: ActionBaselineLink[] = []) {
  const link = planLinkAction(action, entry, links, { actionId: action.id, entryId: entry.id, requestId: `l-${crypto.randomUUID()}` }, ctx())
  return {
    link,
    payload: {
      op: 'link_action',
      organization_id: 'gadream365',
      link,
      event: { id: crypto.randomUUID(), action_id: action.id, obligation_id: null, event_type: 'baseline_linked', reason: null, detail: { entry_id: entry.id }, actor_scope: 'org_admin_shared', entered_by_label: null, owner_label_at_event: null, request_id: link.request_id, occurred_at: link.linked_at },
    },
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(read('db/schema.sql'))
  await db.exec(read('db/migrations/2026-09-15-admin-workflow.sql'))
  await db.exec(read('db/migrations/2026-09-16-field-requests.sql'))
  await db.exec(read('db/migrations/2026-09-17-source-documents.sql'))
  await db.exec(read('db/migrations/2026-09-17-source-documents.sql')) // 다시 실행해도 안전
}, 60_000)

describe('4단계 마이그레이션 적용 순서', () => {
  it('2·3단계 없이 실행하면 멈춘다', async () => {
    const bare = new PGlite()
    await bare.exec(read('db/schema.sql'))
    await bare.exec(read('db/migrations/2026-09-15-admin-workflow.sql'))
    await expect(bare.exec(read('db/migrations/2026-09-17-source-documents.sql'))).rejects.toThrow(/3단계/)
  }, 60_000) // 빈 Postgres를 새로 띄워 느리다(다른 PGlite 테스트와 병렬)
})

describe('원본 → 기준정보 → 확인 → 조치 근거', () => {
  it('문서 기준일은 모르면 null로 남고, 같은 요청은 한 번만 저장된다', async () => {
    const { doc, r } = await upload()
    expect(r.status).toBe('ok')
    expect((await apply({ op: 'register_document', document: doc })).status).toBe('duplicate')
    const [stored] = await rows<SourceDocument>('select * from source_documents where id = $1', [doc.id])
    expect(stored).toMatchObject({ document_date: null, uploaded_by_scope: 'org_admin_shared', status: 'active', mime_type: 'application/pdf', size_bytes: 2048 })
  })

  it('입력은 미확인 초안 → 확인해야 조치 근거로 연결되고, 연결은 당시 버전을 가리킨 채 새 버전 뒤에도 남는다', async () => {
    const { doc } = await upload()
    const { entry, r } = await save({ pageRef: '2쪽', excerpt: '식사: 평소 2/3 공기 섭취' }, doc)
    expect(r.status).toBe('ok')
    const action = await newAction()
    // 초안은 연결 거부(DB도 확인)
    const draftLink = linkPayload(action, { ...entry, status: 'confirmed' })
    expect((await apply(draftLink.payload)).status).toBe('conflict')
    expect((await confirm(entry)).status).toBe('ok')
    const [v1] = await lineage(entry.lineage_id)
    const ok = linkPayload(action, v1)
    expect((await apply(ok.payload)).status).toBe('ok')
    expect((await apply(ok.payload)).status).toBe('duplicate')
    // 새 버전(수정) 입력·확인 → 이전 버전은 '이전 버전', 연결은 v1 그대로
    const { entry: v2, r: r2 } = await save({ lineageId: v1.lineage_id, expectedLatestVersion: 1, statement: '평소 한 끼 반 공기' }, doc, await lineage(v1.lineage_id))
    expect(r2.status).toBe('ok')
    expect((await confirm(v2)).status).toBe('ok')
    const versions = await lineage(v1.lineage_id)
    expect(versions.map((e) => [e.version, e.status, Boolean(e.superseded_at)])).toEqual([
      [1, 'confirmed', true],
      [2, 'confirmed', false],
    ])
    const [link] = await rows<ActionBaselineLink>('select * from action_baseline_links where action_id = $1', [action.id])
    expect(link).toMatchObject({ entry_id: v1.id, document_id: doc.id, removed_at: null })
    const events = await rows<{ event_type: string }>(`select event_type from action_events where action_id = $1 order by occurred_at`, [action.id])
    expect(events.map((e) => e.event_type)).toEqual(['created', 'baseline_linked'])
    // 같은 버전 묶음의 오래된 버전으로 새 버전을 또 만들면 충돌
    // (v2가 생기기 전 화면에서 만든) 오래된 계획으로 v1의 새 버전을 또 만들면 DB가 충돌로 막는다
    const stale = planSaveEntry({ recipientCode: 'A01', lineageId: v1.lineage_id, expectedLatestVersion: 1, kind: 'observation_assessment', domain: 'meal', statement: 'x', sourceType: 'admin_input', requestId: `e-${crypto.randomUUID()}` }, { document: null, lineage: [versions[0]] }, ctx())
    expect((await apply({ op: 'save_entry', entry: stale })).status).toBe('conflict')
  })

  it('문서를 교체하거나 철회해도 이전 문서와 그 문서의 기준정보·연결은 남는다', async () => {
    const { doc: oldDoc } = await upload()
    const { entry } = await save({}, oldDoc)
    await confirm(entry)
    const { doc: newDoc, r } = await upload('A01', { replacesDocumentId: oldDoc.id, documentDate: '2026-09-01' }, oldDoc)
    expect(r.status).toBe('ok')
    expect(
      (await apply({ op: 'withdraw_document', organization_id: 'gadream365', document_id: oldDoc.id, expected_version: 1, reason: '새 계획서로 교체', request_id: 'w-1', at: new Date().toISOString() })).status,
    ).toBe('ok')
    expect((await apply({ op: 'withdraw_document', organization_id: 'gadream365', document_id: oldDoc.id, expected_version: 1, reason: '다시', request_id: 'w-1', at: new Date().toISOString() })).status).toBe('duplicate')
    const docs = await rows<SourceDocument>('select * from source_documents where id = any($1)', [[oldDoc.id, newDoc.id]])
    expect(docs.find((d) => d.id === oldDoc.id)?.status).toBe('withdrawn')
    expect((await rows<BaselineEntry>('select * from baseline_entries where id = $1', [entry.id]))[0].status).toBe('confirmed')
    // 철회된 문서는 새 기준정보의 근거로 못 쓴다(DB에서도)
    const bad = planSaveEntry({ recipientCode: 'A01', kind: 'plan_goal', domain: 'meal', statement: '목표', sourceType: 'document', documentId: oldDoc.id, requestId: `e-${crypto.randomUUID()}` }, { document: { ...oldDoc }, lineage: [] }, ctx())
    expect((await apply({ op: 'save_entry', entry: bad })).status).toBe('conflict')
  })

  it('상충하는 값은 출처별로 보존하고, 관리자가 고른 참고값만 표시한다(최신 값으로 덮어쓰지 않음)', async () => {
    const { doc: a } = await upload('A03', { docType: 'fall_assessment' })
    const { doc: b } = await upload('A03', { docType: 'other_assessment' })
    const e1 = (await save({ recipientCode: 'A03', domain: 'fall', statement: '낙상 위험 낮음' }, a)).entry
    const e2 = (await save({ recipientCode: 'A03', domain: 'fall', statement: '낙상 위험 높음' }, b)).entry
    await confirm(e1)
    await confirm(e2)
    const load = async () => {
      const [docs, entries, choices] = await Promise.all([
        rows<SourceDocument>(`select * from source_documents where recipient_code = 'A03'`),
        rows<BaselineEntry>(`select * from baseline_entries where recipient_code = 'A03'`),
        rows<ReferenceChoice>(`select * from baseline_reference_choices where recipient_code = 'A03'`),
      ])
      return buildRecipientBaseline('A03', docs, entries, choices, { storageReady: true })
    }
    let view = await load()
    expect(view.conflicts).toHaveLength(1)
    expect(view.conflicts[0]).toMatchObject({ needsConfirmation: true, chosen: null })
    expect(view.conflicts[0].entries.map((e) => e.statement)).toEqual(['낙상 위험 낮음', '낙상 위험 높음'])
    const [c1] = await rows<BaselineEntry>('select * from baseline_entries where id = $1', [e1.id])
    const choice = planChooseReference(c1, { entryId: e1.id, reason: '공단 평가가 더 최근', requestId: `ch-${crypto.randomUUID()}` }, ctx())
    expect((await apply({ op: 'choose_reference', choice })).status).toBe('ok')
    view = await load()
    expect(view.conflicts[0]).toMatchObject({ needsConfirmation: false })
    expect(view.conflicts[0].chosen?.chosen_entry_id).toBe(e1.id)
    expect(view.lineages.filter((l) => l.effective).length).toBe(2) // 두 값 모두 보존
  })

  it('정식 척도는 도구명·버전·측정값·단위·측정일·출처 없이는 DB도 거부한다', async () => {
    await expect(
      db.query(
        `insert into baseline_entries (id, organization_id, recipient_code, lineage_id, version, kind, domain, value_numeric, source_type, created_at, created_by_scope, request_id)
         values ($1, 'gadream365', 'A01', $1, 1, 'scale_result', 'cognition_communication', 24, 'admin_input', now(), 'org_admin_shared', $2)`,
        [crypto.randomUUID(), `x-${crypto.randomUUID()}`],
      ),
    ).rejects.toThrow()
    const { doc } = await upload('A01', { docType: 'cognitive_assessment' })
    const { r } = await save({ kind: 'scale_result', domain: 'cognition_communication', statement: null, toolName: 'MMSE-K', toolVersion: '1989', valueNumeric: 24, unit: '점', referenceDate: '2026-08-20' }, doc)
    expect(r.status).toBe('ok')
  })
})

describe('적용 순서가 섞여도 안전', () => {
  it('4단계 이벤트가 쌓인 뒤 2·3단계 파일을 다시 실행해도 실패하지 않고 4단계 값을 지우지 않는다', async () => {
    const action = await newAction()
    const { entry } = await save({}, null)
    await confirm(entry)
    const [e] = await rows<BaselineEntry>('select * from baseline_entries where id = $1', [entry.id])
    expect((await apply(linkPayload(action, e).payload)).status).toBe('ok')
    await db.exec(read('db/migrations/2026-09-15-admin-workflow.sql'))
    await db.exec(read('db/migrations/2026-09-16-field-requests.sql'))
    const events = await rows<{ event_type: string }>('select event_type from action_events where action_id = $1', [action.id])
    expect(events.map((x) => x.event_type)).toContain('baseline_linked')
  }, 60_000)
})

describe('권한 · 기록 불변', () => {
  it('다른 기관의 문서·조치·기준정보는 다룰 수 없다', async () => {
    const { doc } = await upload('A01', {}, null, 'other-org')
    expect((await apply({ op: 'withdraw_document', organization_id: 'gadream365', document_id: doc.id, expected_version: 1, reason: 'x', request_id: 'w-x', at: new Date().toISOString() })).status).toBe('not_found')
    const mismatched = planSaveEntry({ recipientCode: 'A01', kind: 'plan_goal', domain: 'meal', statement: '목표', sourceType: 'document', documentId: doc.id, requestId: `e-${crypto.randomUUID()}` }, { document: { ...doc, organization_id: 'gadream365' }, lineage: [] }, ctx())
    expect((await apply({ op: 'save_entry', entry: mismatched })).status).toBe('invalid')
    // 다른 수급자의 확인된 기준정보는 이 조치에 연결 못 함
    const { entry } = await save({ recipientCode: 'A02' }, null)
    await confirm(entry)
    const action = await newAction('A01')
    const [e] = await rows<BaselineEntry>('select * from baseline_entries where id = $1', [entry.id])
    const forged = linkPayload(action, { ...e, recipient_code: 'A01' })
    expect((await apply(forged.payload)).status).toBe('invalid')
  })

  it('문서 메타데이터·기준정보 내용·참고값 선택·연결은 고치거나 지울 수 없다', async () => {
    const { doc } = await upload()
    await expect(db.query(`update source_documents set document_date = '2026-01-01' where id = $1`, [doc.id])).rejects.toThrow(/바꿀 수 없습니다/)
    await expect(db.query(`delete from source_documents where id = $1`, [doc.id])).rejects.toThrow()
    const { entry } = await save({}, doc)
    await expect(db.query(`update baseline_entries set statement = '바꿈' where id = $1`, [entry.id])).rejects.toThrow(/새 버전/)
    await expect(db.query(`delete from baseline_entries where id = $1`, [entry.id])).rejects.toThrow()
  })
})
