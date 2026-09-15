import { useEffect, useState } from 'react'
import type { AdminRepo } from '../shared/adminRepo'
import { WorkflowRequestError } from '../shared/adminRepo'
import {
  ACTION_KIND_LABELS,
  ACTION_STATUS_LABELS,
  ADMIN_ACTOR_SCOPE_LABEL,
  DECISION_KINDS,
  DECISION_LABELS,
  DUE_KIND_LABELS,
  isoToKstLocal,
  kstLocalToIso,
  latestBy,
  OBLIGATION_STATUS_LABELS,
  OBLIGATION_TYPE_LABELS,
  SAFETY_OUTCOME_LABELS,
  SAFETY_OUTCOMES,
  type ActionEventType,
  type ActionKind,
  type DecisionKind,
  type DueInput,
  type DueKind,
  type SafetyOutcome,
} from '../../../shared/workflow'
import type { ActionDetailView, ObligationView, ReportWorkflowView } from '../../../shared/workflowViews'
import { formatDue, formatKoreanDateTime } from './adminFormat'
import { SpinnerIcon } from './adminBadges'
import { ActionSummaryRow } from './ActionSummaryRow'

/** 관리자 판단·안전 검토·조치(2단계) 화면. 저장은 모두 요청 식별자(재시도 중복 방지)와
 * 버전/최신 기록 대조(동시 수정 충돌)를 거친다. 실패해도 입력값은 지우지 않는다. */

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

function describeError(e: unknown): { message: string; conflict: boolean } {
  if (e instanceof WorkflowRequestError) return { message: e.message, conflict: e.status === 409 }
  return { message: e instanceof Error ? e.message : '저장하지 못했습니다.', conflict: false }
}

const inputClass = 'w-full border border-slate-200 rounded-lg p-2 text-sm'
const labelClass = 'block text-xs font-semibold text-slate-600 mb-1'

function EnteredByField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className={labelClass}>입력한 확인자(선택 · 입력값이며 로그인 신원이 아님)</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="예: 담당 사회복지사(이름 대신 역할 권장)" className={inputClass} />
    </label>
  )
}

interface DueState {
  kind: DueKind
  local: string
}

function toDueInput(s: DueState): DueInput {
  return s.kind === 'datetime' ? { kind: 'datetime', at: kstLocalToIso(s.local) } : { kind: s.kind }
}

function DueEditor({ label, value, onChange, allowNextVisit }: { label: string; value: DueState; onChange: (v: DueState) => void; allowNextVisit: boolean }) {
  const kinds: DueKind[] = allowNextVisit ? ['next_actual_visit', 'datetime', 'unset'] : ['datetime', 'unset']
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex flex-wrap gap-2 items-center">
        <select value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value as DueKind })} className="border border-slate-200 rounded-lg p-2 text-sm" aria-label={`${label} 종류`}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {DUE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {value.kind === 'datetime' && (
          <input type="datetime-local" value={value.local} onChange={(e) => onChange({ ...value, local: e.target.value })} className="border border-slate-200 rounded-lg p-2 text-sm" aria-label={`${label} 일시(한국 시간)`} />
        )}
      </div>
      {value.kind === 'next_actual_visit' && <p className="text-[11px] text-slate-500 mt-0.5">방문 일정 자료가 없으므로 날짜를 만들지 않습니다 — 다음 방문이 없으면 방문 대기로 남습니다.</p>}
    </div>
  )
}

function ErrorLine({ error, onReload }: { error: { message: string; conflict: boolean } | null; onReload: () => void }) {
  if (!error) return null
  return (
    <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2 mt-2">
      {error.message}
      {error.conflict && (
        <button onClick={onReload} className="ml-2 font-bold underline">
          최신 내용 불러오기(입력값은 유지)
        </button>
      )}
    </p>
  )
}

// ── 조치 만들기 ─────────────────────────────────────────────────────

export function CreateActionForm({
  repo,
  orgId,
  recipientCode,
  sourceReportId,
  decisionId,
  onCreated,
  onCancel,
}: {
  repo: AdminRepo
  orgId: string
  recipientCode: string
  sourceReportId: string | null
  decisionId: string | null
  onCreated: (view: ActionDetailView) => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState<ActionKind>('field_request')
  const [purpose, setPurpose] = useState('')
  const [actionContent, setActionContent] = useState('')
  const [fieldMessage, setFieldMessage] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [ownerLabel, setOwnerLabel] = useState('')
  const [enteredBy, setEnteredBy] = useState('')
  const [responseDue, setResponseDue] = useState<DueState>({ kind: 'next_actual_visit', local: '' })
  const [executionDue, setExecutionDue] = useState<DueState>({ kind: 'unset', local: '' })
  const [verificationDue, setVerificationDue] = useState<DueState>({ kind: 'unset', local: '' })
  // 같은 입력으로 다시 누르면(재시도) 같은 요청 식별자를 보내 조치가 두 번 생기지 않게 한다.
  const [requestId] = useState(newRequestId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null)

  const submit = async (activate: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const view = await repo.createAction(orgId, {
        recipientCode,
        sourceReportId,
        decisionId,
        kind,
        purpose,
        actionContent,
        fieldMessageDraft: kind === 'field_request' ? fieldMessage : null,
        internalNote,
        ownerLabel,
        activate,
        responseDue: kind === 'field_request' ? toDueInput(responseDue) : null,
        executionDue: kind === 'admin_direct' ? toDueInput(executionDue) : null,
        verificationDue: toDueInput(verificationDue),
        enteredByLabel: enteredBy,
        requestId,
      })
      onCreated(view)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-3">
      <p className="text-sm font-bold text-slate-900">조치 만들기 · 수급자 {recipientCode}</p>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="조치 종류">
        {(['field_request', 'admin_direct'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
            {ACTION_KIND_LABELS[k]}
          </label>
        ))}
      </div>
      <label className="block">
        <span className={labelClass}>확인하거나 해결하려는 사항(필수)</span>
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="예: 식사량이 계속 줄었는지 확인" className={inputClass} />
      </label>
      {kind === 'admin_direct' && (
        <label className="block">
          <span className={labelClass}>조치 내용</span>
          <textarea value={actionContent} onChange={(e) => setActionContent(e.target.value)} rows={2} placeholder="예: 보호자에게 식사량 변화 안내(실제 연락은 관리자가 하고 결과를 기록)" className={inputClass} />
        </label>
      )}
      {kind === 'field_request' && (
        <label className="block">
          <span className={labelClass}>현장에 전달할 요청 내용(초안)</span>
          <textarea value={fieldMessage} onChange={(e) => setFieldMessage(e.target.value)} rows={2} placeholder="예: 다음 방문 때 식사량을 다시 확인해 주세요." className={inputClass} />
          <span className="text-[11px] text-amber-800">미게시 초안 — 이번 단계에는 게시 기능이 없어 요양보호사 화면에 전달되지 않습니다.</span>
        </label>
      )}
      <label className="block">
        <span className={labelClass}>내부 메모(관리자 전용 — 현장에 보이지 않음)</span>
        <textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)} rows={2} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>업무 담당(선택 · 비우면 담당 미지정 · 입력값이며 로그인 신원이 아님)</span>
        <input value={ownerLabel} onChange={(e) => setOwnerLabel(e.target.value)} placeholder="예: 담당 사회복지사" className={inputClass} />
      </label>
      {kind === 'field_request' && <DueEditor label="현장 응답기한" value={responseDue} onChange={setResponseDue} allowNextVisit />}
      {kind === 'admin_direct' && <DueEditor label="관리자 직접 수행기한" value={executionDue} onChange={setExecutionDue} allowNextVisit={false} />}
      <DueEditor label="관리자 결과 재확인기한" value={verificationDue} onChange={setVerificationDue} allowNextVisit={false} />
      <EnteredByField value={enteredBy} onChange={setEnteredBy} />
      <ErrorLine error={error} onReload={() => setError(null)} />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void submit(true)} disabled={saving} className="min-h-[40px] px-4 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300">
          {saving ? '처리 중...' : '진행 중으로 만들기'}
        </button>
        <button onClick={() => void submit(false)} disabled={saving} className="min-h-[40px] px-4 rounded-full border-2 border-slate-900 text-slate-900 text-sm font-bold disabled:opacity-50">
          초안으로 두기(기한 시작 안 함)
        </button>
        <button onClick={onCancel} disabled={saving} className="min-h-[40px] px-3 text-slate-500 text-sm">
          닫기
        </button>
      </div>
    </div>
  )
}

// ── 보고 한 건의 관리자 업무 ───────────────────────────────────────

export function ReportWorkflowSection({
  repo,
  orgId,
  reportId,
  onOpenAction,
}: {
  repo: AdminRepo
  orgId: string
  reportId: string
  onOpenAction: (id: string) => void
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const requestKey = `${orgId}|${reportId}|${reloadKey}`
  const [result, setResult] = useState<{ key: string; view?: ReportWorkflowView; error?: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    repo
      .getReportWorkflow(orgId, reportId)
      .then((view) => !cancelled && setResult({ key: requestKey, view }))
      .catch((e) => !cancelled && setResult({ key: requestKey, error: e instanceof Error ? e.message : '관리자 업무 기록을 불러오지 못했습니다.' }))
    return () => {
      cancelled = true
    }
  }, [repo, orgId, reportId, requestKey])

  // 저장 직후에는 서버가 돌려준 최신 보기를 바로 쓴다(다시 불러오지 않아도 된다).
  const [fresh, setFresh] = useState<ReportWorkflowView | null>(null)
  const loaded = result?.key === requestKey ? result : null
  const view = fresh ?? loaded?.view ?? null
  const reload = () => {
    setFresh(null)
    setReloadKey((k) => k + 1)
  }

  const [decision, setDecision] = useState<DecisionKind | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [decisionBy, setDecisionBy] = useState('')
  const [decisionRequestId, setDecisionRequestId] = useState(newRequestId)
  const [decisionSaving, setDecisionSaving] = useState(false)
  const [decisionError, setDecisionError] = useState<{ message: string; conflict: boolean } | null>(null)

  const [outcome, setOutcome] = useState<SafetyOutcome | null>(null)
  const [safetyReason, setSafetyReason] = useState('')
  const [safetyAction, setSafetyAction] = useState('')
  const [safetyBy, setSafetyBy] = useState('')
  const [safetyRequestId, setSafetyRequestId] = useState(newRequestId)
  const [safetySaving, setSafetySaving] = useState(false)
  const [safetyError, setSafetyError] = useState<{ message: string; conflict: boolean } | null>(null)

  const [creating, setCreating] = useState(false)

  if (loaded?.error && !fresh) {
    return (
      <section className="rounded-2xl bg-white border border-slate-100 p-4">
        <h3 className="font-bold text-slate-900">관리자 판단 · 안전 검토 · 조치</h3>
        <p className="text-sm text-red-700 mt-1">불러오기 실패: {loaded.error}</p>
        <button onClick={reload} className="text-sm font-bold underline text-red-700 mt-1">
          다시 불러오기
        </button>
      </section>
    )
  }
  if (!view) {
    return (
      <section className="rounded-2xl bg-white border border-slate-100 p-4 flex justify-center">
        <SpinnerIcon className="w-5 h-5 text-teal-600" />
      </section>
    )
  }
  if (!view.workflowReady) {
    return (
      <section className="rounded-2xl bg-white border border-slate-100 p-4">
        <h3 className="font-bold text-slate-900">관리자 판단 · 안전 검토 · 조치</h3>
        <p className="text-sm text-slate-500 mt-1">준비 중 — 업무 기록 저장소가 DB에 적용되기 전이라 판단·조치·안전 검토를 저장할 수 없습니다. 보고 승인/반려는 위에서 그대로 할 수 있습니다.</p>
      </section>
    )
  }

  const latestDecision = latestBy(view.decisions, (d) => d.decided_at)
  const latestSafety = latestBy(view.safetyReviews, (s) => s.reviewed_at)
  const submitted = view.events.find((e) => e.event_type === 'submitted')
  const reviewEvents = view.events.filter((e) => e.event_type !== 'submitted')
  const firstReview = reviewEvents[0]

  const saveDecision = async () => {
    if (!decision) {
      setDecisionError({ message: '판단을 선택해 주세요.', conflict: false })
      return
    }
    setDecisionSaving(true)
    setDecisionError(null)
    try {
      const next = await repo.recordDecision(orgId, {
        reportId,
        decision,
        reason: decisionReason,
        enteredByLabel: decisionBy,
        expectedLatestDecisionId: latestDecision?.id ?? null,
        requestId: decisionRequestId,
      })
      setFresh(next)
      setDecision(null)
      setDecisionReason('')
      setDecisionRequestId(newRequestId())
    } catch (e) {
      setDecisionError(describeError(e))
    } finally {
      setDecisionSaving(false)
    }
  }

  const saveSafety = async () => {
    if (!outcome) {
      setSafetyError({ message: '검토 결과를 선택해 주세요.', conflict: false })
      return
    }
    setSafetySaving(true)
    setSafetyError(null)
    try {
      const next = await repo.recordSafetyReview(orgId, {
        reportId,
        outcome,
        reason: safetyReason,
        relatedActionId: safetyAction || null,
        enteredByLabel: safetyBy,
        expectedLatestReviewId: latestSafety?.id ?? null,
        requestId: safetyRequestId,
      })
      setFresh(next)
      setOutcome(null)
      setSafetyReason('')
      setSafetyAction('')
      setSafetyRequestId(newRequestId())
    } catch (e) {
      setSafetyError(describeError(e))
    } finally {
      setSafetySaving(false)
    }
  }

  return (
    <section className="rounded-2xl bg-white border border-slate-100 p-4 flex flex-col gap-4" aria-label="관리자 업무">
      <div>
        <h3 className="font-bold text-slate-900">관리자 판단 · 안전 검토 · 조치</h3>
        <p className="text-[11px] text-slate-400">보고 승인/반려(기록 검토)와 별개로 저장됩니다 · 기록 주체: {ADMIN_ACTOR_SCOPE_LABEL}</p>
      </div>

      <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2">
        <p>
          최초 제출 이벤트: {submitted ? formatKoreanDateTime(submitted.occurred_at) : '기록 없음(이 기능 적용 전 보고이거나 아직 제출 전 — 시각을 추정해 채우지 않음)'}
        </p>
        <p>
          최초 검토(승인/반려) 이벤트:{' '}
          {firstReview ? `${formatKoreanDateTime(firstReview.occurred_at)} ${firstReview.event_type === 'review_approved' ? '승인' : '반려'}` : '기록 없음'}
          {reviewEvents.length > 1 && ` · 이후 검토 ${reviewEvents.length - 1}회`}
        </p>
      </div>

      {view.report.emergencyFlagged && (
        <div className="rounded-xl border border-red-200 p-3">
          <p className="text-sm font-bold text-red-700">안전 신호 검토 {view.report.status !== 'submitted' && '(제출 전 기록)'}</p>
          <p className="text-[11px] text-slate-500">규칙 기반 응급 표현 감지 신호입니다. 검토 완료는 대상자가 안전하다는 보증이나 조치 완료가 아닙니다. 보고 승인으로 자동 완료되지 않습니다.</p>
          <p className="text-sm mt-1">
            현재:{' '}
            {latestSafety ? (
              <>
                {SAFETY_OUTCOME_LABELS[latestSafety.outcome]} · {formatKoreanDateTime(latestSafety.reviewed_at)} · 이유: {latestSafety.reason}
                {latestSafety.entered_by_label && ` · 입력한 확인자 ${latestSafety.entered_by_label}`}
              </>
            ) : (
              <span className="font-bold text-red-700">안전 검토 기록 없음</span>
            )}
          </p>
          {view.safetyReviews.length > 1 && <p className="text-[11px] text-slate-400">이전 검토 {view.safetyReviews.length - 1}건 보존됨</p>}
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex flex-col gap-1" role="radiogroup" aria-label="안전 검토 결과">
              {SAFETY_OUTCOMES.map((o) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={outcome === o} onChange={() => setOutcome(o)} />
                  {SAFETY_OUTCOME_LABELS[o]}
                </label>
              ))}
            </div>
            {outcome === 'action_linked' && (
              <label className="block">
                <span className={labelClass}>연결할 조치(같은 수급자의 진행 중·초안 조치)</span>
                <select value={safetyAction} onChange={(e) => setSafetyAction(e.target.value)} className={inputClass}>
                  <option value="">선택</option>
                  {view.recipientOpenActions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.purpose} ({ACTION_STATUS_LABELS[a.status]})
                    </option>
                  ))}
                </select>
                {view.recipientOpenActions.length === 0 && <span className="text-[11px] text-slate-500">연결할 조치가 없습니다 — 아래에서 먼저 조치를 만들어 주세요.</span>}
              </label>
            )}
            <label className="block">
              <span className={labelClass}>검토 이유(필수)</span>
              <textarea value={safetyReason} onChange={(e) => setSafetyReason(e.target.value)} rows={2} placeholder="예: 요양보호사가 119 연결했고 보호자 동행 확인" className={inputClass} />
            </label>
            <EnteredByField value={safetyBy} onChange={setSafetyBy} />
            <ErrorLine error={safetyError} onReload={reload} />
            <button onClick={() => void saveSafety()} disabled={safetySaving} className="self-start min-h-[40px] px-4 rounded-full bg-red-600 text-white text-sm font-bold disabled:bg-slate-300">
              {safetySaving ? '처리 중...' : '안전 검토 기록'}
            </button>
          </div>
        </div>
      )}

      {view.report.status === 'submitted' ? (
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-bold text-slate-900">관리자 판단</p>
          <p className="text-sm mt-1">
            현재:{' '}
            {latestDecision ? (
              <>
                <span className="font-bold">{DECISION_LABELS[latestDecision.decision]}</span> · {formatKoreanDateTime(latestDecision.decided_at)}
                {latestDecision.reason && ` · 근거: ${latestDecision.reason}`}
                {latestDecision.entered_by_label && ` · 입력한 확인자 ${latestDecision.entered_by_label}`}
              </>
            ) : (
              <span className="text-slate-500">아직 판단 없음</span>
            )}
          </p>
          {view.decisions.length > 1 && (
            <details className="mt-1">
              <summary className="text-[11px] text-slate-500 cursor-pointer">이전 판단 {view.decisions.length - 1}건</summary>
              <ul className="text-[11px] text-slate-500 mt-1">
                {view.decisions
                  .filter((d) => d.id !== latestDecision?.id)
                  .map((d) => (
                    <li key={d.id}>
                      {formatKoreanDateTime(d.decided_at)} · {DECISION_LABELS[d.decision]}
                      {d.reason ? ` · ${d.reason}` : ''}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <div className="grid grid-cols-2 gap-2 mt-2" role="radiogroup" aria-label="관리자 판단">
            {DECISION_KINDS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={decision === d}
                onClick={() => setDecision(d)}
                className={`min-h-[40px] rounded-xl border-2 text-sm font-bold px-2 ${decision === d ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-200 text-slate-700'}`}
              >
                {DECISION_LABELS[d]}
              </button>
            ))}
          </div>
          <textarea value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} rows={2} placeholder="판단 근거(선택) — 원 보고의 어떤 내용을 보고 판단했는지" className={`${inputClass} mt-2`} />
          <div className="mt-2">
            <EnteredByField value={decisionBy} onChange={setDecisionBy} />
          </div>
          {decision === 'no_action_needed' && <p className="text-[11px] text-slate-500 mt-1">평소와 같은 보고는 조치를 만들지 않고 이 판단으로 마칩니다.</p>}
          <ErrorLine error={decisionError} onReload={reload} />
          <button onClick={() => void saveDecision()} disabled={decisionSaving} className="mt-2 min-h-[40px] px-4 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300">
            {decisionSaving ? '처리 중...' : '판단 기록'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">관리자 판단은 제출된 보고에만 남길 수 있습니다.</p>
      )}

      <div className="rounded-xl border border-slate-200 p-3 flex flex-col gap-2">
        <p className="text-sm font-bold text-slate-900">이 보고에서 시작한 조치 ({view.actions.length}건)</p>
        {latestDecision && (latestDecision.decision === 'action_needed' || latestDecision.decision === 'observe_more') && view.actions.length === 0 && (
          <p className="text-[11px] text-amber-800">"{DECISION_LABELS[latestDecision.decision]}" 판단에 아직 연결된 조치가 없습니다.</p>
        )}
        {view.actions.map((a) => (
          <ActionSummaryRow key={a.id} a={a} onOpen={onOpenAction} />
        ))}
        {creating ? (
          <CreateActionForm
            repo={repo}
            orgId={orgId}
            recipientCode={view.report.recipientCode}
            sourceReportId={view.report.id}
            decisionId={latestDecision && (latestDecision.decision === 'action_needed' || latestDecision.decision === 'observe_more') ? latestDecision.id : null}
            onCreated={() => {
              setCreating(false)
              reload()
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button onClick={() => setCreating(true)} className="self-start min-h-[40px] px-4 rounded-full border-2 border-slate-900 text-slate-900 text-sm font-bold">
            조치 만들기
          </button>
        )}
      </div>
    </section>
  )
}

// ── 조치 상세 ───────────────────────────────────────────────────────

const EVENT_LABELS: Record<ActionEventType, string> = {
  created: '생성',
  activated: '진행 중으로 전환',
  updated: '내용 수정',
  due_changed: '기한 변경',
  completed: '완료',
  cancelled: '취소',
  reopened: '재개(새 후속 주기)',
}

type Mode = null | 'edit' | 'complete' | 'cancel' | 'reopen' | { due: ObligationView }

export function ActionDetailPanel({
  repo,
  orgId,
  actionId,
  onBack,
  onOpenReport,
  onOpenRecipient,
}: {
  repo: AdminRepo
  orgId: string
  actionId: string
  onBack: () => void
  onOpenReport: (id: string) => void
  onOpenRecipient: (code: string) => void
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const requestKey = `${orgId}|${actionId}|${reloadKey}`
  const [result, setResult] = useState<{ key: string; view?: ActionDetailView; error?: { message: string; status: number | null } } | null>(null)
  useEffect(() => {
    let cancelled = false
    repo
      .getAction(orgId, actionId)
      .then((view) => !cancelled && setResult({ key: requestKey, view }))
      .catch((e) => {
        if (cancelled) return
        const status = e instanceof WorkflowRequestError ? e.status : typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : null
        setResult({ key: requestKey, error: { message: e instanceof Error ? e.message : '조치를 불러오지 못했습니다.', status } })
      })
    return () => {
      cancelled = true
    }
  }, [repo, orgId, actionId, requestKey])
  const [fresh, setFresh] = useState<ActionDetailView | null>(null)
  const loaded = result?.key === requestKey ? result : null
  const view = fresh ?? loaded?.view ?? null
  const reload = () => {
    setFresh(null)
    setReloadKey((k) => k + 1)
  }

  const [mode, setMode] = useState<Mode>(null)
  const [requestId, setRequestId] = useState(newRequestId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null)
  const [enteredBy, setEnteredBy] = useState('')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [remaining, setRemaining] = useState('')
  const [due, setDue] = useState<DueState>({ kind: 'unset', local: '' })
  const [dueExec, setDueExec] = useState<DueState>({ kind: 'unset', local: '' })
  const [edit, setEdit] = useState({ purpose: '', actionContent: '', fieldMessageDraft: '', internalNote: '', ownerLabel: '' })

  const back = (
    <button onClick={onBack} className="text-slate-400 text-sm self-start">
      ← 뒤로
    </button>
  )
  if (loaded?.error && !fresh) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
          {loaded.error.status === 503 ? '준비 중 — 조치 저장소가 DB에 적용되기 전입니다.' : loaded.error.message}
        </p>
      </div>
    )
  }
  if (!view) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <div className="flex justify-center py-16">
          <SpinnerIcon className="w-6 h-6 text-teal-600" />
        </div>
      </div>
    )
  }
  const { action, summary, events } = view
  const editable = action.status === 'draft' || action.status === 'open'

  const open = (m: Mode) => {
    setMode(m)
    setError(null)
    setReason('')
    setRequestId(newRequestId())
    if (m === 'edit') {
      setEdit({ purpose: action.purpose, actionContent: action.action_content ?? '', fieldMessageDraft: action.field_message_draft ?? '', internalNote: action.internal_note ?? '', ownerLabel: action.owner_label ?? '' })
    }
    if (m && typeof m === 'object') setDue({ kind: m.due.currentDueKind, local: isoToKstLocal(m.due.currentDueAt) })
    if (m === 'reopen') {
      setDue({ kind: 'unset', local: '' })
      setDueExec({ kind: 'unset', local: '' })
    }
  }

  const mutate = async (body: Parameters<AdminRepo['mutateAction']>[1]) => {
    setSaving(true)
    setError(null)
    try {
      const next = await repo.mutateAction(orgId, body)
      setFresh(next)
      setMode(null)
      setRequestId(newRequestId())
    } catch (e) {
      setError(describeError(e))
    } finally {
      setSaving(false)
    }
  }
  const base = { actionId: action.id, expectedVersion: action.version, requestId, enteredByLabel: enteredBy }

  return (
    <div className="flex flex-col gap-4">
      {back}
      <section className="rounded-2xl bg-white border border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900">{action.purpose}</h2>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{ACTION_STATUS_LABELS[action.status]}</span>
          {summary.overdue && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">기한 지남</span>}
          {summary.dueToday && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">오늘 재확인</span>}
        </div>
        <p className="text-sm text-slate-600 mt-1">
          {ACTION_KIND_LABELS[action.kind]} ·{' '}
          <button onClick={() => onOpenRecipient(action.recipient_code)} className="underline">
            수급자 {action.recipient_code}
          </button>
          {action.source_report_id && (
            <>
              {' · '}
              <button onClick={() => onOpenReport(action.source_report_id!)} className="underline">
                근거 보고 열기
              </button>
            </>
          )}
        </p>
        <dl className="text-sm mt-2 grid gap-1">
          {action.action_content && (
            <div>
              <dt className="inline text-slate-400">조치 내용: </dt>
              <dd className="inline text-slate-700">{action.action_content}</dd>
            </div>
          )}
          {action.kind === 'field_request' && (
            <div>
              <dt className="inline text-slate-400">현장 요청 내용: </dt>
              <dd className="inline text-slate-700">
                {action.field_message_draft ?? '(비어 있음)'}{' '}
                <span className="text-[11px] font-bold text-amber-800">[미게시 초안 — 요양보호사에게 전달되지 않음]</span>
              </dd>
            </div>
          )}
          <div>
            <dt className="inline text-slate-400">내부 메모(관리자 전용): </dt>
            <dd className="inline text-slate-700">{action.internal_note ?? '-'}</dd>
          </div>
          <div>
            <dt className="inline text-slate-400">업무 담당: </dt>
            <dd className="inline text-slate-700">{action.owner_label ? `${action.owner_label} (입력값 — 로그인 신원 아님)` : <span className="text-amber-700 font-semibold">담당 미지정</span>}</dd>
          </div>
          <div>
            <dt className="inline text-slate-400">기록 주체: </dt>
            <dd className="inline text-slate-700">{ADMIN_ACTOR_SCOPE_LABEL}</dd>
          </div>
          {action.status === 'completed' && (
            <div>
              <dt className="inline text-slate-400">완료 근거: </dt>
              <dd className="inline text-slate-700">
                {action.completion_evidence} · {formatKoreanDateTime(action.completed_at)}
                {action.completion_remaining && ` · 남은 문제: ${action.completion_remaining}`}
              </dd>
            </div>
          )}
          {action.status === 'cancelled' && (
            <div>
              <dt className="inline text-slate-400">취소 이유: </dt>
              <dd className="inline text-slate-700">
                {action.cancel_reason} · {formatKoreanDateTime(action.cancelled_at)}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="rounded-2xl bg-white border border-slate-100 p-4">
        <h3 className="font-bold text-slate-900 mb-1">기한 (의무별 · 최초 기한은 바뀌지 않음)</h3>
        <div className="overflow-x-auto">
          <table className="text-xs w-full min-w-[520px]">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="p-1.5">주기</th>
                <th className="p-1.5">종류</th>
                <th className="p-1.5">상태</th>
                <th className="p-1.5">최초 기한</th>
                <th className="p-1.5">현재 기한</th>
                <th className="p-1.5" />
              </tr>
            </thead>
            <tbody>
              {summary.obligations.map((o) => (
                <tr key={o.id} className="border-t border-slate-50">
                  <td className="p-1.5">{o.cycleNo}</td>
                  <td className="p-1.5">{OBLIGATION_TYPE_LABELS[o.type]}</td>
                  <td className="p-1.5">
                    {OBLIGATION_STATUS_LABELS[o.status]}
                    {o.overdue && <span className="ml-1 font-bold text-amber-800">· 지남</span>}
                    {o.dueToday && <span className="ml-1 font-bold text-teal-700">· 오늘</span>}
                  </td>
                  <td className="p-1.5">{formatDue(o.initialDueKind, o.initialDueAt)}</td>
                  <td className="p-1.5">
                    {formatDue(o.currentDueKind, o.currentDueAt)}
                    {o.dueChanged && <span className="text-slate-400"> (변경됨)</span>}
                  </td>
                  <td className="p-1.5">
                    {editable && o.cycleNo === action.current_cycle && o.status !== 'fulfilled' && o.status !== 'cancelled' && (
                      <button onClick={() => open({ due: o })} className="text-teal-700 font-bold underline">
                        기한 변경
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-slate-100 p-4 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {editable && (
            <button onClick={() => open('edit')} className="min-h-[38px] px-3 rounded-full border border-slate-300 text-sm font-bold text-slate-700">
              내용·담당 수정
            </button>
          )}
          {action.status === 'draft' && (
            <button onClick={() => void mutate({ ...base, op: 'activate' })} disabled={saving} className="min-h-[38px] px-3 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300">
              진행 중으로 전환
            </button>
          )}
          {action.status === 'open' && action.kind === 'admin_direct' && (
            <button onClick={() => open('complete')} className="min-h-[38px] px-3 rounded-full bg-teal-600 text-white text-sm font-bold">
              수행 결과 기록 · 완료
            </button>
          )}
          {editable && (
            <button onClick={() => open('cancel')} className="min-h-[38px] px-3 rounded-full border border-red-300 text-red-700 text-sm font-bold">
              취소
            </button>
          )}
          {action.status === 'completed' && (
            <button onClick={() => open('reopen')} className="min-h-[38px] px-3 rounded-full border border-slate-300 text-sm font-bold text-slate-700">
              재개(새 후속 주기)
            </button>
          )}
        </div>
        {action.status === 'open' && action.kind === 'field_request' && (
          <p className="text-[11px] text-slate-500">현장 확인 요청은 현장 답변을 받아 확인하기 전에는 완료할 수 없습니다(게시·응답은 다음 단계). 필요 없어졌으면 취소하세요.</p>
        )}

        {mode === 'edit' && (
          <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
            <label className="block">
              <span className={labelClass}>확인하거나 해결하려는 사항</span>
              <input value={edit.purpose} onChange={(e) => setEdit({ ...edit, purpose: e.target.value })} className={inputClass} />
            </label>
            {action.kind === 'admin_direct' ? (
              <label className="block">
                <span className={labelClass}>조치 내용</span>
                <textarea value={edit.actionContent} onChange={(e) => setEdit({ ...edit, actionContent: e.target.value })} rows={2} className={inputClass} />
              </label>
            ) : (
              <label className="block">
                <span className={labelClass}>현장 요청 내용(미게시 초안)</span>
                <textarea value={edit.fieldMessageDraft} onChange={(e) => setEdit({ ...edit, fieldMessageDraft: e.target.value })} rows={2} className={inputClass} />
              </label>
            )}
            <label className="block">
              <span className={labelClass}>내부 메모(관리자 전용)</span>
              <textarea value={edit.internalNote} onChange={(e) => setEdit({ ...edit, internalNote: e.target.value })} rows={2} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>업무 담당(비우면 담당 미지정)</span>
              <input value={edit.ownerLabel} onChange={(e) => setEdit({ ...edit, ownerLabel: e.target.value })} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>수정 이유(선택)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            </label>
            <EnteredByField value={enteredBy} onChange={setEnteredBy} />
            <button
              onClick={() => void mutate({ ...base, op: 'update', purpose: edit.purpose, actionContent: edit.actionContent, fieldMessageDraft: edit.fieldMessageDraft, internalNote: edit.internalNote, ownerLabel: edit.ownerLabel, reason })}
              disabled={saving}
              className="self-start min-h-[38px] px-4 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300"
            >
              수정 기록
            </button>
          </div>
        )}
        {mode && typeof mode === 'object' && (
          <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
            <DueEditor label={`${OBLIGATION_TYPE_LABELS[mode.due.type]} 새 값`} value={due} onChange={setDue} allowNextVisit={mode.due.type === 'field_response'} />
            <p className="text-[11px] text-slate-500">최초 기한({formatDue(mode.due.initialDueKind, mode.due.initialDueAt)})은 그대로 남고, 바꾼 기록이 이력에 쌓입니다.</p>
            <label className="block">
              <span className={labelClass}>변경 이유(필수)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            </label>
            <EnteredByField value={enteredBy} onChange={setEnteredBy} />
            <button onClick={() => void mutate({ ...base, op: 'change_due', obligationId: mode.due.id, due: toDueInput(due), reason })} disabled={saving} className="self-start min-h-[38px] px-4 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300">
              기한 변경 기록
            </button>
          </div>
        )}
        {mode === 'complete' && (
          <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
            <label className="block">
              <span className={labelClass}>실제로 한 일과 결과 근거(필수 — 시스템이 전화·문자를 보낸 것이 아니라 관리자가 수행한 사실)</span>
              <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>남은 문제·다음에 확인할 것(선택)</span>
              <textarea value={remaining} onChange={(e) => setRemaining(e.target.value)} rows={2} className={inputClass} />
            </label>
            <EnteredByField value={enteredBy} onChange={setEnteredBy} />
            <button onClick={() => void mutate({ ...base, op: 'complete', evidence, remaining })} disabled={saving} className="self-start min-h-[38px] px-4 rounded-full bg-teal-600 text-white text-sm font-bold disabled:bg-slate-300">
              완료 기록
            </button>
          </div>
        )}
        {mode === 'cancel' && (
          <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
            <label className="block">
              <span className={labelClass}>취소 이유(필수)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            </label>
            <EnteredByField value={enteredBy} onChange={setEnteredBy} />
            <button onClick={() => void mutate({ ...base, op: 'cancel', reason })} disabled={saving} className="self-start min-h-[38px] px-4 rounded-full bg-red-600 text-white text-sm font-bold disabled:bg-slate-300">
              취소 기록
            </button>
          </div>
        )}
        {mode === 'reopen' && (
          <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] text-slate-500">이전 완료 기록과 기한은 그대로 두고 새 후속 주기를 만듭니다.</p>
            {action.kind === 'admin_direct' && <DueEditor label="새 관리자 직접 수행기한" value={dueExec} onChange={setDueExec} allowNextVisit={false} />}
            <DueEditor label="새 관리자 결과 재확인기한" value={due} onChange={setDue} allowNextVisit={false} />
            <label className="block">
              <span className={labelClass}>재개 이유(필수)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            </label>
            <EnteredByField value={enteredBy} onChange={setEnteredBy} />
            <button
              onClick={() => void mutate({ ...base, op: 'reopen', reason, verificationDue: toDueInput(due), executionDue: action.kind === 'admin_direct' ? toDueInput(dueExec) : null })}
              disabled={saving}
              className="self-start min-h-[38px] px-4 rounded-full bg-slate-900 text-white text-sm font-bold disabled:bg-slate-300"
            >
              재개 기록
            </button>
          </div>
        )}
        <ErrorLine error={error} onReload={reload} />
      </section>

      {view.linkedSafetyReviews.length > 0 && (
        <section className="rounded-2xl bg-white border border-slate-100 p-4">
          <h3 className="font-bold text-slate-900 mb-1">이 조치에 연결된 안전 검토</h3>
          <ul className="text-sm text-slate-700">
            {view.linkedSafetyReviews.map((s) => (
              <li key={s.id}>
                <button onClick={() => onOpenReport(s.report_id)} className="underline">
                  {formatKoreanDateTime(s.reviewed_at)} · {SAFETY_OUTCOME_LABELS[s.outcome]}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl bg-white border border-slate-100 p-4">
        <h3 className="font-bold text-slate-900 mb-1">이력 ({events.length}건 · 수정·삭제되지 않음)</h3>
        <ol className="text-xs text-slate-600 flex flex-col gap-1">
          {events.map((e) => (
            <li key={e.id} className="border-t border-slate-50 pt-1">
              <span className="font-bold text-slate-800">{EVENT_LABELS[e.event_type]}</span> · {formatKoreanDateTime(e.occurred_at)}
              {e.reason && ` · 이유: ${e.reason}`}
              {e.event_type === 'due_changed' && describeDueChange(e.detail)}
              {e.entered_by_label && ` · 입력한 확인자 ${e.entered_by_label}`}
              {` · 당시 담당 ${e.owner_label_at_event ?? '미지정'}`}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function describeDueChange(detail: Record<string, unknown>): string {
  const from = detail.from as { kind: DueKind; at: string | null } | undefined
  const to = detail.to as { kind: DueKind; at: string | null } | undefined
  if (!from || !to) return ''
  return ` · ${formatDue(from.kind, from.at)} → ${formatDue(to.kind, to.at)}${detail.was_overdue ? ' (변경 당시 이미 지남)' : ''}`
}
