import { useMemo, useState } from 'react'
import type { AdminRepo } from '../shared/adminRepo'
import { WorkflowRequestError } from '../shared/adminRepo'
import { ENTRY_STATUS_LABELS, isEffective, type BaselineEntry, type RecipientBaselineView } from '../../../shared/baseline'
import {
  buildScaleEntry,
  describeChange,
  getScale,
  missingItems,
  optionsFor,
  parseScaleNote,
  RESPONDENT_LABELS,
  SCALE_SOURCE,
  SCALES,
  scaleForTool,
  scoreScale,
  scoreSummary,
  ScaleInputError,
  type ItemResponse,
  type Respondent,
} from '../../../shared/scales'

/** 표준화 척도 실시 — 종이 설문지로 실시한 응답을 문항 번호별로 입력하면 척도집 규칙대로 채점해
 * 기존 '정식 척도 결과'(기준정보)로 저장하고, 같은 척도의 측정 이력을 사전 → 사후 순으로 보여준다.
 * 문항 원문은 앱에 넣지 않는다(저작권). 점수 변화에 좋아짐/나빠짐 판정을 붙이지 않는다. */

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
const inputClass = 'w-full border border-slate-200 rounded-lg p-2 text-sm'
const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

function errorText(e: unknown): string {
  if (e instanceof WorkflowRequestError || e instanceof ScaleInputError || e instanceof Error) return e.message
  return '저장하지 못했습니다.'
}

function ScaleForm({ repo, orgId, recipientCode, onDone, onCancel }: { repo: AdminRepo; orgId: string; recipientCode: string; onDone: (v: RecipientBaselineView) => void; onCancel: () => void }) {
  const [scaleId, setScaleId] = useState(SCALES[0].id)
  const def = getScale(scaleId)!
  const [responses, setResponses] = useState<ItemResponse[]>(() => Array(def.itemCount).fill(null))
  const [respondent, setRespondent] = useState<Respondent>(def.respondents[0])
  const [measuredOn, setMeasuredOn] = useState(today)
  const [memo, setMemo] = useState('')
  const [enteredBy, setEnteredBy] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickScale = (id: string) => {
    const d = getScale(id)!
    setScaleId(id)
    setResponses(Array(d.itemCount).fill(null))
    setRespondent(d.respondents[0])
    setRequestId(newRequestId())
    setError(null)
  }
  const setItem = (i: number, v: ItemResponse) => {
    setResponses((prev) => prev.map((r, j) => (j === i ? v : r)))
    setRequestId(newRequestId())
  }
  const missing = missingItems(def, responses)
  const preview = useMemo(() => {
    if (missing.length) return null
    try {
      return scoreScale(def, responses)
    } catch {
      return null
    }
  }, [def, responses, missing.length])

  const submit = async (confirmToo: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const input = buildScaleEntry({ def, responses, measuredOn, respondent, memo }, { recipientCode, enteredByLabel: enteredBy, requestId })
      let view = await repo.baselineOp(orgId, { baselineOp: 'save_entry', ...input })
      const saved = view.lineages.flatMap((l) => l.versions).find((e) => e.request_id === requestId)
      if (confirmToo && saved && saved.status === 'draft') {
        view = await repo.baselineOp(orgId, { baselineOp: 'set_entry_status', entryId: saved.id, status: 'confirmed', expectedRowVersion: saved.row_version, enteredByLabel: enteredBy, requestId: newRequestId() })
      }
      onDone(view)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const legend = def.options.map((o) => `${o.value}=${o.label}`).join(' · ')
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3" aria-label="척도 실시 입력">
      <label className="block">
        <span className={labelClass}>척도</span>
        <select value={scaleId} onChange={(e) => pickScale(e.target.value)} className={inputClass} aria-label="척도 선택">
          {SCALES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.itemCount}문항{s.respondents[0] === 'family' ? ' · 보호자 응답' : ''})
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-lg bg-white border border-slate-200 p-2 text-[11px] text-slate-600 flex flex-col gap-0.5">
        <p>
          <span className="font-semibold text-slate-800">{def.name}</span> · 적용대상 {def.target} · {SCALE_SOURCE} {def.book[0]}~{def.book[1]}쪽
        </p>
        <p>문항 원문은 종이 설문지(척도집 해당 쪽)로 실시하고, 여기에는 설문지에 표시된 응답 번호만 입력합니다. 역문항은 앱이 척도집 규칙대로 바꿔 계산합니다.</p>
        <p>해석(척도집): {def.interpretation}</p>
        {def.cautions.map((c) => (
          <p key={c} className="text-amber-800">
            · {c}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={labelClass}>측정일</span>
          <input type="date" value={measuredOn} onChange={(e) => setMeasuredOn(e.target.value)} className={inputClass} aria-label="측정일" />
        </label>
        <label className="block">
          <span className={labelClass}>응답자</span>
          <select value={respondent} onChange={(e) => setRespondent(e.target.value as Respondent)} className={inputClass} aria-label="응답자">
            {def.respondents.map((r) => (
              <option key={r} value={r}>
                {RESPONDENT_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-1" aria-label="문항별 응답">
        <p className="text-[11px] text-slate-600">
          응답 보기: {legend}
          {def.allowNotApplicable && ' · X=해당사항 없음'}
        </p>
        <ol className="flex flex-col gap-1">
          {responses.map((r, i) => {
            const n = i + 1
            const opts = optionsFor(def, n)
            return (
              <li key={`${def.id}-${n}`} className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1 ${r === null ? 'bg-white' : 'bg-teal-50'}`}>
                <span className="w-24 shrink-0 text-xs font-bold text-slate-700">
                  {n}번{def.itemLabels ? ` ${def.itemLabels[i]}` : ''}
                  {def.reverse.includes(n) && <span className="ml-1 text-[10px] font-normal text-slate-400">역</span>}
                </span>
                <span role="radiogroup" aria-label={`${n}번 응답`} className="flex flex-wrap gap-1">
                  {opts.map((o) => (
                    <label key={o.value} className={`cursor-pointer rounded-md border px-2 py-0.5 text-xs ${r === o.value ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                      <input type="radio" className="sr-only" name={`${def.id}-${n}`} checked={r === o.value} onChange={() => setItem(i, o.value)} aria-label={`${n}번 ${o.value} ${o.label}`} />
                      {opts.length <= 2 || def.itemOptions?.[n] ? o.label : o.value}
                    </label>
                  ))}
                  {def.allowNotApplicable && (
                    <label className={`cursor-pointer rounded-md border px-2 py-0.5 text-xs ${r === 'NA' ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                      <input type="radio" className="sr-only" name={`${def.id}-${n}`} checked={r === 'NA'} onChange={() => setItem(i, 'NA')} aria-label={`${n}번 해당사항 없음`} />X
                    </label>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-2 text-sm" aria-live="polite" data-testid="scale-preview">
        {preview ? (
          <p className="text-slate-800">
            <span className="font-bold">채점 결과</span> · {scoreSummary(def, preview)}
          </p>
        ) : (
          <p className="text-slate-500">응답하지 않은 문항 {missing.length}개 — 모든 문항에 응답해야 채점합니다(빈 문항을 추정해 채우지 않습니다).</p>
        )}
      </div>
      <label className="block">
        <span className={labelClass}>메모(선택 · 예: 사전 측정, 프로그램 3개월 후)</span>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={120} className={inputClass} aria-label="척도 메모" />
      </label>
      <label className="block">
        <span className={labelClass}>실시한 확인자(선택 · 입력값이며 로그인 신원이 아님)</span>
        <input value={enteredBy} onChange={(e) => setEnteredBy(e.target.value)} placeholder="예: 담당 사회복지사" className={inputClass} />
      </label>
      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void submit(false)} disabled={saving || !preview} className="min-h-[38px] px-4 rounded-full border-2 border-slate-900 text-slate-900 text-sm font-bold disabled:opacity-40">
          미확인 초안으로 저장
        </button>
        <button onClick={() => void submit(true)} disabled={saving || !preview} className="min-h-[38px] px-4 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300">
          저장하고 관리자 확인
        </button>
        <button onClick={onCancel} disabled={saving} className="min-h-[38px] px-4 rounded-full border border-slate-300 text-sm font-bold text-slate-700">
          닫기
        </button>
      </div>
    </div>
  )
}

/** 측정일 순 점 그래프(라이브러리 없이 SVG). 확인된 값만 선으로 잇고 초안은 빈 점으로. */
function TrendChart({ points, min, max }: { points: Array<{ date: string; value: number; confirmed: boolean }>; min: number; max: number }) {
  const W = 320
  const H = 96
  const pad = { l: 28, r: 12, t: 10, b: 20 }
  const x = (i: number) => (points.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1))
  const span = max - min || 1
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b)
  const line = points.map((p, i) => ({ ...p, i })).filter((p) => p.confirmed)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm" role="img" aria-label={`측정 이력 ${points.map((p) => `${p.date} ${p.value}`).join(', ')}`}>
      <line x1={pad.l} x2={W - pad.r} y1={y(min)} y2={y(min)} stroke="#e2e8f0" />
      <line x1={pad.l} x2={W - pad.r} y1={y(max)} y2={y(max)} stroke="#e2e8f0" />
      <text x={pad.l - 4} y={y(max) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{max}</text>
      <text x={pad.l - 4} y={y(min) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{min}</text>
      {line.length > 1 && <polyline fill="none" stroke="#0f766e" strokeWidth="2" points={line.map((p) => `${x(p.i)},${y(p.value)}`).join(' ')} />}
      {points.map((p, i) => (
        <g key={`${p.date}-${i}`}>
          <circle cx={x(i)} cy={y(p.value)} r="4" fill={p.confirmed ? '#0f766e' : '#fff'} stroke="#0f766e" strokeWidth="1.5" />
          <text x={x(i)} y={y(p.value) - 7} textAnchor="middle" fontSize="10" fill="#0f172a">{p.value}</text>
          <text x={x(i)} y={H - 6} textAnchor={points.length > 1 && i === points.length - 1 ? 'end' : points.length > 1 && i === 0 ? 'start' : 'middle'} fontSize="9" fill="#64748b">{p.date.slice(2)}</text>
        </g>
      ))}
    </svg>
  )
}

function ScaleHistory({ entries }: { entries: BaselineEntry[] }) {
  const groups = new Map<string, BaselineEntry[]>()
  for (const e of entries) groups.set(`${e.tool_name}|${e.tool_version}|${e.unit}`, [...(groups.get(`${e.tool_name}|${e.tool_version}|${e.unit}`) ?? []), e])
  if (groups.size === 0) return <p className="text-xs text-slate-500">아직 측정 기록이 없습니다. 사전 측정을 먼저 입력하면 이후 측정과 나란히 보여드립니다.</p>
  return (
    <ul className="flex flex-col gap-3">
      {[...groups.values()].map((list) => {
        const sorted = [...list].sort((a, b) => (a.reference_date ?? '').localeCompare(b.reference_date ?? '') || Date.parse(a.created_at) - Date.parse(b.created_at))
        const head = sorted[0]
        const def = scaleForTool(head.tool_name)
        const points = sorted.map((e) => ({ date: e.reference_date ?? '미기재', value: Number(e.value_numeric), confirmed: isEffective(e) }))
        const confirmed = sorted.filter(isEffective)
        const values = points.map((p) => p.value)
        const sample = def ? (() => { try { return scoreScale(def, Array.from({ length: def.itemCount }, (_, i) => optionsFor(def, i + 1)[0].value)) } catch { return null } })() : null
        const lo = sample ? sample.min : Math.min(...values)
        const hi = sample ? sample.max : Math.max(...values)
        return (
          <li key={head.lineage_id} className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-1" data-testid="scale-history">
            <p className="text-sm font-bold text-slate-900">
              {def?.name ?? head.tool_name} <span className="text-[11px] font-normal text-slate-500">{head.tool_name} · {head.tool_version} · 단위 {head.unit}</span>
            </p>
            <TrendChart points={points} min={lo} max={hi} />
            <p className="text-xs text-slate-700">
              {confirmed.length >= 2
                ? describeChange(def, Number(confirmed[0].value_numeric), Number(confirmed[confirmed.length - 1].value_numeric), head.unit ?? '')
                : '관리자 확인된 측정이 2회 이상이면 첫 측정과 최근 측정을 비교해 보여드립니다.'}
            </p>
            <ul className="flex flex-col gap-0.5">
              {sorted.map((e) => {
                const note = parseScaleNote(e.source_note)
                return (
                  <li key={e.id} className="text-[11px] text-slate-600">
                    {e.reference_date} · <span className="font-semibold">{Number(e.value_numeric)}{e.unit}</span> · {e.superseded_at ? '이전 버전' : ENTRY_STATUS_LABELS[e.status]}
                    {note ? ` · ${note.respondent ?? ''}${note.memo ? ` · ${note.memo}` : ''}` : ' · 문서에서 옮긴 값'}
                  </li>
                )
              })}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

export function RecipientScaleSection({
  repo,
  orgId,
  recipientCode,
  view,
  onChanged,
}: {
  repo: AdminRepo
  orgId: string
  recipientCode: string
  view: RecipientBaselineView | null
  onChanged: (v: RecipientBaselineView) => void
}) {
  const [open, setOpen] = useState(false)
  const header = <h3 className="font-bold text-slate-900 text-sm">표준화 척도 (사전·사후 측정)</h3>
  if (!view) return null
  if (!view.ready) {
    return (
      <section className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-1" aria-label="표준화 척도">
        {header}
        <p className="text-xs text-slate-500">준비 중 — 척도 결과는 기준정보 저장소(4단계 DB 마이그레이션)에 저장되므로 그 적용 뒤에 쓸 수 있습니다.</p>
      </section>
    )
  }
  const entries = view.lineages
    .flatMap((l) => l.versions)
    .filter((e) => e.kind === 'scale_result' && e.status !== 'retracted' && !e.superseded_at && e.value_numeric !== null)
  return (
    <section className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-3" aria-label="표준화 척도">
      <div>
        {header}
        <p className="text-[11px] text-slate-500 mt-0.5">
          {SCALE_SOURCE}의 표준화 척도를 종이 설문지로 실시하고 응답 번호를 입력하면 척도집 규칙대로만 채점합니다(건강점수·등급·환산 없음). 결과는 '정식 척도 결과' 기준정보로 저장되어 아래 이력과 값 비교에 쓰입니다.
          점수 변화는 측정 오차를 포함하며 효과의 통계적 판단이 아닙니다.
        </p>
      </div>
      {!open ? (
        <button onClick={() => setOpen(true)} className="self-start min-h-[32px] px-3 rounded-full bg-slate-900 text-white text-xs font-bold">
          척도 실시 결과 입력
        </button>
      ) : (
        <ScaleForm
          repo={repo}
          orgId={orgId}
          recipientCode={recipientCode}
          onDone={(v) => {
            onChanged(v)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        />
      )}
      <ScaleHistory entries={entries} />
    </section>
  )
}
