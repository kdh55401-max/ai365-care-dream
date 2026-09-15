import { useState } from 'react'
import type { AdminRepo } from '../shared/adminRepo'
import { WorkflowRequestError } from '../shared/adminRepo'
import { DOMAIN_LABELS, type DomainKey } from '../../../shared/careTypes'
import {
  BASELINE_DOMAINS,
  DOCUMENT_FORMAT_HINT,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  domainLabel,
  ENTRY_KIND_LABELS,
  ENTRY_KINDS,
  ENTRY_STATUS_LABELS,
  entryValueText,
  MAX_DOCUMENT_BYTES,
  type BaselineEntry,
  type DocumentType,
  type EntryKind,
  type EntryLineageView,
  type EntrySourceType,
  type RecipientBaselineView,
  type SourceDocument,
} from '../../../shared/baseline'
import type { ActionDetailView } from '../../../shared/workflowViews'
import { formatKoreanDateTime } from './adminFormat'

/** 4단계 화면 — 수급자 기준문서·기준정보(원본 → 입력 → 확인 → 상충 참고값)와 조치의 근거 연결.
 * 기준정보는 선택 사항이다: 없어도 조치·현장 요청은 그대로 쓴다. 저장은 모두 요청 식별자(재시도 한 번만)와
 * 버전 대조(동시 수정)를 거치고, 실패해도 입력값을 지우지 않는다. */

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
const inputClass = 'w-full border border-slate-200 rounded-lg p-2 text-sm'
const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'

type ErrorState = { message: string; conflict: boolean } | null

function describe(e: unknown): { message: string; conflict: boolean } {
  if (e instanceof WorkflowRequestError) return { message: e.message, conflict: e.status === 409 }
  return { message: e instanceof Error ? e.message : '저장하지 못했습니다.', conflict: false }
}

function ErrorLine({ error, onReload }: { error: ErrorState; onReload?: () => void }) {
  if (!error) return null
  return (
    <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2" role="alert">
      {error.message}
      {error.conflict && onReload && (
        <button onClick={onReload} className="ml-2 font-bold underline">
          최신 내용 불러오기(입력값은 유지)
        </button>
      )}
    </p>
  )
}

function EnteredBy({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className={labelClass}>입력한 확인자(선택 · 입력값이며 로그인 신원이 아님)</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="예: 담당 사회복지사" className={inputClass} />
    </label>
  )
}

async function openOriginal(repo: AdminRepo, orgId: string, documentId: string) {
  const url = await repo.documentFileUrl(orgId, documentId)
  window.open(url, '_blank', 'noopener')
}

function docLabel(d: SourceDocument): string {
  return `${DOCUMENT_TYPE_LABELS[d.doc_type]}${d.title ? ` · ${d.title}` : ''}`
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`
}

/** 한 항목의 근거 표시 — 문서(쪽·발췌·원본 보기) 또는 관리자 입력(공식 평가 아님). */
function SourceLine({ entry, documents, repo, orgId }: { entry: BaselineEntry; documents: SourceDocument[]; repo: AdminRepo; orgId: string }) {
  if (entry.source_type === 'admin_input') {
    return (
      <p className="text-[11px] text-slate-500">
        근거: <span className="font-semibold text-slate-600">관리자 입력 — 공식 평가 결과 아님</span>
        {entry.source_note && ` · 출처 메모: ${entry.source_note}`}
      </p>
    )
  }
  const doc = documents.find((d) => d.id === entry.document_id)
  return (
    <p className="text-[11px] text-slate-500">
      근거: {doc ? docLabel(doc) : '문서'}
      {entry.page_ref && ` · ${entry.page_ref}`}
      {doc?.status === 'withdrawn' && <span className="text-red-700 font-semibold"> (근거 문서 철회됨)</span>}
      {doc && (
        <>
          {' · '}
          <button onClick={() => void openOriginal(repo, orgId, doc.id)} className="underline font-semibold text-teal-700">
            원본 보기
          </button>
        </>
      )}
      {entry.excerpt && <span className="block text-slate-600">발췌: “{entry.excerpt}”</span>}
    </p>
  )
}

// ── 원본 올리기 ──────────────────────────────────────────────────────

function UploadForm({
  repo,
  orgId,
  recipientCode,
  replaces,
  onDone,
  onCancel,
}: {
  repo: AdminRepo
  orgId: string
  recipientCode: string
  replaces: SourceDocument | null
  onDone: (v: RecipientBaselineView) => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState<DocumentType>(replaces?.doc_type ?? 'care_plan')
  const [title, setTitle] = useState(replaces?.title ?? '')
  const [documentDate, setDocumentDate] = useState('')
  const [sourceLabel, setSourceLabel] = useState(replaces?.source_label ?? '')
  const [enteredBy, setEnteredBy] = useState('')
  // 같은 파일로 다시 누르면(재시도) 같은 요청 식별자 — 파일을 바꾸면 새 식별자.
  const [requestId, setRequestId] = useState(newRequestId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ErrorState>(null)

  const pick = (f: File | null) => {
    setFile(f)
    setRequestId(newRequestId())
    setError(f && f.size > MAX_DOCUMENT_BYTES ? { message: `파일이 너무 큽니다(${DOCUMENT_FORMAT_HINT}).`, conflict: false } : null)
  }
  const submit = async () => {
    if (!file) return setError({ message: '올릴 파일을 골라 주세요.', conflict: false })
    setSaving(true)
    setError(null)
    try {
      const res = await repo.uploadDocument(orgId, { recipientCode, docType, title, documentDate: documentDate || null, sourceLabel, enteredByLabel: enteredBy, replacesDocumentId: replaces?.id ?? null, requestId }, file)
      onDone(res.baseline)
    } catch (e) {
      setError(describe(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3" aria-label="원본 문서 올리기">
      {replaces && <p className="text-[11px] text-slate-600">교체본 올리기 — 이전 문서 “{docLabel(replaces)}”와 그 문서의 기준정보·조치 근거는 지우지 않고 남깁니다.</p>}
      <label className="block">
        <span className={labelClass}>원본 파일({DOCUMENT_FORMAT_HINT}) — 관리자만 볼 수 있게 비공개로 보관</span>
        <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="text-sm" aria-label="원본 파일" />
      </label>
      {file && <p className="text-[11px] text-slate-500">{file.name} · {formatBytes(file.size)}</p>}
      <label className="block">
        <span className={labelClass}>문서 종류</span>
        <select value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} className={inputClass} aria-label="문서 종류">
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {DOCUMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>문서 제목(선택)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>문서 기준일(작성·평가 기준 날짜) — 모르면 비워 두세요(업로드일로 대신하지 않습니다)</span>
        <input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} className={inputClass} aria-label="문서 기준일" />
      </label>
      <label className="block">
        <span className={labelClass}>출처(선택 · 예: 공단 발급, 센터 작성, 보호자 제공)</span>
        <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} className={inputClass} aria-label="출처" />
      </label>
      <EnteredBy value={enteredBy} onChange={setEnteredBy} />
      <ErrorLine error={error} />
      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={saving} className="min-h-[38px] px-4 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300">
          {saving ? '올리는 중...' : error ? '같은 파일로 다시 올리기' : '올리기'}
        </button>
        <button onClick={onCancel} disabled={saving} className="min-h-[38px] px-4 rounded-full border border-slate-300 text-sm font-bold text-slate-700">
          닫기
        </button>
      </div>
    </div>
  )
}

// ── 기준정보 입력(새 항목 · 새 버전) ───────────────────────────────────

function EntryForm({
  repo,
  orgId,
  recipientCode,
  documents,
  revise,
  presetDocumentId,
  onDone,
  onCancel,
}: {
  repo: AdminRepo
  orgId: string
  recipientCode: string
  documents: SourceDocument[]
  revise: BaselineEntry | null
  presetDocumentId: string | null
  onDone: (v: RecipientBaselineView) => void
  onCancel: () => void
}) {
  const active = documents.filter((d) => d.status === 'active')
  const [kind, setKind] = useState<EntryKind>(revise?.kind ?? 'observation_assessment')
  const [domain, setDomain] = useState<string>(revise?.domain ?? '')
  const [statement, setStatement] = useState(revise?.statement ?? '')
  const [valueText, setValueText] = useState(revise?.value_text ?? '')
  const [valueNumeric, setValueNumeric] = useState(revise?.value_numeric !== null && revise?.value_numeric !== undefined ? String(revise.value_numeric) : '')
  const [unit, setUnit] = useState(revise?.unit ?? '')
  const [toolName, setToolName] = useState(revise?.tool_name ?? '')
  const [toolVersion, setToolVersion] = useState(revise?.tool_version ?? '')
  const [referenceDate, setReferenceDate] = useState(revise?.reference_date ?? '')
  const [validUntil, setValidUntil] = useState(revise?.valid_until ?? '')
  const [sourceType, setSourceType] = useState<EntrySourceType>(revise?.source_type ?? (presetDocumentId || active.length ? 'document' : 'admin_input'))
  const [documentId, setDocumentId] = useState(revise?.document_id && active.some((d) => d.id === revise.document_id) ? revise.document_id : (presetDocumentId ?? active[0]?.id ?? ''))
  const [pageRef, setPageRef] = useState(revise?.page_ref ?? '')
  const [excerpt, setExcerpt] = useState(revise?.excerpt ?? '')
  const [sourceNote, setSourceNote] = useState(revise?.source_note ?? '')
  const [enteredBy, setEnteredBy] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ErrorState>(null)
  const doc = active.find((d) => d.id === documentId) ?? null
  const scale = kind === 'scale_result'

  const submit = async (confirmToo: boolean) => {
    setSaving(true)
    setError(null)
    try {
      let view = await repo.baselineOp(orgId, {
        baselineOp: 'save_entry',
        recipientCode,
        lineageId: revise?.lineage_id ?? null,
        expectedLatestVersion: revise?.version ?? null,
        kind,
        domain: (domain || null) as DomainKey | null,
        statement,
        valueText: scale ? null : valueText,
        valueNumeric: valueNumeric.trim() === '' ? null : Number(valueNumeric),
        unit,
        toolName: scale ? toolName : null,
        toolVersion: scale ? toolVersion : null,
        referenceDate: referenceDate || null,
        validUntil: validUntil || null,
        sourceType,
        documentId: sourceType === 'document' ? documentId : null,
        pageRef,
        excerpt,
        sourceNote,
        enteredByLabel: enteredBy,
        requestId,
      })
      const saved = view.lineages.flatMap((l) => l.versions).find((e) => e.request_id === requestId)
      if (confirmToo && saved && saved.status === 'draft') {
        view = await repo.baselineOp(orgId, { baselineOp: 'set_entry_status', entryId: saved.id, status: 'confirmed', expectedRowVersion: saved.row_version, enteredByLabel: enteredBy, requestId: newRequestId() })
      }
      setRequestId(newRequestId())
      onDone(view)
    } catch (e) {
      setError(describe(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3" aria-label="기준정보 입력">
      {revise && <p className="text-[11px] text-slate-600">v{revise.version}을 고쳐 v{revise.version + 1}(미확인 초안)로 저장합니다. 이전 버전과 그 버전을 근거로 한 조치 기록은 그대로 남습니다.</p>}
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="기준정보 종류">
        <span className={labelClass}>종류</span>
        {ENTRY_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={kind === k} disabled={Boolean(revise)} onChange={() => setKind(k)} />
            {ENTRY_KIND_LABELS[k]}
          </label>
        ))}
        {kind === 'plan_goal' && <p className="text-[11px] text-amber-800">계획서의 목표·계획입니다 — 이미 관찰된 상태나 수행 완료로 보이지 않게 따로 표시합니다.</p>}
        {scale && <p className="text-[11px] text-slate-600">정식 척도는 도구명·버전·측정값·단위·측정일·출처가 모두 있을 때만 기록합니다. 점수를 계산·환산하지 않고 문서의 값을 그대로 옮깁니다.</p>}
      </div>
      <label className="block">
        <span className={labelClass}>세부 영역</span>
        <select value={domain} onChange={(e) => setDomain(e.target.value)} className={inputClass} aria-label="세부 영역">
          <option value="">영역 미지정</option>
          {BASELINE_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {DOMAIN_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>{kind === 'plan_goal' ? '계획·목표 내용' : kind === 'admin_note' ? '관리자 판단·메모' : '평소 기준 설명'}(값만 있으면 비워도 됨)</span>
        <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} className={inputClass} aria-label="기준 설명" />
      </label>
      {scale && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelClass}>도구명</span>
            <input value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="예: MMSE-K" className={inputClass} aria-label="도구명" />
          </label>
          <label className="block">
            <span className={labelClass}>버전</span>
            <input value={toolVersion} onChange={(e) => setToolVersion(e.target.value)} className={inputClass} aria-label="도구 버전" />
          </label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {scale ? (
          <label className="block">
            <span className={labelClass}>측정값(문서에 적힌 값)</span>
            <input type="number" value={valueNumeric} onChange={(e) => setValueNumeric(e.target.value)} className={inputClass} aria-label="측정값" />
          </label>
        ) : (
          <label className="block">
            <span className={labelClass}>값(선택)</span>
            <input value={valueText} onChange={(e) => setValueText(e.target.value)} placeholder="예: 2/3 공기" className={inputClass} aria-label="값" />
          </label>
        )}
        <label className="block">
          <span className={labelClass}>단위{scale ? '' : '(선택)'}</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={scale ? '예: 점' : ''} className={inputClass} aria-label="단위" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={labelClass}>{scale ? '측정일' : '기준일(모르면 비움)'}</span>
          <input type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} className={inputClass} aria-label={scale ? '측정일' : '기준일'} />
        </label>
        <label className="block">
          <span className={labelClass}>유효기간(알 때만)</span>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputClass} aria-label="유효기간" />
        </label>
      </div>
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="근거 출처">
        <span className={labelClass}>근거</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={sourceType === 'document'} disabled={active.length === 0} onChange={() => setSourceType('document')} />
          올린 원본 문서{active.length === 0 && <span className="text-[11px] text-slate-400">(올린 문서 없음)</span>}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={sourceType === 'admin_input'} onChange={() => setSourceType('admin_input')} />
          관리자 입력(문서 외 — 공식 평가 결과로 보이지 않게 표시)
        </label>
      </div>
      {sourceType === 'document' ? (
        <>
          <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} className={inputClass} aria-label="근거 문서">
            {active.map((d) => (
              <option key={d.id} value={d.id}>
                {docLabel(d)} · {d.document_date ? `${d.document_date} 기준` : '기준일 미기재'}
              </option>
            ))}
          </select>
          {doc?.document_date && !referenceDate && (
            <button type="button" onClick={() => setReferenceDate(doc.document_date!)} className="self-start text-[11px] text-teal-700 underline">
              문서 기준일({doc.document_date})을 {scale ? '측정일' : '기준일'}로 쓰기
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelClass}>쪽·위치(선택)</span>
              <input value={pageRef} onChange={(e) => setPageRef(e.target.value)} placeholder="예: 2쪽 식사 항목" className={inputClass} aria-label="쪽·위치" />
            </label>
            <label className="block">
              <span className={labelClass}>원문 발췌(선택)</span>
              <input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} className={inputClass} aria-label="원문 발췌" />
            </label>
          </div>
        </>
      ) : (
        <label className="block">
          <span className={labelClass}>출처 메모{scale ? '(필수 — 어떤 공식 결과에서 옮겼는지)' : '(선택)'}</span>
          <input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} className={inputClass} aria-label="출처 메모" />
        </label>
      )}
      <EnteredBy value={enteredBy} onChange={setEnteredBy} />
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void submit(false)} disabled={saving} className="min-h-[38px] px-4 rounded-full border-2 border-slate-900 text-slate-900 text-sm font-bold disabled:opacity-50">
          미확인 초안으로 저장
        </button>
        <button onClick={() => void submit(true)} disabled={saving} className="min-h-[38px] px-4 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300">
          저장하고 관리자 확인
        </button>
        <button onClick={onCancel} disabled={saving} className="min-h-[38px] px-4 rounded-full border border-slate-300 text-sm font-bold text-slate-700">
          닫기
        </button>
      </div>
    </div>
  )
}

// ── 수급자 기준정보 섹션 ──────────────────────────────────────────────

function StatusBadge({ e }: { e: BaselineEntry }) {
  const style = e.status === 'confirmed' ? (e.superseded_at ? 'bg-slate-100 text-slate-500' : 'bg-teal-100 text-teal-800') : e.status === 'draft' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style}`}>{e.superseded_at ? '이전 버전' : ENTRY_STATUS_LABELS[e.status]}</span>
}

function EntryText({ e }: { e: BaselineEntry }) {
  return (
    <p className="text-sm text-slate-800">
      {e.kind === 'scale_result' && <span className="font-semibold">{e.tool_name} {e.tool_version} · </span>}
      {entryValueText(e)}
      <span className="text-[11px] text-slate-500">
        {' '}
        · {e.kind === 'scale_result' ? '측정일' : '기준일'} {e.reference_date ?? '미기재'}
        {e.valid_until && ` · 유효 ${e.valid_until}까지`} · v{e.version}
      </span>
    </p>
  )
}

function LineageRow({
  l,
  documents,
  repo,
  orgId,
  onRevise,
  onChanged,
  anchorId,
}: {
  l: EntryLineageView
  documents: SourceDocument[]
  repo: AdminRepo
  orgId: string
  onRevise: (e: BaselineEntry) => void
  onChanged: (v: RecipientBaselineView) => void
  anchorId?: string
}) {
  const [retracting, setRetracting] = useState(false)
  const [reason, setReason] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const [error, setError] = useState<ErrorState>(null)
  const [saving, setSaving] = useState(false)
  const latest = l.latest
  const setStatus = async (status: 'confirmed' | 'retracted') => {
    setSaving(true)
    setError(null)
    try {
      onChanged(await repo.baselineOp(orgId, { baselineOp: 'set_entry_status', entryId: latest.id, status, expectedRowVersion: latest.row_version, reason, requestId }))
      setRequestId(newRequestId())
      setRetracting(false)
    } catch (e) {
      setError(describe(e))
    } finally {
      setSaving(false)
    }
  }
  const pendingRevision = l.effective && l.effective.id !== latest.id
  return (
    <li id={anchorId} className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-1" data-testid="baseline-entry">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-700">{domainLabel(l.domain)}</span>
        <StatusBadge e={latest} />
        {l.versions.length > 1 && <span className="text-[10px] text-slate-400">버전 {l.versions.length}개 보존</span>}
      </div>
      {pendingRevision && (
        <div className="text-[11px] text-slate-600 bg-slate-50 rounded p-1.5">
          지금 유효(관리자 확인): <EntryText e={l.effective!} />
          <span className="text-amber-800">아래 수정 초안은 확인 전이라 판단 근거로 쓰이지 않습니다.</span>
        </div>
      )}
      <EntryText e={latest} />
      <SourceLine entry={latest} documents={documents} repo={repo} orgId={orgId} />
      <p className="text-[10px] text-slate-400">
        입력 {formatKoreanDateTime(latest.created_at)}
        {latest.entered_by_label && ` · 입력한 확인자 ${latest.entered_by_label}`}
        {latest.confirmed_at && ` · 확인 ${formatKoreanDateTime(latest.confirmed_at)}`}
        {latest.retracted_at && ` · 철회 ${formatKoreanDateTime(latest.retracted_at)}: ${latest.retract_reason}`}
      </p>
      {l.versions.length > 1 && (
        <details>
          <summary className="text-[11px] text-slate-500 cursor-pointer">이전 버전 보기</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {l.versions
              .filter((v) => v.id !== latest.id)
              .map((v) => (
                <li key={v.id} className="text-[11px] text-slate-500 border-l-2 border-slate-200 pl-2">
                  <StatusBadge e={v} /> <EntryText e={v} />
                </li>
              ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2 mt-1">
        {latest.status === 'draft' && (
          <button onClick={() => void setStatus('confirmed')} disabled={saving} className="min-h-[32px] px-3 rounded-full bg-teal-600 text-white text-xs font-bold disabled:bg-slate-300">
            관리자 확인
          </button>
        )}
        {latest.status !== 'retracted' && (
          <button onClick={() => onRevise(latest)} className="min-h-[32px] px-3 rounded-full border border-slate-300 text-xs font-bold text-slate-700">
            고치기(새 버전)
          </button>
        )}
        {latest.status !== 'retracted' && !latest.superseded_at && (
          <button onClick={() => setRetracting((v) => !v)} className="min-h-[32px] px-3 rounded-full border border-red-300 text-xs font-bold text-red-700">
            철회
          </button>
        )}
      </div>
      {retracting && (
        <div className="flex flex-col gap-1">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="철회 이유(필수 — 예: 다른 수급자 문서를 보고 입력함)" className={inputClass} aria-label="철회 이유" />
          <button onClick={() => void setStatus('retracted')} disabled={saving} className="self-start min-h-[32px] px-3 rounded-full bg-red-600 text-white text-xs font-bold disabled:bg-slate-300">
            철회 기록
          </button>
        </div>
      )}
      <ErrorLine error={error} />
    </li>
  )
}

function ConflictBox({ view, repo, orgId, onChanged }: { view: RecipientBaselineView; repo: AdminRepo; orgId: string; onChanged: (v: RecipientBaselineView) => void }) {
  const [choosing, setChoosing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const [error, setError] = useState<ErrorState>(null)
  if (view.conflicts.length === 0) return null
  const docs = view.documents.map((d) => d.doc)
  const choose = async (entryId: string) => {
    setError(null)
    try {
      onChanged(await repo.baselineOp(orgId, { baselineOp: 'choose_reference', entryId, reason, requestId }))
      setChoosing(null)
      setReason('')
      setRequestId(newRequestId())
    } catch (e) {
      setError(describe(e))
    }
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex flex-col gap-2" aria-label="상충하는 기준값">
      <p className="text-sm font-bold text-amber-900">같은 항목에 출처가 다른 값이 있습니다 — 최신 업로드로 덮어쓰지 않고 모두 보존합니다</p>
      {view.conflicts.map((c) => (
        <div key={c.groupKey} className="rounded-lg bg-white border border-amber-100 p-2">
          <p className="text-xs font-bold text-slate-800">
            {domainLabel(c.domain)} · {ENTRY_KIND_LABELS[c.kind]}
            {c.toolName ? ` · ${c.toolName}` : ''}{' '}
            {c.needsConfirmation ? (
              <span className="text-amber-800">— 현재 참고값 확인 필요</span>
            ) : (
              <span className="text-teal-700">— 현재 참고값 선택됨({formatKoreanDateTime(c.chosen?.chosen_at)} · 이유: {c.chosen?.reason})</span>
            )}
          </p>
          {c.newerThanChoice.length > 0 && <p className="text-[11px] text-amber-800">선택 뒤 새로 확인된 다른 값 {c.newerThanChoice.length}건 — 다시 확인해 주세요.</p>}
          <ul className="mt-1 flex flex-col gap-1">
            {c.entries.map((e) => (
              <li key={e.id} className="text-sm">
                {c.chosen?.chosen_entry_id === e.id && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 mr-1">현재 참고값</span>}
                <EntryText e={e} />
                <SourceLine entry={e} documents={docs} repo={repo} orgId={orgId} />
                {c.chosen?.chosen_entry_id !== e.id && (
                  <button onClick={() => setChoosing(choosing === e.id ? null : e.id)} className="text-[11px] font-bold text-teal-700 underline">
                    이 값을 현재 참고값으로
                  </button>
                )}
                {choosing === e.id && (
                  <div className="flex flex-col gap-1 mt-1">
                    <input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="고른 이유(필수 — 예: 공단 평가가 더 최근)" className={inputClass} aria-label="참고값 선택 이유" />
                    <button onClick={() => void choose(e.id)} className="self-start min-h-[32px] px-3 rounded-full bg-slate-900 text-white text-xs font-bold">
                      참고값 선택 기록
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <ErrorLine error={error} />
    </div>
  )
}

export function RecipientBaselineSection({
  repo,
  orgId,
  recipientCode,
  view,
  error,
  onChanged,
  onReload,
}: {
  repo: AdminRepo
  orgId: string
  recipientCode: string
  view: RecipientBaselineView | null
  error: string | null
  onChanged: (v: RecipientBaselineView) => void
  onReload: () => void
}) {
  const [uploading, setUploading] = useState<{ replaces: SourceDocument | null } | null>(null)
  const [entryForm, setEntryForm] = useState<{ revise: BaselineEntry | null; documentId: string | null } | null>(null)
  const [withdrawing, setWithdrawing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const [opError, setOpError] = useState<ErrorState>(null)

  const header = <h3 className="font-bold text-slate-900 text-sm">기준문서 · 기준정보</h3>
  if (error) {
    return (
      <section id="baseline" className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-2">
        {header}
        <p className="text-xs text-red-700">불러오기 실패: {error} <button onClick={onReload} className="underline font-bold">다시 불러오기</button></p>
      </section>
    )
  }
  if (!view) {
    return (
      <section id="baseline" className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4">
        {header}
        <p className="text-xs text-slate-400">불러오는 중…</p>
      </section>
    )
  }
  if (!view.ready) {
    return (
      <section id="baseline" className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-1">
        {header}
        <p className="text-xs text-slate-500">준비 중 — 기준정보 저장소(4단계 DB 마이그레이션)가 적용되기 전입니다. 기존 조치·현장 요청은 그대로 쓸 수 있습니다.</p>
      </section>
    )
  }
  const documents = view.documents.map((d) => d.doc)
  const empty = view.documents.length === 0 && view.lineages.length === 0
  const withdraw = async (doc: SourceDocument) => {
    setOpError(null)
    try {
      onChanged(await repo.baselineOp(orgId, { baselineOp: 'withdraw_document', documentId: doc.id, expectedVersion: doc.version, reason, requestId }))
      setWithdrawing(null)
      setReason('')
      setRequestId(newRequestId())
    } catch (e) {
      setOpError(describe(e))
    }
  }
  const seenDomains = new Set<string>()
  return (
    <section id="baseline" className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-3" aria-label="기준문서 · 기준정보">
      <div>
        {header}
        <p className="text-[11px] text-slate-500 mt-0.5">
          관리자가 원본 문서를 보고 입력·확인한 값입니다. 일일 보고를 기준정보로 자동으로 올리지 않고, 계획·목표를 관찰된 상태로 쓰지 않으며, 점수를 계산하지 않습니다. 기준정보는 선택 사항입니다.
        </p>
      </div>
      {empty && (
        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">
          기준정보 미등록 — 데이터 상태이며 건강 위험 신호가 아닙니다. 기존 조치·현장 요청은 그대로 쓸 수 있습니다.
        </p>
      )}

      <ConflictBox view={view} repo={repo} orgId={orgId} onChanged={onChanged} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-bold text-slate-700">원본 문서 ({view.documents.length}건)</h4>
          {view.storageReady ? (
            <button onClick={() => setUploading({ replaces: null })} className="min-h-[32px] px-3 rounded-full bg-slate-900 text-white text-xs font-bold">
              문서 올리기
            </button>
          ) : (
            <span className="text-[11px] text-slate-500">원본 파일 저장소(비공개 버킷) 준비 전 — 올리기는 준비 중, 관리자 입력 기준정보는 쓸 수 있음</span>
          )}
        </div>
        {uploading && (
          <UploadForm
            repo={repo}
            orgId={orgId}
            recipientCode={recipientCode}
            replaces={uploading.replaces}
            onDone={(v) => {
              onChanged(v)
              setUploading(null)
            }}
            onCancel={() => setUploading(null)}
          />
        )}
        <ul className="flex flex-col gap-2">
          {view.documents.map(({ doc, replacedBy, entryCount }) => (
            <li key={doc.id} className={`rounded-xl border p-3 ${doc.status === 'withdrawn' ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`} data-testid="source-document">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{docLabel(doc)}</span>
                {doc.status === 'withdrawn' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">철회됨</span>}
                {replacedBy && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">교체됨(새 문서 있음)</span>}
                {doc.replaces_document_id && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">교체본</span>}
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                문서 기준일 {doc.document_date ?? '미기재'} · 업로드 {formatKoreanDateTime(doc.uploaded_at)} · 출처 {doc.source_label ?? '미기재'}
                {doc.uploaded_by_label && ` · 올린 확인자 ${doc.uploaded_by_label}(입력값)`}
              </p>
              <p className="text-[11px] text-slate-400">
                {doc.original_filename} · {formatBytes(doc.size_bytes)} · 이 문서 근거 기준정보 {entryCount}건
                {doc.withdrawn_reason && ` · 철회 이유: ${doc.withdrawn_reason}`}
              </p>
              <div className="flex flex-wrap gap-2 mt-1.5">
                <button onClick={() => void openOriginal(repo, orgId, doc.id)} className="min-h-[32px] px-3 rounded-full border border-slate-300 text-xs font-bold text-slate-700">
                  원본 보기
                </button>
                {doc.status === 'active' && (
                  <>
                    <button onClick={() => setEntryForm({ revise: null, documentId: doc.id })} className="min-h-[32px] px-3 rounded-full border border-slate-300 text-xs font-bold text-slate-700">
                      이 문서로 기준정보 입력
                    </button>
                    {view.storageReady && (
                      <button onClick={() => setUploading({ replaces: doc })} className="min-h-[32px] px-3 rounded-full border border-slate-300 text-xs font-bold text-slate-700">
                        교체본 올리기
                      </button>
                    )}
                    <button onClick={() => setWithdrawing(withdrawing === doc.id ? null : doc.id)} className="min-h-[32px] px-3 rounded-full border border-red-300 text-xs font-bold text-red-700">
                      철회
                    </button>
                  </>
                )}
              </div>
              {withdrawing === doc.id && (
                <div className="flex flex-col gap-1 mt-1">
                  <p className="text-[11px] text-slate-500">철회해도 원본과 이 문서를 근거로 한 기준정보·조치 기록은 지우지 않습니다. 새 기준정보의 근거로만 쓰지 않습니다.</p>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="철회 이유(필수)" className={inputClass} aria-label="문서 철회 이유" />
                  <button onClick={() => void withdraw(doc)} className="self-start min-h-[32px] px-3 rounded-full bg-red-600 text-white text-xs font-bold">
                    철회 기록
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <ErrorLine error={opError} onReload={onReload} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-bold text-slate-700">기준정보 (항목 {view.lineages.length}개)</h4>
          <button onClick={() => setEntryForm({ revise: null, documentId: null })} className="min-h-[32px] px-3 rounded-full border-2 border-slate-900 text-xs font-bold text-slate-900">
            기준정보 입력
          </button>
        </div>
        {entryForm && (
          <EntryForm
            key={`${entryForm.revise?.id ?? 'new'}-${entryForm.documentId ?? ''}`}
            repo={repo}
            orgId={orgId}
            recipientCode={recipientCode}
            documents={documents}
            revise={entryForm.revise}
            presetDocumentId={entryForm.documentId}
            onDone={(v) => {
              onChanged(v)
              setEntryForm(null)
            }}
            onCancel={() => setEntryForm(null)}
          />
        )}
        {ENTRY_KINDS.map((kind) => {
          const list = view.lineages.filter((l) => l.kind === kind)
          if (list.length === 0) return null
          return (
            <div key={kind}>
              <p className="text-[11px] font-bold text-slate-500 mb-1">{ENTRY_KIND_LABELS[kind]}</p>
              <ul className="flex flex-col gap-2">
                {list.map((l) => {
                  const anchor = l.domain && !seenDomains.has(l.domain) && l.effective ? `baseline-domain-${l.domain}` : undefined
                  if (anchor) seenDomains.add(l.domain as string)
                  return (
                    <LineageRow
                      key={l.lineageId}
                      l={l}
                      documents={documents}
                      repo={repo}
                      orgId={orgId}
                      onRevise={(e) => setEntryForm({ revise: e, documentId: e.document_id })}
                      onChanged={onChanged}
                      anchorId={anchor}
                    />
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── 조치의 근거 기준정보 ──────────────────────────────────────────────

export function ActionBaselineSection({
  repo,
  orgId,
  view,
  onUpdated,
  onOpenRecipient,
}: {
  repo: AdminRepo
  orgId: string
  view: ActionDetailView
  onUpdated: (v: ActionDetailView) => void
  onOpenRecipient: (code: string) => void
}) {
  const [entryId, setEntryId] = useState('')
  const [note, setNote] = useState('')
  const [enteredBy, setEnteredBy] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ErrorState>(null)
  const { action } = view
  const editable = action.status === 'draft' || action.status === 'open'
  const run = async (fn: () => Promise<ActionDetailView>) => {
    setSaving(true)
    setError(null)
    try {
      onUpdated(await fn())
      setRequestId(newRequestId())
      setEntryId('')
      setNote('')
      setUnlinking(null)
      setReason('')
    } catch (e) {
      setError(describe(e))
    } finally {
      setSaving(false)
    }
  }
  const active = view.baselineLinks.filter((l) => !l.link.removed_at)
  const removed = view.baselineLinks.filter((l) => l.link.removed_at)
  return (
    <section className="rounded-2xl bg-white border border-slate-100 p-4 flex flex-col gap-2" aria-label="근거 기준정보">
      <h3 className="font-bold text-slate-900">근거 기준정보 (선택)</h3>
      {!view.baselineReady ? (
        <p className="text-sm text-slate-500">준비 중 — 기준정보 저장소(4단계 DB 마이그레이션)가 적용되기 전입니다. 조치는 기준정보 없이도 그대로 진행됩니다.</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">조치를 판단할 때 참고한 확인된 기준정보를 연결합니다. 연결은 그때의 버전을 가리키므로 나중에 기준정보·문서가 바뀌어도 당시 근거가 남습니다. 모든 조치에 필요하지는 않습니다.</p>
          {active.length === 0 && <p className="text-sm text-slate-500">연결된 기준정보 없음</p>}
          <ul className="flex flex-col gap-2">
            {active.map(({ link, entry, document, currentEffective }) => (
              <li key={link.id} className="rounded-xl border border-slate-200 p-2" data-testid="action-baseline-link">
                <p className="text-xs font-bold text-slate-700">
                  {ENTRY_KIND_LABELS[entry.kind]} · {domainLabel(entry.domain)} · 연결 당시 v{entry.version}
                </p>
                <EntryText e={entry} />
                {document ? (
                  <p className="text-[11px] text-slate-500">
                    근거 문서: {docLabel(document)}
                    {entry.page_ref && ` · ${entry.page_ref}`}
                    {document.status === 'withdrawn' && <span className="text-red-700 font-semibold"> (이후 철회됨)</span>}{' '}
                    <button onClick={() => void openOriginal(repo, orgId, document.id)} className="underline font-semibold text-teal-700">
                      원본 보기
                    </button>
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500">근거: 관리자 입력 — 공식 평가 결과 아님</p>
                )}
                {currentEffective && currentEffective.id !== entry.id && (
                  <p className="text-[11px] text-amber-800">이후 v{currentEffective.version}로 수정·확인됨: {entryValueText(currentEffective)} — 이 조치의 판단 당시 값은 위(v{entry.version})입니다.</p>
                )}
                {!currentEffective && <p className="text-[11px] text-amber-800">이 항목에는 지금 유효한 확인 값이 없습니다(철회 또는 수정 초안 확인 전).</p>}
                <p className="text-[10px] text-slate-400">
                  연결 {formatKoreanDateTime(link.linked_at)}
                  {link.note && ` · 메모: ${link.note}`}
                  {link.entered_by_label && ` · 입력한 확인자 ${link.entered_by_label}`}
                </p>
                {editable && (
                  <button onClick={() => setUnlinking(unlinking === link.id ? null : link.id)} className="text-[11px] font-bold text-red-700 underline">
                    연결 해제
                  </button>
                )}
                {unlinking === link.id && (
                  <div className="flex flex-col gap-1 mt-1">
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="해제 이유(필수)" className={inputClass} aria-label="연결 해제 이유" />
                    <button
                      onClick={() => void run(() => repo.unlinkActionBaseline(orgId, { actionId: action.id, linkId: link.id, reason, requestId, enteredByLabel: enteredBy }))}
                      disabled={saving}
                      className="self-start min-h-[32px] px-3 rounded-full bg-red-600 text-white text-xs font-bold disabled:bg-slate-300"
                    >
                      해제 기록
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {removed.length > 0 && (
            <details>
              <summary className="text-[11px] text-slate-500 cursor-pointer">해제된 연결 {removed.length}건(기록 보존)</summary>
              <ul className="mt-1 text-[11px] text-slate-500">
                {removed.map(({ link, entry }) => (
                  <li key={link.id}>
                    {domainLabel(entry.domain)} · {entryValueText(entry)} · v{entry.version} · 해제 {formatKoreanDateTime(link.removed_at)}: {link.removed_reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {editable &&
            (view.baselineOptions.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                연결할 확인된 기준정보가 없습니다(선택 사항).{' '}
                <button onClick={() => onOpenRecipient(action.recipient_code)} className="underline">
                  수급자 {action.recipient_code} 화면에서 입력·확인
                </button>
              </p>
            ) : (
              <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
                <label className="block">
                  <span className={labelClass}>근거로 연결할 기준정보(관리자 확인된 현재 버전)</span>
                  <select value={entryId} onChange={(e) => setEntryId(e.target.value)} className={inputClass} aria-label="근거로 연결할 기준정보">
                    <option value="">선택</option>
                    {view.baselineOptions.map((o) => (
                      <option key={o.entryId} value={o.entryId}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모(선택 — 어떻게 참고했는지)" className={inputClass} aria-label="연결 메모" />
                <EnteredBy value={enteredBy} onChange={setEnteredBy} />
                <button
                  onClick={() => void run(() => repo.linkActionBaseline(orgId, { actionId: action.id, entryId, note, enteredByLabel: enteredBy, requestId }))}
                  disabled={saving || !entryId}
                  className="self-start min-h-[36px] px-4 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300"
                >
                  근거로 연결
                </button>
              </div>
            ))}
          <ErrorLine error={error} />
        </>
      )}
    </section>
  )
}
