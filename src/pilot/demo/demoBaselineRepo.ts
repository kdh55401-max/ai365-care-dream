import type { BaselineOpRequest, UnlinkActionBaselineRequest, UploadDocumentRequest } from '../shared/adminRepo'
import { WorkflowRequestError } from '../shared/adminRepo'
import {
  buildActionBaseline,
  buildRecipientBaseline,
  detectDocumentMime,
  emptyBaselineView,
  planChooseReference,
  planLinkAction,
  planRegisterDocument,
  planSaveEntry,
  planSetEntryStatus,
  planUnlinkAction,
  planWithdrawDocument,
  type ActionBaselineLinkView,
  type BaselineOption,
  type LinkActionInput,
  type RecipientBaselineView,
  type SourceDocument,
} from '../../../shared/baseline'
import { ADMIN_ACTOR_SCOPE, WorkflowError, type ActionEvent, type WorkflowContext } from '../../../shared/workflow'
import { DEPLOYMENT_ORGANIZATION } from '../../../shared/organization'
import { DEMO_FILES_KEY, DEMO_RECIPIENT_CODES, demoReadWorkflow, demoWriteWorkflow, newDemoId, type DemoBaseline } from './demoStore'

/** 데모 모드의 4단계(기준문서·기준정보). 실서버와 같은 규칙(shared/baseline.ts)을 쓰고, DB 함수가 하는 확인
 * (중복 요청·버전 대조·같은 수급자·철회 문서 금지)을 같은 계약으로 흉내 낸다. 원본 파일은 이 브라우저
 * localStorage에만 두며(데모 전용 1MB 한도) 서버로 보내지 않는다.
 *
 * 데모 전용 스위치: `?demo_workflow=stage3` = 4단계 DB 미적용(기준정보 저장소 없음) 상태를 흉내 낸다. */

const DEMO_FILE_LIMIT = 1024 * 1024

function flag(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('demo_workflow')
  } catch {
    return null
  }
}

export function demoBaselineReady(): boolean {
  const f = flag()
  return f !== 'off' && f !== 'stage2' && f !== 'stage3'
}

function ctx(): WorkflowContext {
  return { now: new Date().toISOString(), organizationId: DEPLOYMENT_ORGANIZATION.id, newId: newDemoId }
}

function fail(status: number, message: string): never {
  throw new WorkflowRequestError(status, message)
}

function run<T>(fn: () => T): T {
  if (!demoBaselineReady()) fail(503, '기준정보 저장소가 아직 준비되지 않았습니다(4단계 DB 마이그레이션 적용 필요).')
  try {
    return fn()
  } catch (e) {
    if (e instanceof WorkflowError) fail(e.status, e.message)
    throw e
  }
}

function read(): DemoBaseline {
  const b = demoReadWorkflow().baseline
  return { documents: b?.documents ?? [], entries: b?.entries ?? [], choices: b?.choices ?? [], links: b?.links ?? [] }
}

function write(mutate: (b: DemoBaseline) => void) {
  demoWriteWorkflow((wf) => {
    const b = { documents: wf.baseline?.documents ?? [], entries: wf.baseline?.entries ?? [], choices: wf.baseline?.choices ?? [], links: wf.baseline?.links ?? [] }
    mutate(b)
    wf.baseline = b
  })
}

function readFiles(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DEMO_FILES_KEY) || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function requireRecipient(code: string) {
  if (!DEMO_RECIPIENT_CODES.includes(code)) fail(404, '이 기관에서 해당 수급자를 찾을 수 없습니다.')
}

export function demoGetRecipientBaseline(code: string): RecipientBaselineView {
  const c = code.trim().toUpperCase()
  requireRecipient(c)
  if (!demoBaselineReady()) return emptyBaselineView(c, false)
  const b = read()
  return buildRecipientBaseline(c, b.documents, b.entries, b.choices, { storageReady: true })
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export async function demoUploadDocument(input: UploadDocumentRequest, file: File): Promise<{ document: SourceDocument; baseline: RecipientBaselineView }> {
  if (!demoBaselineReady()) fail(503, '기준정보 저장소가 아직 준비되지 않았습니다(4단계 DB 마이그레이션 적용 필요).')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer)
  const code = String(input.recipientCode ?? '').trim().toUpperCase()
  requireRecipient(code)
  const existing = read().documents.find((d) => d.request_id === input.requestId)
  if (existing) return { document: existing, baseline: demoGetRecipientBaseline(existing.recipient_code) }
  if (bytes.length > DEMO_FILE_LIMIT) fail(400, '데모 모드는 이 브라우저에만 저장해 1MB 이하 파일만 올릴 수 있습니다(실제 운영은 4MB).')
  const doc = run(() => {
    const replaced = input.replacesDocumentId ? (read().documents.find((d) => d.id === input.replacesDocumentId) ?? null) : null
    return planRegisterDocument({ ...input, recipientCode: code, originalFilename: file.name }, { sizeBytes: bytes.length, sha256, detectedMime: detectDocumentMime(bytes) }, replaced, ctx())
  })
  // 실서버와 같은 순서: 원본을 먼저 저장하고 기록을 남긴다(기록이 없는 파일은 같은 요청 재시도 때 덮어씀).
  try {
    localStorage.setItem(DEMO_FILES_KEY, JSON.stringify({ ...readFiles(), [doc.id]: toBase64(bytes) }))
  } catch {
    fail(507, '이 브라우저 저장 공간이 부족해 원본을 저장하지 못했습니다(기록은 만들지 않았습니다).')
  }
  write((b) => {
    b.documents.push(doc)
  })
  return { document: doc, baseline: demoGetRecipientBaseline(code) }
}

export function demoDocumentFileUrl(documentId: string): string {
  const doc = read().documents.find((d) => d.id === documentId)
  const data = readFiles()[documentId]
  if (!doc || !data) fail(404, '원본 파일을 찾을 수 없습니다.')
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: doc.mime_type }))
}

export function demoBaselineOp(input: BaselineOpRequest): RecipientBaselineView {
  const code = run(() => {
    const b = read()
    const c = ctx()
    switch (input.baselineOp) {
      case 'withdraw_document': {
        const doc = b.documents.find((d) => d.id === input.documentId)
        if (!doc) fail(404, '문서를 찾을 수 없습니다.')
        if (doc.withdraw_request_id === input.requestId) return doc.recipient_code
        const next = planWithdrawDocument(doc, input, c)
        write((w) => {
          w.documents = w.documents.map((d) => (d.id === doc.id ? next : d))
        })
        return doc.recipient_code
      }
      case 'save_entry': {
        const recipient = String(input.recipientCode ?? '').trim().toUpperCase()
        requireRecipient(recipient)
        if (b.entries.some((e) => e.request_id === input.requestId)) return recipient
        const document = input.sourceType === 'document' ? (b.documents.find((d) => d.id === input.documentId) ?? null) : null
        const lineage = input.lineageId ? b.entries.filter((e) => e.lineage_id === input.lineageId) : []
        const entry = planSaveEntry({ ...input, recipientCode: recipient }, { document, lineage }, c)
        write((w) => {
          // 실DB와 같은 유일 조건: 같은 항목 묶음에 같은 버전이 두 번 생기지 않는다.
          if (w.entries.some((e) => e.lineage_id === entry.lineage_id && e.version === entry.version)) fail(409, '다른 곳에서 이 기준정보가 먼저 수정됐습니다. 최신 내용을 확인해 주세요.')
          w.entries.push(entry)
        })
        return recipient
      }
      case 'set_entry_status': {
        const entry = b.entries.find((e) => e.id === input.entryId)
        if (!entry) fail(404, '기준정보를 찾을 수 없습니다.')
        if (entry.status_request_id === input.requestId) return entry.recipient_code
        const updates = planSetEntryStatus(entry, b.entries.filter((e) => e.lineage_id === entry.lineage_id), input, c)
        write((w) => {
          w.entries = w.entries.map((e) => updates.find((u) => u.id === e.id) ?? e)
        })
        return entry.recipient_code
      }
      case 'choose_reference': {
        const entry = b.entries.find((e) => e.id === input.entryId)
        if (!entry) fail(404, '기준정보를 찾을 수 없습니다.')
        if (b.choices.some((x) => x.request_id === input.requestId)) return entry.recipient_code
        const choice = planChooseReference(entry, input, c)
        write((w) => {
          w.choices.push(choice)
        })
        return entry.recipient_code
      }
      default:
        fail(400, '알 수 없는 기준정보 요청입니다.')
    }
  })
  return demoGetRecipientBaseline(code)
}

/** 조치 상세에 붙는 4단계 정보. */
export function demoActionBaselineFields(actionId: string, recipientCode: string): { baselineReady: boolean; baselineLinks: ActionBaselineLinkView[]; baselineOptions: BaselineOption[] } {
  if (!demoBaselineReady()) return { baselineReady: false, baselineLinks: [], baselineOptions: [] }
  const b = read()
  const built = buildActionBaseline(
    actionId,
    b.links,
    b.entries.filter((e) => e.recipient_code === recipientCode),
    b.documents.filter((d) => d.recipient_code === recipientCode),
  )
  return { baselineReady: true, baselineLinks: built.links, baselineOptions: built.options }
}

function linkEvent(actionId: string, ownerLabel: string | null, type: 'baseline_linked' | 'baseline_unlinked', requestId: string, detail: Record<string, unknown>, reason: string | null, enteredBy: string | null | undefined, now: string): ActionEvent {
  return {
    id: newDemoId(),
    action_id: actionId,
    obligation_id: null,
    event_type: type,
    reason,
    detail,
    actor_scope: ADMIN_ACTOR_SCOPE,
    entered_by_label: enteredBy?.trim() || null,
    owner_label_at_event: ownerLabel,
    request_id: requestId,
    occurred_at: now,
  }
}

export function demoLinkActionBaseline(input: LinkActionInput) {
  run(() => {
    const wf = demoReadWorkflow()
    const action = wf.actions.find((a) => a.id === input.actionId)
    if (!action) fail(404, '이 기관에서 해당 조치를 찾을 수 없습니다.')
    const b = read()
    if (b.links.some((l) => l.request_id === input.requestId)) return
    const entry = b.entries.find((e) => e.id === input.entryId)
    if (!entry) fail(404, '기준정보를 찾을 수 없습니다.')
    const c = ctx()
    const link = planLinkAction(action, entry, b.links.filter((l) => l.action_id === action.id), input, c)
    const event = linkEvent(action.id, action.owner_label, 'baseline_linked', link.request_id, { link_id: link.id, entry_id: entry.id, entry_version: entry.version, lineage_id: entry.lineage_id, document_id: entry.document_id }, link.note, input.enteredByLabel, c.now)
    demoWriteWorkflow((w) => {
      w.baseline = { ...(w.baseline ?? { documents: [], entries: [], choices: [], links: [] }), links: [...(w.baseline?.links ?? []), link] }
      w.actionEvents.push(event)
    })
  })
}

export function demoUnlinkActionBaseline(input: UnlinkActionBaselineRequest) {
  run(() => {
    const wf = demoReadWorkflow()
    const action = wf.actions.find((a) => a.id === input.actionId)
    if (!action) fail(404, '이 기관에서 해당 조치를 찾을 수 없습니다.')
    const link = read().links.find((l) => l.id === input.linkId)
    if (!link) fail(404, '연결을 찾을 수 없습니다.')
    if (link.removed_request_id === input.requestId) return
    const c = ctx()
    const next = planUnlinkAction(action, link, input, c)
    const event = linkEvent(action.id, action.owner_label, 'baseline_unlinked', input.requestId, { link_id: link.id, entry_id: link.entry_id }, next.removed_reason, input.enteredByLabel, c.now)
    demoWriteWorkflow((w) => {
      w.baseline = { ...(w.baseline ?? { documents: [], entries: [], choices: [], links: [] }), links: (w.baseline?.links ?? []).map((l) => (l.id === link.id ? next : l)) }
      w.actionEvents.push(event)
    })
  })
}
