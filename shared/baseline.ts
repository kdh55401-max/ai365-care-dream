/** 돌봄 연속성 4단계 — 기준문서(원본)와 관리자가 확인한 기준정보. 서버·데모 공통 규칙.
 *
 * - 원본 문서는 비공개로 보관하고 문서유형·원래 파일명·문서 기준일·업로드일·출처·업로더·형식·크기를 따로 남긴다.
 *   기준일을 모르면 null — 업로드일로 대신하지 않는다.
 * - 기준정보 한 항목은 바뀌지 않는 버전 행으로 쌓인다(수정 = 새 버전). 입력하면 "미확인 초안", 관리자가 확인해야
 *   "관리자 확인". 과거 조치가 연결한 버전은 문서 교체·수정 뒤에도 그대로 남는다.
 * - 관찰·평가 결과 / 계획·목표 / 정식 척도 결과 / 관리자 판단·메모를 구분한다. 계획·목표를 관찰된 상태로 쓰지 않는다.
 * - 정식 척도는 도구명·버전·측정값·단위·측정일·출처가 모두 있을 때만 기록한다. 채점·환산·건강점수는 만들지 않는다.
 * - 같은 항목에 출처가 다른 값이 있으면 모두 보존하고, 최신 업로드로 덮어쓰지 않는다 — 관리자가 현재 참고값을 고른다.
 * - 빈 값은 null 그대로 둔다. 기준정보가 없는 것은 데이터 상태이지 건강 위험이 아니다. */
import { DOMAIN_KEYS, DOMAIN_LABELS, type DomainKey } from './careTypes.js'
import { ADMIN_ACTOR_SCOPE, WorkflowError, type CareAction, type WorkflowContext } from './workflow.js'

// ── 원본 문서 ────────────────────────────────────────────────────────
export const DOCUMENT_TYPES = ['care_plan', 'ltc_use_plan', 'fall_assessment', 'pressure_ulcer_assessment', 'cognitive_assessment', 'other_assessment', 'other'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  care_plan: '급여제공계획서',
  ltc_use_plan: '개인별 장기요양이용계획서',
  fall_assessment: '낙상 위험 평가',
  pressure_ulcer_assessment: '욕창 위험 평가',
  cognitive_assessment: '인지 기능 평가',
  other_assessment: '기타 평가 자료',
  other: '기타 문서',
}

export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export type DocumentMime = (typeof DOCUMENT_MIME_TYPES)[number]
export const DOCUMENT_EXTENSIONS: Record<DocumentMime, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }
/** Vercel 서버 함수의 요청 본문 한도(4.5MB) 안에서 원본을 서버가 직접 검사·저장하기 위한 상한. */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
export const DOCUMENT_FORMAT_HINT = 'PDF·JPG·PNG, 4MB 이하'
export const DOCUMENT_BUCKET = 'care-source-documents'

/** 파일 앞부분(매직 바이트)으로 실제 형식을 판정한다 — 확장자·브라우저가 알려준 형식은 믿지 않는다. */
export function detectDocumentMime(bytes: Uint8Array): DocumentMime | null {
  const at = (i: number) => bytes[i]
  if (bytes.length >= 5 && at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) return 'application/pdf'
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) return 'image/png'
  return null
}

export type DocumentStatus = 'active' | 'withdrawn'

export interface SourceDocument {
  id: string
  organization_id: string
  recipient_code: string
  doc_type: DocumentType
  title: string | null
  /** 문서 기준일(작성·평가 기준). 모르면 null. */
  document_date: string | null
  /** 출처(예: 공단 발급·센터 작성·보호자 제공). 모르면 null. */
  source_label: string | null
  original_filename: string
  mime_type: DocumentMime
  size_bytes: number
  sha256: string
  storage_bucket: string
  storage_path: string
  uploaded_at: string
  uploaded_by_scope: string
  uploaded_by_label: string | null
  /** 교체본이면 이전 문서 id(이전 문서는 지우지 않는다). */
  replaces_document_id: string | null
  status: DocumentStatus
  withdrawn_at: string | null
  withdrawn_reason: string | null
  withdraw_request_id: string | null
  version: number
  request_id: string
}

// ── 기준정보 ─────────────────────────────────────────────────────────
export const ENTRY_KINDS = ['observation_assessment', 'plan_goal', 'scale_result', 'admin_note'] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  observation_assessment: '관찰·평가 결과',
  plan_goal: '계획·목표(관찰 결과 아님)',
  scale_result: '정식 척도 결과',
  admin_note: '관리자 판단·메모(공식 평가 아님)',
}
export type EntrySourceType = 'document' | 'admin_input'
export type EntryStatus = 'draft' | 'confirmed' | 'retracted'
export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = { draft: '미확인 초안', confirmed: '관리자 확인', retracted: '철회됨' }

/** 새 기준정보에 쓸 수 있는 세부 영역 — 과거 전용 복합 키와 '확인하지 못함'은 제외(과거 키를 추정 분해하지 않는다). */
export const BASELINE_DOMAINS: DomainKey[] = DOMAIN_KEYS.filter((k) => !['meal_hydration', 'mobility_fall', 'not_checked'].includes(k))

export interface BaselineEntry {
  id: string
  organization_id: string
  recipient_code: string
  /** 같은 항목의 버전 묶음(첫 버전의 id). */
  lineage_id: string
  version: number
  supersedes_entry_id: string | null
  kind: EntryKind
  domain: DomainKey | null
  statement: string | null
  value_text: string | null
  value_numeric: number | null
  unit: string | null
  tool_name: string | null
  tool_version: string | null
  /** 기준일(척도는 측정일). 모르면 null. */
  reference_date: string | null
  valid_until: string | null
  source_type: EntrySourceType
  document_id: string | null
  page_ref: string | null
  excerpt: string | null
  source_note: string | null
  status: EntryStatus
  created_at: string
  created_by_scope: string
  entered_by_label: string | null
  confirmed_at: string | null
  confirmed_by_label: string | null
  retracted_at: string | null
  retract_reason: string | null
  /** 새 버전이 확인되면 이 버전은 이전 버전이 된다(기록은 남음). */
  superseded_at: string | null
  status_request_id: string | null
  row_version: number
  request_id: string
}

/** 상충 값 중 관리자가 고른 현재 참고값(추가만 — 최신 선택이 유효). */
export interface ReferenceChoice {
  id: string
  organization_id: string
  recipient_code: string
  group_key: string
  chosen_entry_id: string
  reason: string
  chosen_at: string
  chosen_by_scope: string
  entered_by_label: string | null
  request_id: string
}

/** 조치 ↔ 기준정보(연결 당시 버전) 근거 연결. 해제는 기록을 남긴 채 표시만 한다. */
export interface ActionBaselineLink {
  id: string
  action_id: string
  entry_id: string
  document_id: string | null
  note: string | null
  linked_at: string
  linked_by_scope: string
  entered_by_label: string | null
  request_id: string
  removed_at: string | null
  removed_reason: string | null
  removed_request_id: string | null
}

// ── 입력 도우미 ───────────────────────────────────────────────────────
function text(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

function requireText(v: unknown, message: string, max = 2000): string {
  const t = text(v, max)
  if (!t) throw new WorkflowError(400, message)
  return t
}

/** 'YYYY-MM-DD'만 받는다. 빈 값은 null(모름) — 다른 날짜로 채우지 않는다. */
export function parseDate(v: unknown, label: string): string | null {
  const t = text(v, 20)
  if (!t) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) throw new WorkflowError(400, `${label}은(는) 날짜(YYYY-MM-DD)로 입력해 주세요.`)
  return t
}

// ── 원본 문서 등록 · 철회 ─────────────────────────────────────────────
export interface RegisterDocumentInput {
  recipientCode: string
  docType: DocumentType
  title?: string | null
  documentDate?: string | null
  sourceLabel?: string | null
  originalFilename: string
  replacesDocumentId?: string | null
  enteredByLabel?: string | null
  requestId: string
}

export interface FileFacts {
  sizeBytes: number
  sha256: string
  /** 매직 바이트로 판정한 형식. */
  detectedMime: DocumentMime | null
}

/** 파일 자체 검사(형식·크기). 서버와 데모가 같은 기준을 쓴다. */
export function checkFile(f: FileFacts): DocumentMime {
  if (f.sizeBytes <= 0) throw new WorkflowError(400, '빈 파일은 올릴 수 없습니다.')
  if (f.sizeBytes > MAX_DOCUMENT_BYTES) throw new WorkflowError(400, `파일이 너무 큽니다(${DOCUMENT_FORMAT_HINT}).`)
  if (!f.detectedMime) throw new WorkflowError(400, `지원하지 않는 파일 형식입니다(${DOCUMENT_FORMAT_HINT}).`)
  if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new WorkflowError(400, '파일 확인값이 올바르지 않습니다.')
  return f.detectedMime
}

/** 표시용 파일 이름에서 경로 구분자·제어문자를 _로 바꾼다. */
function safeFilename(name: string): string {
  return Array.from(name, (ch) => (ch.charCodeAt(0) < 32 || ch === '/' || ch === '\\' ? '_' : ch)).join('')
}

export function documentStoragePath(organizationId: string, recipientCode: string, requestId: string, mime: DocumentMime): string {
  // 요청 식별자로 경로를 정해 두면, 파일은 올라갔는데 기록 저장이 실패한 재시도도 같은 자리에 덮어써 한 벌만 남는다.
  return `${organizationId}/${recipientCode}/${requestId.replace(/[^A-Za-z0-9-]/g, '')}.${DOCUMENT_EXTENSIONS[mime]}`
}

export function planRegisterDocument(input: RegisterDocumentInput, file: FileFacts, replaced: SourceDocument | null, ctx: WorkflowContext): SourceDocument {
  const mime = checkFile(file)
  const requestId = requireText(input.requestId, '요청 식별자가 없습니다.', 200)
  if (!/^[A-Za-z0-9-]{8,80}$/.test(requestId)) throw new WorkflowError(400, '요청 식별자가 올바르지 않습니다.')
  const recipientCode = requireText(input.recipientCode, '수급자를 선택해 주세요.', 20).toUpperCase()
  if (!(DOCUMENT_TYPES as readonly string[]).includes(input.docType)) throw new WorkflowError(400, '문서 종류를 선택해 주세요.')
  if (input.replacesDocumentId) {
    if (!replaced) throw new WorkflowError(404, '교체할 이전 문서를 찾을 수 없습니다.')
    if (replaced.recipient_code !== recipientCode) throw new WorkflowError(400, '다른 수급자의 문서는 교체할 수 없습니다.')
    if (replaced.status !== 'active') throw new WorkflowError(409, '철회된 문서는 교체할 수 없습니다.')
  }
  const filename = safeFilename(requireText(input.originalFilename, '파일 이름이 없습니다.', 200))
  return {
    id: ctx.newId(),
    organization_id: ctx.organizationId,
    recipient_code: recipientCode,
    doc_type: input.docType,
    title: text(input.title, 200),
    document_date: parseDate(input.documentDate, '문서 기준일'),
    source_label: text(input.sourceLabel, 200),
    original_filename: filename,
    mime_type: mime,
    size_bytes: file.sizeBytes,
    sha256: file.sha256,
    storage_bucket: DOCUMENT_BUCKET,
    storage_path: documentStoragePath(ctx.organizationId, recipientCode, requestId, mime),
    uploaded_at: ctx.now,
    uploaded_by_scope: ADMIN_ACTOR_SCOPE,
    uploaded_by_label: text(input.enteredByLabel, 100),
    replaces_document_id: input.replacesDocumentId ? replaced!.id : null,
    status: 'active',
    withdrawn_at: null,
    withdrawn_reason: null,
    withdraw_request_id: null,
    version: 1,
    request_id: requestId,
  }
}

export interface WithdrawDocumentInput {
  documentId: string
  expectedVersion: number
  reason: string
  requestId: string
}

export function planWithdrawDocument(doc: SourceDocument, input: WithdrawDocumentInput, ctx: WorkflowContext): SourceDocument {
  if (doc.version !== input.expectedVersion) throw new WorkflowError(409, '다른 곳에서 이 문서가 먼저 바뀌었습니다. 최신 내용을 확인해 주세요.')
  if (doc.status !== 'active') throw new WorkflowError(409, '이미 철회된 문서입니다.')
  return {
    ...doc,
    status: 'withdrawn',
    withdrawn_at: ctx.now,
    withdrawn_reason: requireText(input.reason, '철회 이유를 입력해 주세요(예: 다른 수급자 문서를 잘못 올림).', 500),
    withdraw_request_id: requireText(input.requestId, '요청 식별자가 없습니다.', 200),
    version: doc.version + 1,
  }
}

// ── 기준정보 입력(새 항목·새 버전) ─────────────────────────────────────
export interface SaveEntryInput {
  recipientCode: string
  /** 기존 항목의 새 버전이면 그 항목 묶음 id와 지금 최신 버전 번호(동시 수정 확인). */
  lineageId?: string | null
  expectedLatestVersion?: number | null
  kind: EntryKind
  domain?: DomainKey | null
  statement?: string | null
  valueText?: string | null
  valueNumeric?: number | null
  unit?: string | null
  toolName?: string | null
  toolVersion?: string | null
  referenceDate?: string | null
  validUntil?: string | null
  sourceType: EntrySourceType
  documentId?: string | null
  pageRef?: string | null
  excerpt?: string | null
  sourceNote?: string | null
  enteredByLabel?: string | null
  requestId: string
}

export function planSaveEntry(input: SaveEntryInput, state: { document: SourceDocument | null; lineage: BaselineEntry[] }, ctx: WorkflowContext): BaselineEntry {
  const recipientCode = requireText(input.recipientCode, '수급자를 선택해 주세요.', 20).toUpperCase()
  if (!(ENTRY_KINDS as readonly string[]).includes(input.kind)) throw new WorkflowError(400, '기준정보 종류를 선택해 주세요.')
  const domain = input.domain ?? null
  if (domain !== null && !BASELINE_DOMAINS.includes(domain)) throw new WorkflowError(400, '세부 영역이 올바르지 않습니다.')
  const statement = text(input.statement)
  const valueText = text(input.valueText, 200)
  const valueNumeric = input.valueNumeric === null || input.valueNumeric === undefined || (input.valueNumeric as unknown) === '' ? null : Number(input.valueNumeric)
  if (valueNumeric !== null && !Number.isFinite(valueNumeric)) throw new WorkflowError(400, '측정값은 숫자로 입력해 주세요.')
  if (!statement && !valueText && valueNumeric === null) throw new WorkflowError(400, '기준 설명이나 값을 입력해 주세요(빈 항목은 저장하지 않습니다).')
  const unit = text(input.unit, 40)
  const toolName = text(input.toolName, 100)
  const toolVersion = text(input.toolVersion, 60)
  const referenceDate = parseDate(input.referenceDate, input.kind === 'scale_result' ? '측정일' : '기준일')
  const validUntil = parseDate(input.validUntil, '유효기간')
  if (referenceDate && validUntil && validUntil < referenceDate) throw new WorkflowError(400, '유효기간이 기준일보다 앞설 수 없습니다.')

  if (input.sourceType !== 'document' && input.sourceType !== 'admin_input') throw new WorkflowError(400, '출처(문서 / 관리자 입력)를 선택해 주세요.')
  const doc = state.document
  if (input.sourceType === 'document') {
    if (!doc || doc.id !== input.documentId) throw new WorkflowError(404, '근거 문서를 찾을 수 없습니다.')
    if (doc.recipient_code !== recipientCode || doc.organization_id !== ctx.organizationId) throw new WorkflowError(400, '다른 수급자의 문서는 근거로 쓸 수 없습니다.')
    if (doc.status !== 'active') throw new WorkflowError(409, '철회된 문서는 새 기준정보의 근거로 쓸 수 없습니다.')
  }
  const sourceNote = text(input.sourceNote, 500)
  if (input.kind === 'scale_result') {
    const missing = [
      !toolName && '도구명',
      !toolVersion && '버전',
      valueNumeric === null && !valueText && '측정값',
      !unit && '단위',
      !referenceDate && '측정일',
      input.sourceType !== 'document' && !sourceNote && '출처',
    ].filter(Boolean)
    if (missing.length) {
      throw new WorkflowError(400, `정식 척도는 도구명·버전·측정값·단위·측정일·출처가 모두 있을 때만 기록합니다(빠진 값: ${missing.join('·')}). 없으면 '관찰·평가 결과'나 '관리자 판단·메모'로 남겨 주세요.`)
    }
  }

  const lineage = [...state.lineage].sort((a, b) => a.version - b.version)
  const latest = lineage[lineage.length - 1] ?? null
  if (input.lineageId) {
    if (!latest || latest.lineage_id !== input.lineageId) throw new WorkflowError(404, '고칠 기준정보를 찾을 수 없습니다.')
    if (latest.version !== input.expectedLatestVersion) throw new WorkflowError(409, '다른 곳에서 이 기준정보가 먼저 수정됐습니다. 최신 내용을 확인해 주세요.')
    if (latest.status === 'retracted') throw new WorkflowError(409, '철회된 기준정보는 고칠 수 없습니다. 새 항목으로 입력해 주세요.')
    if (latest.recipient_code !== recipientCode) throw new WorkflowError(400, '다른 수급자의 기준정보입니다.')
    if (latest.kind !== input.kind) throw new WorkflowError(400, '같은 항목의 종류는 바꿀 수 없습니다. 새 항목으로 입력해 주세요.')
  }
  const id = ctx.newId()
  return {
    id,
    organization_id: ctx.organizationId,
    recipient_code: recipientCode,
    lineage_id: latest && input.lineageId ? latest.lineage_id : id,
    version: latest && input.lineageId ? latest.version + 1 : 1,
    supersedes_entry_id: latest && input.lineageId ? latest.id : null,
    kind: input.kind,
    domain,
    statement,
    value_text: valueText,
    value_numeric: valueNumeric,
    unit,
    tool_name: toolName,
    tool_version: toolVersion,
    reference_date: referenceDate,
    valid_until: validUntil,
    source_type: input.sourceType,
    document_id: input.sourceType === 'document' ? doc!.id : null,
    page_ref: input.sourceType === 'document' ? text(input.pageRef, 60) : null,
    excerpt: input.sourceType === 'document' ? text(input.excerpt, 1000) : null,
    source_note: sourceNote,
    status: 'draft',
    created_at: ctx.now,
    created_by_scope: ADMIN_ACTOR_SCOPE,
    entered_by_label: text(input.enteredByLabel, 100),
    confirmed_at: null,
    confirmed_by_label: null,
    retracted_at: null,
    retract_reason: null,
    superseded_at: null,
    status_request_id: null,
    row_version: 1,
    request_id: requireText(input.requestId, '요청 식별자가 없습니다.', 200),
  }
}

// ── 확인 · 철회 ───────────────────────────────────────────────────────
export interface SetEntryStatusInput {
  entryId: string
  status: 'confirmed' | 'retracted'
  expectedRowVersion: number
  reason?: string | null
  enteredByLabel?: string | null
  requestId: string
}

/** 확인: 최신 버전의 초안만. 확인되면 같은 항목의 이전 버전은 "이전 버전"이 된다. 철회: 잘못 입력한 값(기록은 남김). */
export function planSetEntryStatus(entry: BaselineEntry, lineage: BaselineEntry[], input: SetEntryStatusInput, ctx: WorkflowContext): BaselineEntry[] {
  if (entry.row_version !== input.expectedRowVersion) throw new WorkflowError(409, '다른 곳에서 이 기준정보가 먼저 바뀌었습니다. 최신 내용을 확인해 주세요.')
  const requestId = requireText(input.requestId, '요청 식별자가 없습니다.', 200)
  const bump = (e: BaselineEntry, patch: Partial<BaselineEntry>): BaselineEntry => ({ ...e, ...patch, row_version: e.row_version + 1 })
  if (input.status === 'confirmed') {
    if (entry.status !== 'draft') throw new WorkflowError(409, '미확인 초안만 확인할 수 있습니다.')
    if (lineage.some((e) => e.version > entry.version)) throw new WorkflowError(409, '이 항목에는 더 새 버전이 있습니다. 최신 버전을 확인해 주세요.')
    const updated = [bump(entry, { status: 'confirmed', confirmed_at: ctx.now, confirmed_by_label: text(input.enteredByLabel, 100), status_request_id: requestId })]
    for (const older of lineage.filter((e) => e.version < entry.version && !e.superseded_at)) updated.push(bump(older, { superseded_at: ctx.now }))
    return updated
  }
  if (entry.status === 'retracted') throw new WorkflowError(409, '이미 철회된 기준정보입니다.')
  if (entry.superseded_at) throw new WorkflowError(409, '이전 버전은 철회하지 않습니다(현재 버전을 확인하세요).')
  return [
    bump(entry, {
      status: 'retracted',
      retracted_at: ctx.now,
      retract_reason: requireText(input.reason, '철회 이유를 입력해 주세요.', 500),
      status_request_id: requestId,
    }),
  ]
}

/** 지금 판단 근거로 쓸 수 있는 값: 관리자 확인 · 이전 버전 아님 · 철회 아님. */
export function isEffective(e: Pick<BaselineEntry, 'status' | 'superseded_at'>): boolean {
  return e.status === 'confirmed' && !e.superseded_at
}

// ── 상충 값과 현재 참고값 ─────────────────────────────────────────────
/** 같은 항목(수급자·종류·세부 영역·척도 도구)끼리 묶는 열쇠. 관리자 메모와 영역 미지정 항목은 비교하지 않는다. */
export function groupKeyOf(e: Pick<BaselineEntry, 'kind' | 'domain' | 'tool_name'>): string | null {
  if (e.kind === 'admin_note' || !e.domain) return null
  return `${e.kind}|${e.domain}|${(e.tool_name ?? '').trim().toLowerCase()}`
}

function valueSignature(e: BaselineEntry): string {
  return [e.statement ?? '', e.value_text ?? '', e.value_numeric ?? '', e.unit ?? '', e.tool_version ?? ''].map((v) => String(v).trim().toLowerCase()).join('|')
}

export interface ChooseReferenceInput {
  entryId: string
  reason: string
  enteredByLabel?: string | null
  requestId: string
}

export function planChooseReference(entry: BaselineEntry, input: ChooseReferenceInput, ctx: WorkflowContext): ReferenceChoice {
  if (!isEffective(entry)) throw new WorkflowError(409, '관리자 확인된 현재 버전만 참고값으로 고를 수 있습니다.')
  const key = groupKeyOf(entry)
  if (!key) throw new WorkflowError(400, '세부 영역이 있는 관찰·평가·계획·척도 항목만 참고값으로 고릅니다.')
  return {
    id: ctx.newId(),
    organization_id: ctx.organizationId,
    recipient_code: entry.recipient_code,
    group_key: key,
    chosen_entry_id: entry.id,
    reason: requireText(input.reason, '이 값을 현재 참고값으로 고른 이유를 입력해 주세요.', 500),
    chosen_at: ctx.now,
    chosen_by_scope: ADMIN_ACTOR_SCOPE,
    entered_by_label: text(input.enteredByLabel, 100),
    request_id: requireText(input.requestId, '요청 식별자가 없습니다.', 200),
  }
}

// ── 조치 근거 연결 ────────────────────────────────────────────────────
export interface LinkActionInput {
  actionId: string
  entryId: string
  note?: string | null
  enteredByLabel?: string | null
  requestId: string
}

export function planLinkAction(action: CareAction, entry: BaselineEntry, activeLinks: ActionBaselineLink[], input: LinkActionInput, ctx: WorkflowContext): ActionBaselineLink {
  if (action.status !== 'draft' && action.status !== 'open') throw new WorkflowError(409, '초안·진행 중인 조치에만 근거를 연결합니다(완료·취소된 조치의 당시 근거는 그대로 남습니다).')
  if (entry.recipient_code !== action.recipient_code || entry.organization_id !== action.organization_id) throw new WorkflowError(400, '다른 수급자의 기준정보는 이 조치의 근거로 쓸 수 없습니다.')
  if (!isEffective(entry)) throw new WorkflowError(409, '관리자 확인된 현재 버전만 조치 근거로 연결합니다.')
  if (activeLinks.some((l) => l.entry_id === entry.id && !l.removed_at)) throw new WorkflowError(409, '이미 연결된 기준정보입니다.')
  return {
    id: ctx.newId(),
    action_id: action.id,
    entry_id: entry.id,
    document_id: entry.document_id,
    note: text(input.note, 500),
    linked_at: ctx.now,
    linked_by_scope: ADMIN_ACTOR_SCOPE,
    entered_by_label: text(input.enteredByLabel, 100),
    request_id: requireText(input.requestId, '요청 식별자가 없습니다.', 200),
    removed_at: null,
    removed_reason: null,
    removed_request_id: null,
  }
}

export function planUnlinkAction(action: CareAction, link: ActionBaselineLink, input: { reason: string; requestId: string }, ctx: WorkflowContext): ActionBaselineLink {
  if (link.action_id !== action.id) throw new WorkflowError(404, '연결을 찾을 수 없습니다.')
  if (action.status !== 'draft' && action.status !== 'open') throw new WorkflowError(409, '완료·취소된 조치의 근거 연결은 바꾸지 않습니다.')
  if (link.removed_at) throw new WorkflowError(409, '이미 해제된 연결입니다.')
  return { ...link, removed_at: ctx.now, removed_reason: requireText(input.reason, '해제 이유를 입력해 주세요.', 500), removed_request_id: requireText(input.requestId, '요청 식별자가 없습니다.', 200) }
}

// ── 화면용 계산 ───────────────────────────────────────────────────────
export function entryValueText(e: Pick<BaselineEntry, 'statement' | 'value_text' | 'value_numeric' | 'unit'>): string {
  const value = e.value_numeric !== null && e.value_numeric !== undefined ? String(e.value_numeric) : e.value_text
  const withUnit = value ? `${value}${e.unit ? ` ${e.unit}` : ''}` : null
  return [e.statement, withUnit].filter(Boolean).join(' · ') || '값 미기재'
}

export function domainLabel(d: DomainKey | null): string {
  return d ? DOMAIN_LABELS[d] : '영역 미지정'
}

export interface DocumentView {
  doc: SourceDocument
  /** 이 문서를 교체한 문서(없으면 null). 교체된 문서도 지우지 않는다. */
  replacedBy: string | null
  entryCount: number
}

export interface EntryLineageView {
  lineageId: string
  kind: EntryKind
  domain: DomainKey | null
  /** 가장 최근 버전(초안일 수 있음). */
  latest: BaselineEntry
  /** 지금 판단 근거로 쓸 수 있는 버전(없으면 null). */
  effective: BaselineEntry | null
  versions: BaselineEntry[]
}

export interface ConflictGroup {
  groupKey: string
  kind: EntryKind
  domain: DomainKey
  toolName: string | null
  entries: BaselineEntry[]
  chosen: ReferenceChoice | null
  /** 선택 뒤에 새로 확인된 다른 값(다시 확인 권장). */
  newerThanChoice: BaselineEntry[]
  needsConfirmation: boolean
}

export interface RecipientBaselineView {
  ready: boolean
  /** 원본 파일 저장소 준비 여부(표 준비와 별개). */
  storageReady: boolean
  recipientCode: string
  asOf: string
  documents: DocumentView[]
  lineages: EntryLineageView[]
  conflicts: ConflictGroup[]
  choices: ReferenceChoice[]
}

export function emptyBaselineView(recipientCode: string, ready: boolean, storageReady = false): RecipientBaselineView {
  return { ready, storageReady, recipientCode, asOf: new Date().toISOString(), documents: [], lineages: [], conflicts: [], choices: [] }
}

export function buildRecipientBaseline(
  recipientCode: string,
  docs: SourceDocument[],
  entries: BaselineEntry[],
  choices: ReferenceChoice[],
  opts: { storageReady: boolean; now?: Date },
): RecipientBaselineView {
  const own = entries.filter((e) => e.recipient_code === recipientCode)
  const ownDocs = docs.filter((d) => d.recipient_code === recipientCode)
  const documents: DocumentView[] = ownDocs
    .map((doc) => ({
      doc,
      replacedBy: ownDocs.find((d) => d.replaces_document_id === doc.id && d.status === 'active')?.id ?? null,
      entryCount: own.filter((e) => e.document_id === doc.id).length,
    }))
    .sort((a, b) => Date.parse(b.doc.uploaded_at) - Date.parse(a.doc.uploaded_at))

  const byLineage = new Map<string, BaselineEntry[]>()
  for (const e of own) byLineage.set(e.lineage_id, [...(byLineage.get(e.lineage_id) ?? []), e])
  const lineages: EntryLineageView[] = [...byLineage.entries()].map(([lineageId, list]) => {
    const versions = [...list].sort((a, b) => a.version - b.version)
    const latest = versions[versions.length - 1]
    return { lineageId, kind: latest.kind, domain: latest.domain, latest, effective: versions.find(isEffective) ?? null, versions }
  })
  lineages.sort((a, b) => ENTRY_KINDS.indexOf(a.kind) - ENTRY_KINDS.indexOf(b.kind) || BASELINE_DOMAINS.indexOf(a.domain as DomainKey) - BASELINE_DOMAINS.indexOf(b.domain as DomainKey) || Date.parse(a.versions[0].created_at) - Date.parse(b.versions[0].created_at))

  const ownChoices = choices.filter((c) => c.recipient_code === recipientCode).sort((a, b) => Date.parse(a.chosen_at) - Date.parse(b.chosen_at))
  const groups = new Map<string, BaselineEntry[]>()
  for (const e of own.filter(isEffective)) {
    const key = groupKeyOf(e)
    if (key) groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const conflicts: ConflictGroup[] = []
  for (const [groupKey, list] of groups) {
    if (list.length < 2 || new Set(list.map(valueSignature)).size < 2) continue // 한 값뿐이거나 출처끼리 같은 값이면 상충 아님
    const latestChoice = [...ownChoices].reverse().find((c) => c.group_key === groupKey) ?? null
    const chosen = latestChoice && list.some((e) => e.id === latestChoice.chosen_entry_id) ? latestChoice : null
    const newerThanChoice = chosen ? list.filter((e) => e.id !== chosen.chosen_entry_id && Date.parse(e.confirmed_at ?? e.created_at) > Date.parse(chosen.chosen_at)) : []
    conflicts.push({
      groupKey,
      kind: list[0].kind,
      domain: list[0].domain as DomainKey,
      toolName: list[0].tool_name,
      entries: [...list].sort((a, b) => Date.parse(a.confirmed_at ?? a.created_at) - Date.parse(b.confirmed_at ?? b.created_at)),
      chosen,
      newerThanChoice,
      needsConfirmation: !chosen || newerThanChoice.length > 0,
    })
  }
  return { ready: true, storageReady: opts.storageReady, recipientCode, asOf: (opts.now ?? new Date()).toISOString(), documents, lineages, conflicts, choices: ownChoices }
}

/** 조치 화면에 쓰는 연결 한 줄 — 연결 당시 버전과 지금 버전을 함께 보여준다. */
export interface ActionBaselineLinkView {
  link: ActionBaselineLink
  entry: BaselineEntry
  document: SourceDocument | null
  /** 같은 항목의 지금 유효 버전(없으면 철회·미확인). */
  currentEffective: BaselineEntry | null
}

export interface BaselineOption {
  entryId: string
  label: string
}

export function buildActionBaseline(actionId: string, links: ActionBaselineLink[], entries: BaselineEntry[], docs: SourceDocument[]): { links: ActionBaselineLinkView[]; options: BaselineOption[] } {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const views: ActionBaselineLinkView[] = links
    .filter((l) => l.action_id === actionId)
    .flatMap((link) => {
      const entry = byId.get(link.entry_id)
      if (!entry) return []
      return [{ link, entry, document: docs.find((d) => d.id === (link.document_id ?? entry.document_id)) ?? null, currentEffective: entries.find((e) => e.lineage_id === entry.lineage_id && isEffective(e)) ?? null }]
    })
    .sort((a, b) => Date.parse(a.link.linked_at) - Date.parse(b.link.linked_at))
  const activeIds = new Set(views.filter((v) => !v.link.removed_at).map((v) => v.entry.id))
  const options = entries
    .filter((e) => isEffective(e) && !activeIds.has(e.id))
    .map((e) => ({ entryId: e.id, label: `${ENTRY_KIND_LABELS[e.kind]} · ${domainLabel(e.domain)} · ${entryValueText(e)}${e.reference_date ? ` (${e.reference_date} 기준)` : ' (기준일 미기재)'} · v${e.version}` }))
  return { links: views, options }
}
