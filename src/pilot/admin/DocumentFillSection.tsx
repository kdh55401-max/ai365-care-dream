import { useRef, useState } from 'react'
import type { AdminRepo } from '../shared/adminRepo'
import { MAX_DOCUMENT_BYTES } from '../../../shared/baseline'
import { DOC_KIND_LABELS, applyExtraction, mergeExtractions, type AppliedExtraction, type ExtractionConflict, type FileExtraction, type MergedExtraction, type ProfileField } from '../../../shared/profileExtraction'
import type { RecipientProfile } from '../../../shared/recipientAdmin'

/** ERP 3단계 — "서류로 채우기". 수급자 등록 폼 안에서 서류(인정서·이용계획서 등)를 올리면 AI가 읽어 인적사항 칸을 채운다.
 * AI는 제안만 한다: 비어 있는 칸만 채우고(입력한 값은 그대로), 서류끼리 값이 다르면 칸을 채우지 않고 충돌로 보여 주며,
 * 저장은 관리자가 칸을 확인하고 '저장'을 눌러야 한다. 서류 한 장 = AI 한 번 호출이며, 쓴 토큰을 그대로 보여 준다. */

export interface AttachedDoc {
  id: string
  file: File
  status: 'wait' | 'reading' | 'done' | 'error'
  extraction?: FileExtraction
  error?: string
}

export interface FillReport {
  documents: number
  filled: number
  conflicts: ExtractionConflict[]
  keptDifferent: AppliedExtraction['keptDifferent']
  rejected: MergedExtraction['rejected']
  tokens: { prompt: number; output: number } | null
  simulated: boolean
}

const MAX_FILES = 6
const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`)

function problemWith(file: File): string | null {
  if (file.size <= 0) return '빈 파일입니다.'
  if (file.size > MAX_DOCUMENT_BYTES) return '파일이 너무 큽니다(4MB 이하).'
  if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) return 'PDF·JPG·PNG 파일만 올릴 수 있습니다.'
  return null
}

export function DocumentFillSection({
  repo,
  docs,
  setDocs,
  getProfile,
  onApply,
  report,
  setReport,
  disabled,
}: {
  repo: AdminRepo
  docs: AttachedDoc[]
  setDocs: (update: (prev: AttachedDoc[]) => AttachedDoc[]) => void
  getProfile: () => RecipientProfile
  onApply: (profile: RecipientProfile, filled: ProfileField[]) => void
  report: FillReport | null
  setReport: (r: FillReport | null) => void
  disabled: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const readingRef = useRef(false)
  const reading = docs.some((d) => d.status === 'reading')
  const todo = docs.filter((d) => d.status === 'wait' || d.status === 'error')
  const [problems, setProblems] = useState<string[]>([])

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const problems: string[] = []
    const accepted: AttachedDoc[] = []
    for (const file of Array.from(list)) {
      const problem = problemWith(file)
      if (problem) problems.push(`${file.name}: ${problem}`)
      else accepted.push({ id: newId(), file, status: 'wait' })
    }
    setDocs((prev) => {
      const room = Math.max(0, MAX_FILES - prev.length)
      if (accepted.length > room) problems.push(`한 번에 ${MAX_FILES}장까지 올릴 수 있습니다.`)
      return [...prev, ...accepted.slice(0, room)]
    })
    setProblems(problems)
    if (inputRef.current) inputRef.current.value = ''
  }

  const readAll = async () => {
    if (readingRef.current || todo.length === 0) return
    readingRef.current = true
    setReport(null)
    setProblems([])
    const results = new Map<string, FileExtraction>()
    for (const d of docs) if (d.status === 'done' && d.extraction) results.set(d.id, d.extraction)
    for (const d of todo) {
      setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, status: 'reading', error: undefined } : x)))
      try {
        const extraction = await repo.extractProfile(d.file)
        results.set(d.id, extraction)
        setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, status: 'done', extraction } : x)))
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : '서류를 읽지 못했습니다.'
        setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, status: 'error', error: message } : x)))
      }
    }
    const extractions = docs.map((d) => results.get(d.id)).filter((x): x is FileExtraction => Boolean(x))
    if (extractions.length > 0) {
      const merged = mergeExtractions(extractions)
      const applied = applyExtraction(getProfile(), merged)
      onApply(applied.profile, applied.filled)
      const withUsage = extractions.filter((x) => x.usage)
      setReport({
        documents: extractions.length,
        filled: applied.filled.length,
        conflicts: merged.conflicts,
        keptDifferent: applied.keptDifferent,
        rejected: merged.rejected,
        tokens: withUsage.length ? { prompt: withUsage.reduce((n, x) => n + (x.usage?.promptTokens ?? 0), 0), output: withUsage.reduce((n, x) => n + (x.usage?.outputTokens ?? 0), 0) } : null,
        simulated: extractions.some((x) => x.simulated),
      })
    }
    readingRef.current = false
  }

  return (
    <section aria-label="서류로 채우기" className="rounded-2xl border border-sky-200 bg-sky-50/60 p-3 flex flex-col gap-3">
      <div>
        <h4 className="text-sm font-bold text-slate-900">서류로 채우기 <span className="font-normal text-slate-500">(선택)</span></h4>
        <p className="text-xs text-slate-600 mt-0.5">인정서·이용계획서 등 서류 사진이나 PDF를 올리면 AI가 읽어 아래 인적사항 칸을 채웁니다. 이미 입력한 칸은 건드리지 않고, 저장은 직접 확인한 뒤에만 됩니다.</p>
        <p className="text-[11px] text-slate-500 mt-1">올린 서류는 AI 서버로 전송되며, 서류 한 장당 AI를 한 번 호출합니다(PDF·JPG·PNG, 4MB 이하, 최대 {MAX_FILES}장).</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        aria-label="서류 파일 선택"
        disabled={disabled || reading}
        onChange={(e) => addFiles(e.target.files)}
        className="text-sm file:mr-3 file:min-h-[40px] file:rounded-full file:border-0 file:bg-sky-600 file:px-4 file:font-bold file:text-white"
      />

      {docs.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="올린 서류">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-bold text-slate-800">{d.file.name}</p>
                <p className="text-xs text-slate-500">
                  {d.status === 'wait' && '읽기 전'}
                  {d.status === 'reading' && '읽는 중…'}
                  {d.status === 'done' && d.extraction && `읽음 · ${DOC_KIND_LABELS[d.extraction.docKind]} · ${Object.keys(d.extraction.fields).length}칸`}
                  {d.status === 'error' && <span className="text-red-700">읽지 못함 — {d.error}</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDocs((prev) => prev.filter((x) => x.id !== d.id))}
                disabled={disabled || d.status === 'reading'}
                aria-label={`${d.file.name} 빼기`}
                className="shrink-0 min-h-[36px] px-3 rounded-full border border-slate-300 text-xs font-bold text-slate-600 disabled:opacity-40"
              >
                빼기
              </button>
            </li>
          ))}
        </ul>
      )}

      {docs.length > 0 && (
        <button
          type="button"
          onClick={() => void readAll()}
          disabled={disabled || reading || todo.length === 0}
          className="min-h-[48px] rounded-full bg-sky-600 text-white font-bold disabled:opacity-40"
        >
          {reading ? '서류를 읽는 중…' : todo.length === 0 ? '모두 읽었습니다' : `AI로 읽어서 채우기 (${todo.length}장)`}
        </button>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="text-xs text-red-700 list-disc pl-4">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {report && report.documents > 0 && (
        <div role="status" aria-label="AI가 읽은 결과" className="rounded-xl bg-white border border-sky-200 p-3 text-sm flex flex-col gap-2">
          <p className="font-bold text-slate-900">
            서류 {report.documents}장을 읽어 {report.filled}칸을 채웠습니다. <span className="font-normal text-slate-500">서류와 맞는지 꼭 확인한 뒤 저장하세요.</span>
          </p>
          {report.conflicts.map((c) => (
            <div key={c.field} className={`rounded-lg border px-3 py-2 text-xs ${c.identity ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
              <p className="font-bold">
                {c.identity ? '서로 다른 사람의 서류가 섞였을 수 있습니다 — ' : '서류마다 값이 다릅니다 — '}
                {c.label}
              </p>
              <ul className="mt-0.5">
                {c.values.map((v) => (
                  <li key={`${v.source}-${v.value}`}>
                    {v.value} <span className="opacity-70">· {v.source}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-0.5 opacity-80">이 칸은 채우지 않았습니다. 서류 원본을 보고 직접 입력해 주세요.</p>
            </div>
          ))}
          {report.keptDifferent.map((k) => (
            <p key={k.field} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
              <b>{k.label}</b>: 입력하신 값(<b>{k.entered}</b>)과 서류에서 읽은 값(<b>{k.suggested}</b>)이 다릅니다. 입력하신 값을 그대로 두었습니다.
            </p>
          ))}
          {report.rejected.map((r) => (
            <p key={`${r.field}-${r.source}`} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">
              <b>{r.label}</b>: 서류에서 &lsquo;{r.value}&rsquo;으로 읽었지만 채우지 않았습니다 — {r.reason}
            </p>
          ))}
          <p className="text-[11px] text-slate-500">
            {report.simulated
              ? '데모: 실제 AI를 호출하지 않은 가상 결과입니다.'
              : report.tokens
                ? `이번 읽기에 쓴 AI 토큰: 입력 ${report.tokens.prompt.toLocaleString()} · 출력 ${report.tokens.output.toLocaleString()}`
                : ''}
          </p>
        </div>
      )}
    </section>
  )
}
