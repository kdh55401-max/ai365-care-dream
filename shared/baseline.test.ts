import { describe, expect, it } from 'vitest'
import {
  buildActionBaseline,
  buildRecipientBaseline,
  checkFile,
  detectDocumentMime,
  documentStoragePath,
  isEffective,
  MAX_DOCUMENT_BYTES,
  planChooseReference,
  planLinkAction,
  planRegisterDocument,
  planSaveEntry,
  planSetEntryStatus,
  planUnlinkAction,
  planWithdrawDocument,
  type BaselineEntry,
  type SaveEntryInput,
  type SourceDocument,
} from './baseline.js'
import { planCreateAction, WorkflowError, type WorkflowContext } from './workflow.js'

let n = 0
const ctx = (org = 'gadream365'): WorkflowContext => ({ now: new Date(Date.UTC(2026, 8, 17, 1, 0, n++)).toISOString(), organizationId: org, newId: () => `id-${++n}` })
const SHA = 'b'.repeat(64)
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])

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

function doc(extra: Partial<Parameters<typeof planRegisterDocument>[0]> = {}, replaced: SourceDocument | null = null): SourceDocument {
  return planRegisterDocument(
    { recipientCode: 'a01', docType: 'care_plan', originalFilename: '계획서.pdf', requestId: `req-${++n}-abcdef`, ...extra },
    { sizeBytes: 1000, sha256: SHA, detectedMime: 'application/pdf' },
    replaced,
    ctx(),
  )
}

function entry(input: Partial<SaveEntryInput>, document: SourceDocument | null = null, lineage: BaselineEntry[] = []): BaselineEntry {
  return planSaveEntry(
    { recipientCode: 'A01', kind: 'observation_assessment', domain: 'meal', statement: '평소 2/3 공기', sourceType: document ? 'document' : 'admin_input', documentId: document?.id, requestId: `e-${++n}`, ...input } as SaveEntryInput,
    { document, lineage },
    ctx(),
  )
}

const confirmed = (e: BaselineEntry, lineage: BaselineEntry[] = [e]) => planSetEntryStatus(e, lineage, { entryId: e.id, status: 'confirmed', expectedRowVersion: e.row_version, requestId: `s-${++n}` }, ctx())

describe('원본 파일 검사', () => {
  it('형식은 파일 앞부분으로만 판정하고, 크기·빈 파일을 거부한다', () => {
    expect(detectDocumentMime(PDF)).toBe('application/pdf')
    expect(detectDocumentMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detectDocumentMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectDocumentMime(new TextEncoder().encode('<html>'))).toBeNull()
    expectError(() => checkFile({ sizeBytes: 10, sha256: SHA, detectedMime: null }), 400, /지원하지 않는/)
    expectError(() => checkFile({ sizeBytes: MAX_DOCUMENT_BYTES + 1, sha256: SHA, detectedMime: 'application/pdf' }), 400, /너무 큽니다/)
    expectError(() => checkFile({ sizeBytes: 0, sha256: SHA, detectedMime: 'application/pdf' }), 400, /빈 파일/)
  })

  it('기준일을 모르면 null(업로드일로 대신하지 않음), 저장 경로는 요청 식별자로 정해져 재시도가 한 벌만 남긴다', () => {
    const d = doc()
    expect(d).toMatchObject({ recipient_code: 'A01', document_date: null, source_label: null, uploaded_by_scope: 'org_admin_shared', status: 'active', version: 1 })
    expect(d.storage_path).toBe(documentStoragePath('gadream365', 'A01', d.request_id, 'application/pdf'))
    expectError(() => doc({ documentDate: '2026/09/01' }), 400, /날짜/)
    // 파일 이름의 경로 구분자·제어문자는 저장 전에 바꾼다(표시용 이름일 뿐 저장 경로에는 쓰지 않음)
    expect(doc({ originalFilename: `..${String.fromCharCode(92)}계획${String.fromCharCode(1)}서/2026.pdf` }).original_filename).toBe('.._계획_서_2026.pdf')
  })

  it('교체본은 같은 수급자의 철회되지 않은 문서만 가리키고, 철회는 이유·버전을 요구한다', () => {
    const old = doc()
    expect(doc({ replacesDocumentId: old.id }, old).replaces_document_id).toBe(old.id)
    expectError(() => doc({ recipientCode: 'A02', replacesDocumentId: old.id }, old), 400)
    const gone = planWithdrawDocument(old, { documentId: old.id, expectedVersion: 1, reason: '잘못 올림', requestId: 'w-1' }, ctx())
    expect(gone).toMatchObject({ status: 'withdrawn', version: 2, withdrawn_reason: '잘못 올림' })
    expectError(() => doc({ replacesDocumentId: old.id }, gone), 409)
    expectError(() => planWithdrawDocument(old, { documentId: old.id, expectedVersion: 2, reason: 'x', requestId: 'w-2' }, ctx()), 409)
    expectError(() => planWithdrawDocument(old, { documentId: old.id, expectedVersion: 1, reason: ' ', requestId: 'w-3' }, ctx()), 400)
  })
})

describe('기준정보 입력 규칙', () => {
  it('빈 값은 null로 남고, 계획·목표와 관찰·평가는 종류로 구분된다', () => {
    const d = doc()
    const plan = entry({ kind: 'plan_goal', statement: '주 3회 산책 목표', domain: 'mobility' }, d)
    expect(plan).toMatchObject({ kind: 'plan_goal', status: 'draft', reference_date: null, value_text: null, value_numeric: null, unit: null, document_id: d.id, version: 1 })
    expect(plan.lineage_id).toBe(plan.id)
    expectError(() => entry({ statement: '  ', valueText: null }), 400, /빈 항목/)
  })

  it('정식 척도는 도구명·버전·측정값·단위·측정일·출처가 모두 있어야 한다(점수 계산 없음)', () => {
    expectError(() => entry({ kind: 'scale_result', domain: 'cognition_communication', statement: null, valueNumeric: 24, unit: '점', toolName: 'MMSE-K' }), 400, /버전·측정일·출처|빠진 값: 버전·측정일·출처/)
    const d = doc({ docType: 'cognitive_assessment' })
    const s = entry({ kind: 'scale_result', domain: 'cognition_communication', statement: null, toolName: 'MMSE-K', toolVersion: '1989', valueNumeric: 24, unit: '점', referenceDate: '2026-08-20' }, d)
    expect(s).toMatchObject({ value_numeric: 24, unit: '점', tool_name: 'MMSE-K', reference_date: '2026-08-20' })
    // 문서 외 출처는 출처 메모가 있어야 척도로 받는다
    expect(entry({ kind: 'scale_result', domain: 'fall', statement: null, toolName: 'Morse', toolVersion: '1989', valueNumeric: 45, unit: '점', referenceDate: '2026-08-01', sourceNote: '2026-08 공단 평가표' }).source_type).toBe('admin_input')
  })

  it('다른 수급자·철회된 문서는 근거로 쓸 수 없고, 과거 복합 영역 키는 새 기준정보에 쓰지 않는다', () => {
    const other = doc({ recipientCode: 'A02' })
    expectError(() => entry({}, other), 400, /다른 수급자/)
    const gone = planWithdrawDocument(doc(), { documentId: 'x', expectedVersion: 1, reason: '교체', requestId: 'w-9' }, ctx())
    expectError(() => entry({}, gone), 409)
    expectError(() => entry({ domain: 'meal_hydration' }), 400, /세부 영역/)
  })

  it('수정은 새 버전 — 오래된 화면에서의 수정은 충돌, 확인은 최신 초안만, 확인되면 이전 버전은 "이전 버전"', () => {
    const v1 = entry({})
    const [c1] = confirmed(v1)
    const v2 = entry({ lineageId: v1.lineage_id, expectedLatestVersion: 1, statement: '평소 반 공기' }, null, [c1])
    expect(v2).toMatchObject({ lineage_id: v1.lineage_id, version: 2, supersedes_entry_id: v1.id, status: 'draft' })
    expectError(() => entry({ lineageId: v1.lineage_id, expectedLatestVersion: 1 }, null, [c1, v2]), 409)
    expectError(() => entry({ lineageId: v1.lineage_id, expectedLatestVersion: 2, kind: 'plan_goal' }, null, [c1, v2]), 400, /종류/)
    // v2 초안이 있는 동안 v1은 여전히 유효(초안은 판단 근거가 아님)
    expect(isEffective(c1)).toBe(true)
    expect(isEffective(v2)).toBe(false)
    const updates = confirmed(v2, [c1, v2])
    expect(updates.find((u) => u.id === v2.id)?.status).toBe('confirmed')
    expect(updates.find((u) => u.id === v1.id)?.superseded_at).not.toBeNull()
    expectError(() => confirmed(c1, [c1, v2]), 409)
    const [retracted] = planSetEntryStatus(updates[0], [updates[1], updates[0]], { entryId: v2.id, status: 'retracted', expectedRowVersion: updates[0].row_version, reason: '잘못 입력', requestId: 'r-1' }, ctx())
    expect(retracted.status).toBe('retracted')
    expectError(() => entry({ lineageId: v1.lineage_id, expectedLatestVersion: 2 }, null, [updates[1], retracted]), 409, /철회/)
  })
})

describe('상충 값 · 참고값 · 조치 근거', () => {
  it('출처가 다른 확인 값은 모두 보존되고 관리자가 참고값을 고른다 — 같은 값이면 상충이 아니다', () => {
    const a = doc({ docType: 'fall_assessment' })
    const b = doc({ docType: 'other_assessment' })
    const [e1] = confirmed(entry({ domain: 'fall', statement: '낙상 위험 낮음' }, a))
    const [e2] = confirmed(entry({ domain: 'fall', statement: '낙상 위험 높음' }, b))
    const [same] = confirmed(entry({ domain: 'meal', statement: '평소 2/3 공기' }, a))
    const [same2] = confirmed(entry({ domain: 'meal', statement: '평소 2/3 공기' }, b))
    const [note] = confirmed(entry({ kind: 'admin_note', domain: 'fall', statement: '보호자 말로는 최근 넘어짐 없음' }))
    let view = buildRecipientBaseline('A01', [a, b], [e1, e2, same, same2, note], [], { storageReady: true })
    expect(view.conflicts).toHaveLength(1)
    expect(view.conflicts[0]).toMatchObject({ domain: 'fall', needsConfirmation: true })
    const choice = planChooseReference(e1, { entryId: e1.id, reason: '공단 평가가 최신', requestId: 'c-1' }, ctx())
    view = buildRecipientBaseline('A01', [a, b], [e1, e2, same, same2, note], [choice], { storageReady: true })
    expect(view.conflicts[0]).toMatchObject({ needsConfirmation: false })
    // 선택 뒤 새로 확인된 다른 값이 생기면 다시 확인 필요(자동으로 바꾸지 않음)
    const [e3] = confirmed(entry({ domain: 'fall', statement: '낙상 위험 중간' }, b))
    view = buildRecipientBaseline('A01', [a, b], [e1, e2, e3, note], [choice], { storageReady: true })
    expect(view.conflicts[0].chosen?.chosen_entry_id).toBe(e1.id)
    expect(view.conflicts[0].newerThanChoice.map((e) => e.id)).toEqual([e3.id])
    expect(view.conflicts[0].needsConfirmation).toBe(true)
    expectError(() => planChooseReference(note, { entryId: note.id, reason: 'x', requestId: 'c-2' }, ctx()), 400)
  })

  it('조치에는 확인된 현재 버전만 연결되고, 연결은 당시 버전을 보여주며 새 버전·철회를 따로 알린다', () => {
    const action = planCreateAction({ recipientCode: 'A01', kind: 'admin_direct', purpose: '안내', actionContent: 'x', activate: true, requestId: `a-${++n}` }, ctx()).action
    const draft = entry({})
    expectError(() => planLinkAction(action, draft, [], { actionId: action.id, entryId: draft.id, requestId: 'l-0' }, ctx()), 409, /확인된/)
    const [v1] = confirmed(draft)
    const other = confirmed(entry({ recipientCode: 'A02' }))[0]
    expectError(() => planLinkAction(action, other, [], { actionId: action.id, entryId: other.id, requestId: 'l-x' }, ctx()), 400, /다른 수급자/)
    const link = planLinkAction(action, v1, [], { actionId: action.id, entryId: v1.id, note: '식사량 기준 참고', requestId: 'l-1' }, ctx())
    expectError(() => planLinkAction(action, v1, [link], { actionId: action.id, entryId: v1.id, requestId: 'l-2' }, ctx()), 409, /이미/)
    const v2 = entry({ lineageId: v1.lineage_id, expectedLatestVersion: 1, statement: '평소 반 공기' }, null, [v1])
    const after = confirmed(v2, [v1, v2])
    const entries = [after.find((e) => e.id === v1.id)!, after.find((e) => e.id === v2.id)!]
    const built = buildActionBaseline(action.id, [link], entries, [])
    expect(built.links[0].entry.version).toBe(1)
    expect(built.links[0].currentEffective?.version).toBe(2)
    expect(built.options.map((o) => o.entryId)).toEqual([v2.id]) // 이전 버전은 새로 연결할 수 없음
    const removed = planUnlinkAction(action, link, { reason: '다른 근거로 대체', requestId: 'u-1' }, ctx())
    expect(removed.removed_reason).toBe('다른 근거로 대체')
    expectError(() => planUnlinkAction(action, removed, { reason: 'x', requestId: 'u-2' }, ctx()), 409)
    const done = { ...action, status: 'completed' as const }
    expectError(() => planLinkAction(done, entries[1], [], { actionId: action.id, entryId: v2.id, requestId: 'l-3' }, ctx()), 409)
  })

  it('기준정보가 없어도 빈 보기(가짜 값 없음)', () => {
    const view = buildRecipientBaseline('A05', [], [], [], { storageReady: false })
    expect(view).toMatchObject({ ready: true, storageReady: false, documents: [], lineages: [], conflicts: [] })
  })
})
