import { useEffect, useState } from 'react'
import type { AdminRepo } from '../shared/adminRepo'
import { WorkflowRequestError } from '../shared/adminRepo'
import { DOMAIN_LABELS, type DomainKey } from '../../../shared/careTypes'
import { OBSERVATION_STATUS_LABELS } from '../../../shared/recipientHub'
import { CELL_STATE_DISPLAY, CELL_STATE_ORDER, INITIAL_CHOICE_LABELS, type CalendarCell, type CalendarWindow } from '../../../shared/observationCalendar'
import {
  CANDIDATE_DECISION_LABELS,
  CANDIDATE_DECISIONS,
  REPEAT_RULE,
  VALUE_RULE,
  type CandidateDecision,
  type CandidateReview,
  type CandidateReviewState,
} from '../../../shared/changeCandidates'
import type { OpenActionBrief, RecipientObservationsView } from '../../../shared/observationViews'
import { formatKoreanDateTime } from './adminFormat'

/** 5단계 화면 — 관찰 달력(7·30일, 보고일 기준)과 날짜별 원문 근거, 반복 보고 후보(초기 운영 규칙 v1), 비교 가능한 값 차이,
 * 후보에 대한 관리자 판단(기존 조치 연결). 숫자 없는 관찰을 점수·그래프로 바꾸지 않는다. */

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
const inputClass = 'w-full border border-slate-200 rounded-lg p-2 text-sm'
const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${WEEKDAYS[d.getUTCDay()]})`
}

const CELL_STYLE: Record<string, string> = {
  changed: 'bg-amber-100 text-amber-900 border-amber-300',
  same_as_usual: 'bg-teal-50 text-teal-800 border-teal-200',
  mixed: 'bg-violet-100 text-violet-900 border-violet-300',
  not_observed: 'bg-slate-100 text-slate-600 border-slate-200',
  uncertain: 'bg-slate-100 text-slate-700 border-slate-300',
  not_mentioned: 'bg-white text-slate-400 border-slate-200',
  not_stored: 'bg-white text-slate-300 border-dashed border-slate-200',
  no_report: 'bg-slate-50 text-slate-300 border-transparent',
}

function reviewSummary(r: CandidateReview): string {
  return `${CANDIDATE_DECISION_LABELS[r.decision]} · ${formatKoreanDateTime(r.reviewed_at)} · 근거: ${r.reason}${r.entered_by_label ? ` · 입력한 확인자 ${r.entered_by_label}` : ''}`
}

function candidateLabel(r: Pick<CandidateReview, 'candidate_kind' | 'domain'>): string {
  return r.candidate_kind === 'repeat_changed' ? `${r.domain ? DOMAIN_LABELS[r.domain as DomainKey] : '영역'} 변화 반복 보고(보고일 기준)` : '정식 척도 값 차이'
}

function ReviewStateLine({ state }: { state: CandidateReviewState }) {
  return (
    <div className="text-[11px] flex flex-col gap-0.5">
      {state.latest ? (
        <p className="text-slate-700">
          관리자 판단: <span className="font-bold">{reviewSummary(state.latest)}</span>
          {state.latest.linked_action_id && <span> · 조치 연결됨</span>}
          {state.history.length > 1 && <span className="text-slate-400"> · 이전 판단 {state.history.length - 1}건 보존</span>}
        </p>
      ) : (
        <p className="text-slate-500">관리자 판단 없음</p>
      )}
      {state.newEvidenceSinceReview > 0 && <p className="text-amber-800">판단 뒤 새 근거 보고 {state.newEvidenceSinceReview}건 — 판단을 자동으로 바꾸지 않았습니다. 다시 확인해 주세요.</p>}
      {state.recheckReasons.map((r) => (
        <p key={r} className="text-red-700 font-semibold">
          재검토 필요: {r}
        </p>
      ))}
    </div>
  )
}

function ReviewForm({
  repo,
  orgId,
  recipientCode,
  window,
  candidateKey,
  openActions,
  onDone,
}: {
  repo: AdminRepo
  orgId: string
  recipientCode: string
  window: CalendarWindow
  candidateKey: string
  openActions: OpenActionBrief[]
  onDone: (v: RecipientObservationsView) => void
}) {
  const [decision, setDecision] = useState<CandidateDecision | ''>('')
  const [reason, setReason] = useState('')
  const [linked, setLinked] = useState('')
  const [enteredBy, setEnteredBy] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      onDone(await repo.reviewCandidate(orgId, { recipientCode, window, candidateKey, decision: decision as CandidateDecision, reason, linkedActionId: linked || null, enteredByLabel: enteredBy, requestId }))
      setRequestId(newRequestId())
      setDecision('')
      setReason('')
      setLinked('')
    } catch (e) {
      setError(e instanceof WorkflowRequestError || e instanceof Error ? e.message : '저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-2 mt-1" aria-label="후보 판단">
      <div className="flex flex-wrap gap-x-3 gap-y-1" role="radiogroup" aria-label="판단">
        {CANDIDATE_DECISIONS.map((d) => (
          <label key={d} className="flex items-center gap-1 text-sm">
            <input type="radio" checked={decision === d} onChange={() => setDecision(d)} />
            {CANDIDATE_DECISION_LABELS[d]}
          </label>
        ))}
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="판단 근거(필수 — 어떤 보고·값을 보고 판단했는지)" className={inputClass} aria-label="판단 근거" />
      <label className="block">
        <span className={labelClass}>기존 조치에 연결(선택 — 같은 사안의 조치가 이미 있으면 새로 만들지 않고 연결)</span>
        <select value={linked} onChange={(e) => setLinked(e.target.value)} className={inputClass} aria-label="연결할 조치">
          <option value="">연결 안 함</option>
          {openActions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.purpose} ({a.status === 'draft' ? '초안' : '진행 중'})
            </option>
          ))}
        </select>
      </label>
      <input value={enteredBy} onChange={(e) => setEnteredBy(e.target.value)} placeholder="입력한 확인자(선택 · 입력값이며 로그인 신원이 아님)" className={inputClass} aria-label="입력한 확인자" />
      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2" role="alert">
          {error}
        </p>
      )}
      <button onClick={() => void submit()} disabled={saving || !decision} className="self-start min-h-[34px] px-3 rounded-full bg-slate-900 text-white text-xs font-bold disabled:bg-slate-300">
        판단 기록
      </button>
    </div>
  )
}

function CellButton({ cell, compact, selected, onClick }: { cell: CalendarCell; compact: boolean; selected: boolean; onClick: () => void }) {
  const d = CELL_STATE_DISPLAY[cell.state]
  const statuses = [...new Set(cell.entries.map((e) => e.status))]
  const title = `${d.label}${cell.entries.length > 1 ? ` · 기록 ${cell.entries.length}건` : ''}${cell.state === 'mixed' ? ` (${statuses.map((s) => OBSERVATION_STATUS_LABELS[s]).join('·')})` : ''}`
  return (
    <button
      onClick={onClick}
      disabled={cell.state === 'no_report'}
      title={title}
      aria-label={`${cell.date} ${title}`}
      aria-pressed={selected}
      className={`w-full min-w-[34px] min-h-[32px] rounded-md border text-[11px] leading-tight px-0.5 ${CELL_STYLE[cell.state]} ${selected ? 'ring-2 ring-slate-900' : ''}`}
    >
      <span aria-hidden="true">{d.symbol}</span>
      {!compact && cell.state !== 'no_report' && <span className="block text-[9px]">{d.label}</span>}
      {cell.entries.length > 1 && <span className="block text-[9px]">×{cell.entries.length}</span>}
    </button>
  )
}

export function RecipientObservationsSection({
  repo,
  orgId,
  recipientCode,
  onOpenReport,
  onOpenAction,
}: {
  repo: AdminRepo
  orgId: string
  recipientCode: string
  onOpenReport: (id: string) => void
  onOpenAction: (id: string) => void
}) {
  const [window, setWindow] = useState<CalendarWindow>(7)
  const [reload, setReload] = useState(0)
  const key = `${orgId}|${recipientCode}|${window}|${reload}`
  const [result, setResult] = useState<{ key: string; view?: RecipientObservationsView; error?: string } | null>(null)
  const [selected, setSelected] = useState<{ date: string; domain: string | null } | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    repo
      .getRecipientObservations(orgId, recipientCode, window)
      .then((view) => !cancelled && setResult({ key, view }))
      .catch((e) => !cancelled && setResult({ key, error: e instanceof Error ? e.message : '관찰 기록을 불러오지 못했습니다.' }))
    return () => {
      cancelled = true
    }
  }, [repo, orgId, recipientCode, window, key])
  const current = result?.key === key ? result : null
  const fresh = (v: RecipientObservationsView) => {
    setResult({ key, view: v })
    setReviewing(null)
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-bold text-slate-900 text-sm">관찰 달력 · 반복 보고 후보</h3>
      <div className="flex gap-1" role="group" aria-label="달력 기간">
        {([7, 30] as const).map((w) => (
          <button key={w} onClick={() => setWindow(w)} aria-pressed={window === w} className={`px-3 py-1 rounded-full text-xs font-bold ${window === w ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {w}일
          </button>
        ))}
      </div>
    </div>
  )
  if (!current) {
    return (
      <section className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4" aria-label="관찰 달력">
        {header}
        <p className="text-xs text-slate-400 mt-1">불러오는 중…</p>
      </section>
    )
  }
  if (current.error || !current.view) {
    return (
      <section className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4" aria-label="관찰 달력">
        {header}
        <p className="text-xs text-red-700 mt-1">
          불러오기 실패: {current.error}{' '}
          <button onClick={() => setReload((k) => k + 1)} className="underline font-bold">
            다시 불러오기
          </button>
        </p>
      </section>
    )
  }
  const v = current.view
  const cal = v.calendar
  const compact = cal.window === 30
  const selectedDay = selected ? cal.days.find((d) => d.date === selected.date) : null
  const selectedCell = selected?.domain ? cal.groups.flatMap((g) => g.rows).find((r) => r.domain === selected.domain)?.cells.find((c) => c.date === selected.date) : null

  return (
    <section className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-3" aria-label="관찰 달력">
      {header}
      <p className="text-[11px] text-slate-500">
        날짜는 <span className="font-bold">보고일(한국 시간) 기준</span>입니다 — 관찰일·관찰 시각은 저장되지 않아 관찰일 기준으로 보여주지 않습니다. 칸은 보고에 저장된 항목별 상태만 보여주며
        점수·그래프로 바꾸지 않습니다. {cal.start} ~ {cal.end} · 보고 {cal.counts.reports}건(항목별 상태 저장 {cal.counts.reportsWithItems}건 · 저장 없음 {cal.counts.reportsWithoutItems}건)
      </p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600" aria-label="칸 표시 설명">
        {CELL_STATE_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded border ${CELL_STYLE[s]}`} aria-hidden="true">
              {CELL_STATE_DISPLAY[s].symbol}
            </span>
            {CELL_STATE_DISPLAY[s].label}
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs" data-testid="observation-calendar">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white text-left pr-2 text-[11px] text-slate-500 font-semibold">세부 영역</th>
              {cal.days.map((d) => (
                <th key={d.date} className="font-normal">
                  <button
                    onClick={() => setSelected({ date: d.date, domain: null })}
                    disabled={d.reports.length === 0}
                    aria-label={`${d.date} 보고 ${d.reports.length}건 보기`}
                    className={`text-[10px] leading-tight px-0.5 ${d.reports.length ? 'text-slate-800 underline' : 'text-slate-300'}`}
                  >
                    {dayLabel(d.date)}
                    <span className="block">{d.reports.length ? `${d.reports.length}건` : '—'}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="sticky left-0 bg-white text-left pr-2 text-[11px] text-slate-600 font-semibold whitespace-nowrap">보고 전체(요양보호사 선택)</th>
              {cal.days.map((d) => (
                <td key={d.date} className="text-center text-[10px] text-slate-600 align-top">
                  {d.reports.length === 0 ? '' : [...new Set(d.reports.map((r) => (r.initialStatusChoice ? INITIAL_CHOICE_LABELS[r.initialStatusChoice] : '선택 없음')))].join('/')}
                </td>
              ))}
            </tr>
            {cal.groups.map((g) =>
              g.rows.map((row, i) => (
                <tr key={row.domain}>
                  <th className="sticky left-0 bg-white text-left pr-2 text-[11px] font-normal text-slate-700 whitespace-nowrap">
                    {i === 0 && <span className="text-slate-400">{g.label} · </span>}
                    {row.label}
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.date}>
                      <CellButton cell={cell} compact={compact} selected={selected?.date === cell.date && selected?.domain === row.domain} onClick={() => setSelected({ date: cell.date, domain: row.domain })} />
                    </td>
                  ))}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {selectedDay && (
        <section className="rounded-xl border border-slate-200 p-3 flex flex-col gap-2" aria-label="선택한 날의 원문 근거">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-slate-900">
              {selectedDay.date} 보고 {selectedDay.reports.length}건{selected?.domain ? ` · ${DOMAIN_LABELS[selected.domain as DomainKey]}` : ''}
            </p>
            <button onClick={() => setSelected(null)} className="text-[11px] text-slate-500 underline">
              닫기
            </button>
          </div>
          {selectedCell && (
            <p className="text-[11px] text-slate-600">
              이 칸: {CELL_STATE_DISPLAY[selectedCell.state].label}
              {selectedCell.entries.length > 0 && ` — ${selectedCell.entries.map((e) => `${OBSERVATION_STATUS_LABELS[e.status]}(${e.participantCode}${e.rejected ? '·반려됨' : ''})`).join(', ')}`}
              {selectedCell.state === 'not_stored' && ' — 그날 보고에 항목별 상태가 저장되지 않았습니다(정상·이상으로 해석하지 않음). 원문을 확인하세요.'}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {selectedDay.reports.map((r) => (
              <li key={r.reportId} className={`rounded-lg p-2 ${selectedCell?.entries.some((e) => e.reportId === r.reportId) ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                <p className="text-xs text-slate-700">
                  <span className="font-bold">{formatKoreanDateTime(r.submittedAt)}</span> 제출 · 요양보호사 {r.participantCode} · {r.reportType === 'daily' ? '기본보고' : '추가보고'} · 보고 전체:{' '}
                  {r.initialStatusChoice ? INITIAL_CHOICE_LABELS[r.initialStatusChoice] : '선택 없음'}
                  {r.reviewStatus === 'rejected' && <span className="text-red-700 font-semibold"> · 반려됨</span>}
                  {r.emergencyFlagged && <span className="text-red-700 font-semibold"> · 🔴 응급 표현</span>}
                </p>
                <p className="text-sm text-slate-800 mt-0.5">원문: {r.rawExcerpt ?? '(원문 없음)'}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  항목별 상태: {r.hasStoredItems ? r.observations.map((o) => `${o.label} ${o.statusLabel}`).join(' · ') : '저장 없음'}
                  {r.hasStoredItems && ' (항목별 근거 연결 전 — 보고 전체가 근거)'}
                </p>
                <button onClick={() => onOpenReport(r.reportId)} className="mt-1 text-[11px] font-bold text-teal-700 underline">
                  보고 전체 열기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-2" aria-label="반복 보고 후보">
        <h4 className="text-xs font-bold text-slate-700">반복 보고 후보</h4>
        <p className="text-[11px] text-slate-500">
          규칙 {REPEAT_RULE.id} v{REPEAT_RULE.version}(초기 운영 규칙): {REPEAT_RULE.label}. 같은 날 여러 보고는 하루로 셉니다. 기준 창 {v.repeat.windowStart} ~ {v.repeat.windowEnd}(한국 날짜).
        </p>
        <p className="text-[11px] text-slate-500">
          <span className="font-semibold">관찰일 기준</span>: 관찰일이 기록된 보고가 없어 계산 대상 0건 · 제외 {v.repeat.observationDateBasis.excludedSignals}건. 아래는 <span className="font-semibold">보고일 기준</span>으로 따로
          계산했습니다(두 기준을 섞지 않음).
        </p>
        <p className="text-[11px] text-slate-600">
          후보 {v.repeat.items.length}건 · 창 안 변화 신호 {v.repeat.signalsInWindow}건{v.repeat.excludedRejected > 0 ? ` · 반려된 보고라 제외 ${v.repeat.excludedRejected}건` : ''}
        </p>
        {v.repeat.items.length === 0 && <p className="text-sm text-slate-500 bg-slate-50 rounded-xl p-2">반복 보고 후보 없음(항목별 변화가 저장된 보고 기준)</p>}
        {v.repeat.items.map(({ candidate: c, state }) => (
          <div key={c.key} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 flex flex-col gap-1" data-testid="repeat-candidate">
            <p className="text-sm font-bold text-slate-900">{c.headline}</p>
            <p className="text-[11px] text-slate-500">
              보고일 기준 · {c.days.join(', ')} · 규칙 {c.ruleId} v{c.ruleVersion} · 같은 증상이 계속됐거나 나빠졌다는 뜻이 아닙니다(변화 보고가 반복됐다는 사실만).
            </p>
            <ul className="text-xs text-slate-700">
              {c.signals.map((s) => (
                <li key={`${s.reportId}-${s.domain}`}>
                  {s.date} · 요양보호사 {s.participantCode} · {formatKoreanDateTime(s.submittedAt)} 제출{' '}
                  <button onClick={() => onOpenReport(s.reportId)} className="underline text-teal-700 font-semibold">
                    원문 보기
                  </button>
                </li>
              ))}
            </ul>
            <ReviewStateLine state={state} />
            {v.openActions.length > 0 ? (
              <p className="text-[11px] text-slate-600">
                이 수급자의 열린 조치 {v.openActions.length}건(새 조치 전에 확인):{' '}
                {v.openActions.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ', '}
                    <button onClick={() => onOpenAction(a.id)} className="underline">
                      {a.purpose}
                    </button>
                  </span>
                ))}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">이 수급자의 열린 조치 없음 — 필요하면 근거 보고에서 조치를 만드세요.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onOpenReport(c.signals[c.signals.length - 1].reportId)} className="min-h-[32px] px-3 rounded-full border border-slate-300 text-xs font-bold text-slate-700">
                최근 근거 보고에서 판단·조치
              </button>
              {v.reviewsReady ? (
                <button onClick={() => setReviewing(reviewing === c.key ? null : c.key)} className="min-h-[32px] px-3 rounded-full bg-slate-900 text-white text-xs font-bold">
                  후보 판단 남기기
                </button>
              ) : (
                <span className="text-[11px] text-slate-500 self-center">후보 판단 저장: 준비 중(5단계 DB 적용 전)</span>
              )}
            </div>
            {reviewing === c.key && <ReviewForm repo={repo} orgId={orgId} recipientCode={recipientCode} window={window} candidateKey={c.key} openActions={v.openActions} onDone={fresh} />}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2" aria-label="비교 가능한 값 차이">
        <h4 className="text-xs font-bold text-slate-700">비교 가능한 값 차이(저장된 값 비교)</h4>
        <p className="text-[11px] text-slate-500">
          규칙 {VALUE_RULE.id} v{VALUE_RULE.version}: {VALUE_RULE.label}. 보고자의 "평소와 다름" 진술(위 반복 보고)과 다른, 저장된 값끼리의 비교입니다. 수치 차이를 악화·호전으로 해석하지 않습니다.
        </p>
        {!v.values ? (
          <p className="text-sm text-slate-500 bg-slate-50 rounded-xl p-2">기준정보 저장소 준비 전 — 값 비교 없음</p>
        ) : (
          <>
            {v.values.items.length === 0 && <p className="text-sm text-slate-500 bg-slate-50 rounded-xl p-2">비교 가능한 값 차이 없음</p>}
            {v.values.items.map(({ comparison: c, state }) => (
              <div key={c.key} className="rounded-xl border border-slate-200 p-3 flex flex-col gap-1" data-testid="value-comparison">
                <p className="text-sm font-bold text-slate-900">{c.headline}</p>
                {c.difference !== null && (
                  <p className="text-[11px] text-slate-600">
                    차이 {c.difference > 0 ? '+' : ''}
                    {c.difference}
                    {c.unit} — 수치 차이일 뿐 임상적 악화·호전 판단이 아닙니다
                  </p>
                )}
                <p className="text-[11px] text-slate-500">
                  근거: 기준정보 v{c.earlier.version}({c.earlier.reference_date}) · v{c.later.version}({c.later.reference_date}) —{' '}
                  <a href="#baseline" className="underline">
                    기준정보·원본에서 보기
                  </a>
                </p>
                <ReviewStateLine state={state} />
                {v.reviewsReady && (
                  <button onClick={() => setReviewing(reviewing === c.key ? null : c.key)} className="self-start min-h-[32px] px-3 rounded-full bg-slate-900 text-white text-xs font-bold">
                    후보 판단 남기기
                  </button>
                )}
                {reviewing === c.key && <ReviewForm repo={repo} orgId={orgId} recipientCode={recipientCode} window={window} candidateKey={c.key} openActions={v.openActions} onDone={fresh} />}
              </div>
            ))}
            {v.values.excluded.length > 0 && (
              <p className="text-[11px] text-slate-500">
                비교하지 않은 기준정보: {v.values.excluded.map((x) => `${x.reason} ${x.count}건`).join(' · ')}
              </p>
            )}
          </>
        )}
      </div>

      {v.recheck.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 flex flex-col gap-1" aria-label="재검토 필요한 후보 판단">
          <p className="text-xs font-bold text-red-800">근거가 바뀌어 다시 볼 후보 판단 {v.recheck.length}건(판단 이력은 그대로)</p>
          {v.recheck.map(({ key, state }) => (
            <div key={key} className="text-[11px] text-slate-700">
              <p className="font-semibold">{state.latest ? candidateLabel(state.latest) : key}</p>
              <ReviewStateLine state={state} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** 조치 상세 — 이 조치에 연결된 후보 판단(판단 당시 근거 스냅샷). */
export function ActionCandidateReviews({ reviews, onOpenReport }: { reviews: CandidateReview[]; onOpenReport: (id: string) => void }) {
  if (reviews.length === 0) return null
  return (
    <section className="rounded-2xl bg-white border border-slate-100 p-4" aria-label="연결된 변화 후보 판단">
      <h3 className="font-bold text-slate-900 mb-1">연결된 변화 후보 판단 ({reviews.length}건)</h3>
      <ul className="flex flex-col gap-2 text-sm">
        {reviews.map((r) => (
          <li key={r.id} className="rounded-lg bg-slate-50 p-2">
            <p className="font-semibold text-slate-800">{candidateLabel(r)}</p>
            <p className="text-[11px] text-slate-600">{reviewSummary(r)}</p>
            {(r.evidence.reportIds ?? []).length > 0 && (
              <p className="text-[11px] text-slate-500">
                판단 당시 근거 보고({(r.evidence.days ?? []).join(', ')}):{' '}
                {(r.evidence.reportIds ?? []).map((id, i) => (
                  <span key={id}>
                    {i > 0 && ', '}
                    <button onClick={() => onOpenReport(id)} className="underline">
                      보고 {i + 1}
                    </button>
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
