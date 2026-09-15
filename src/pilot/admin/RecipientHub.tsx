import { useEffect, useState } from 'react'
import type { AdminRepo, RecipientHubResponse, RecipientTimelineResponse } from '../shared/adminRepo'
import type { StructuredReport } from '../shared/types'
import type { ReviewQueueItem, ReviewReason, TimelineEntry, TimelinePeriod } from '../../../shared/recipientHub'
import { FIELD_LABELS, formatKoreanDateTime } from './adminFormat'
import { FallbackBadge, SpinnerIcon } from './adminBadges'
import { ActionSummaryRow } from './ActionSummaryRow'
import { DECISION_LABELS, SAFETY_OUTCOME_LABELS } from '../../../shared/workflow'
import type { RecipientWorkflowView } from '../../../shared/workflowViews'

/** 관리자 수급자 허브 — 기관 → 수급자 목록 → 수급자 상세(보고 타임라인)와 기관 첫
 * 화면의 "검토할 보고" 목록. 계산은 shared/recipientHub.ts(서버·데모 공통)가 하고
 * 여기서는 그리기만 한다. 승인/반려는 기존 보고 상세(ReportDetailPanel)에서 한다. */

function errorStatus(e: unknown): number | null {
  return e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number'
    ? (e as { status: number }).status
    : null
}

function errorMessage(e: unknown, fallback: string): string {
  const status = errorStatus(e)
  if (status === 403) return '이 기관의 기록에 접근할 권한이 없습니다.'
  if (status === 401) return '관리자 로그인이 필요합니다. 다시 로그인해 주세요.'
  return e instanceof Error && e.message ? e.message : fallback
}

const REPORT_TYPE_LABEL = { daily: '기본보고', additional: '추가보고' } as const

function ReviewBadge({ status }: { status: TimelineEntry['review']['status'] }) {
  const style = status === 'approved' ? 'bg-teal-100 text-teal-700' : status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
  const label = status === 'approved' ? '승인됨' : status === 'rejected' ? '반려됨(기록 수정 요청)' : '검토 대기'
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${style}`}>{label}</span>
}

function ReasonChips({ reasons }: { reasons: ReviewReason[] }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {reasons.map((r) => (
        <li
          key={r.code}
          className={`text-[11px] px-2 py-0.5 rounded-full border ${r.tone === 'alert' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
        >
          {r.label}
        </li>
      ))}
    </ul>
  )
}

/** 기관 첫 화면의 "검토할 보고" — 숫자가 아니라 실제 보고와 그 이유를 보여준다. */
export function ReviewQueueList({
  items,
  error,
  onOpenReport,
  onOpenRecipient,
}: {
  items: ReviewQueueItem[] | null
  error: string | null
  onOpenReport: (id: string) => void
  onOpenRecipient: (code: string) => void
}) {
  if (error) return <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">{error}</p>
  if (!items) {
    return (
      <div className="flex justify-center py-6">
        <SpinnerIcon className="w-5 h-5 text-teal-600" />
      </div>
    )
  }
  if (items.length === 0) {
    return <p className="text-slate-500 text-sm bg-slate-50 rounded-xl p-3">지금 검토를 기다리는 제출 보고가 없습니다.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-slate-400 text-xs">
        검토할 보고 {items.length}건 · 정렬: 응급 표현 감지 표시가 있는 보고 먼저, 그다음 제출이 오래된 순(위험도 점수 아님)
      </p>
      {items.map((item) => (
        <div
          key={item.reportId}
          className={`rounded-xl border p-3 ${item.emergencyFlagged ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'}`}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-bold text-slate-900">수급자 {item.recipientCode}</span>
            <span className="text-slate-500">요양보호사 {item.participantCode}</span>
            <span className="text-slate-400 text-xs">
              {item.submittedAt ? `${formatKoreanDateTime(item.submittedAt)} 제출` : '제출 시각 없음'} · {REPORT_TYPE_LABEL[item.reportType]}
            </span>
          </div>
          {item.excerpt && (
            <p className="text-slate-700 text-sm mt-1">
              <span className="text-slate-400 text-xs">{item.excerptSource === 'caregiver_final' ? '관찰(요양보호사 확인본): ' : '원문: '}</span>
              {item.excerpt}
            </p>
          )}
          <div className="mt-1.5">
            <ReasonChips reasons={item.reasons} />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => onOpenReport(item.reportId)}
              className="min-h-[36px] px-3 rounded-full bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
            >
              보고 열기 · 승인/반려
            </button>
            <button
              onClick={() => onOpenRecipient(item.recipientCode)}
              className="min-h-[36px] px-3 rounded-full border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50"
            >
              {item.recipientCode} 기록 흐름 보기
            </button>
          </div>
        </div>
      ))}

    </div>
  )
}

export function RecipientsPanel({
  repo,
  orgId,
  onOpenRecipient,
}: {
  repo: AdminRepo
  orgId: string
  onOpenRecipient: (code: string) => void
}) {
  const [data, setData] = useState<RecipientHubResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 기관이 바뀌면 부모가 key로 이 패널을 새로 그리므로 여기서 이전 값을 지우지 않는다.
  useEffect(() => {
    let cancelled = false
    repo
      .getRecipientHub(orgId)
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && setError(errorMessage(e, '수급자 목록을 불러오지 못했습니다.')))
    return () => {
      cancelled = true
    }
  }, [repo, orgId])

  if (error) return <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">{error}</p>
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <SpinnerIcon className="w-6 h-6 text-teal-600" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold text-slate-900">
          {data.organization.name} · 수급자 {data.recipients.length}명
        </h2>
        <p className="text-slate-400 text-xs mt-0.5">검토 대기 보고가 있는 수급자를 먼저 보여줍니다. 표준상황 연습·삭제된 보고는 세지 않습니다.</p>
      </div>
      {data.recipients.length === 0 && <p className="text-slate-400 text-center py-10">등록된 수급자가 없습니다.</p>}
      {data.recipients.map((r) => (
        <button
          key={r.code}
          onClick={() => onOpenRecipient(r.code)}
          className="text-left rounded-2xl bg-white border border-slate-100 shadow-sm p-4 hover:border-teal-300 transition"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-900 text-base">수급자 {r.code}</span>
            {!r.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">비활성</span>}
            {r.pendingReviewCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-white">검토 대기 {r.pendingReviewCount}건</span>
            )}
            {r.pendingEmergencyCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">응급 표현 감지 {r.pendingEmergencyCount}건</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            담당 요양보호사: {r.caregivers.length > 0 ? r.caregivers.join(', ') : <span className="text-amber-700 font-semibold">담당 미배정</span>}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            최근 제출:{' '}
            {r.lastSubmitted ? `${formatKoreanDateTime(r.lastSubmitted.submittedAt)} (${r.lastSubmitted.participantCode})` : '제출된 보고 없음'}
            {' · '}제출 보고 {r.submittedCount}건{r.draftCount > 0 ? ` · 제출 전 임시저장 ${r.draftCount}건` : ''}
          </p>
        </button>
      ))}
    </div>
  )
}

function StructuredFields({ report }: { report: StructuredReport }) {
  return (
    <div className="flex flex-col gap-1">
      {FIELD_LABELS.map(({ key, label }) => (
        <p key={key} className="text-sm text-slate-700">
          <span className="text-slate-400">{label}: </span>
          {report[key]?.trim() ? report[key] : '-'}
        </p>
      ))}
    </div>
  )
}

function sameStructured(a: StructuredReport | null, b: StructuredReport | null): boolean {
  if (!a || !b) return false
  return FIELD_LABELS.every(({ key }) => (a[key] ?? '').trim() === (b[key] ?? '').trim())
}

/** workflow: undefined = 업무 저장소 준비 전(표시 안 함), null = 준비됐지만 이 보고에 기록 없음. */
function TimelineCard({ entry, onOpenReport, workflow }: { entry: TimelineEntry; onOpenReport: (id: string) => void; workflow?: RecipientWorkflowView['byReport'][string] | null }) {
  const pending = entry.review.status === 'pending'
  const { structured, review } = entry
  return (
    <article className={`rounded-2xl bg-white border p-4 ${entry.emergencyFlagged ? 'border-red-200' : 'border-slate-100'} shadow-sm`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold text-slate-900 text-sm">{entry.submittedAt ? `${formatKoreanDateTime(entry.submittedAt)} 제출` : '제출 시각 없음'}</span>
        <span className="text-slate-500 text-xs">{REPORT_TYPE_LABEL[entry.reportType]} · 보고일 {entry.reportDate}</span>
        <span className="text-slate-500 text-xs">작성: 요양보호사 {entry.author.code}</span>
        <ReviewBadge status={review.status} />
        {entry.emergencyFlagged && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">🔴 응급 표현 감지(규칙 기반)</span>}
      </div>

      {workflow !== undefined && (
        <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
          <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
            관리자 판단: {workflow?.decision ? DECISION_LABELS[workflow.decision.decision] : '없음'}
          </span>
          {entry.emergencyFlagged && (
            <span className={`px-2 py-0.5 rounded-full border ${workflow?.safety ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-red-200 bg-red-50 text-red-700 font-bold'}`}>
              안전 검토: {workflow?.safety ? SAFETY_OUTCOME_LABELS[workflow.safety.outcome] : '기록 없음'}
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-700">이 보고의 조치 {workflow?.actionIds.length ?? 0}건</span>
        </div>
      )}

      {pending && entry.reviewReasons.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-slate-500 mb-1">확인할 이유</p>
          <ReasonChips reasons={entry.reviewReasons} />
        </div>
      )}

      <div className="mt-2">
        <p className="text-[11px] font-semibold text-slate-500 mb-1">항목별 상태 (보고 때 저장된 값만)</p>
        {entry.observations.length === 0 ? (
          <p className="text-xs text-slate-400">이 보고에는 항목별 상태가 저장되지 않았습니다 — 정상·이상으로 해석하지 않습니다.</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {entry.observations.map((o) => (
              <li
                key={`${o.domain}-${o.status}`}
                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                  o.status === 'changed'
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : o.status === 'same_as_usual'
                      ? 'bg-teal-50 border-teal-100 text-teal-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                {o.label}: {o.statusLabel}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="mt-3 rounded-xl border border-slate-100" open={pending}>
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-600">원문 · 구조화 기록 · 관리자 검토 보기</summary>
        <div className="px-3 pb-3 flex flex-col gap-3">
          <section>
            <p className="text-xs font-bold text-slate-700">① 보고 원문 — 요양보호사가 말하거나 입력한 그대로 (보고자 진술)</p>
            <div className="mt-1 bg-slate-50 rounded-lg p-2 whitespace-pre-wrap text-sm text-slate-700">{entry.raw.text.trim() || '(원문 없음)'}</div>
            {entry.raw.followups.length > 0 && (
              <div className="mt-1.5 text-sm text-slate-700 flex flex-col gap-0.5">
                <p className="text-[11px] text-slate-400">추가 질문 · 요양보호사 답변</p>
                {entry.raw.followups.map((f, i) => (
                  <p key={i}>
                    Q. {f.question} → A. {f.answer?.trim() ? f.answer : <span className="text-slate-400">(답 없음)</span>}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-slate-700">② 구조화 기록 — 요양보호사 확인·제출본</p>
              <FallbackBadge used={structured.aiFallbackUsed} ruleBasedByDesign={structured.ruleBasedByDesign} />
              {structured.caregiverEdited === true && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">요양보호사가 초안을 고쳐 제출</span>
              )}
            </div>
            <div className="mt-1">
              {structured.caregiverFinal ? <StructuredFields report={structured.caregiverFinal} /> : <p className="text-sm text-slate-400">제출본 없음</p>}
            </div>
            {structured.aiDraft && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] text-slate-500 underline">
                  {structured.ruleBasedByDesign ? '규칙 기반 자동 정리 초안 보기' : 'AI 정리 초안 보기'} (요양보호사 확인 전)
                </summary>
                <div className="mt-1 bg-slate-50 rounded-lg p-2">
                  <StructuredFields report={structured.aiDraft} />
                </div>
              </details>
            )}
          </section>

          <section>
            <p className="text-xs font-bold text-slate-700">③ 관리자 검토 (공유 관리자 계정 — 개인 식별 불가)</p>
            <div className="mt-1 text-sm text-slate-700 flex flex-col gap-0.5">
              <p>
                <ReviewBadge status={review.status} />{' '}
                {review.reviewedAt ? <span className="text-xs text-slate-500">처리 {formatKoreanDateTime(review.reviewedAt)}</span> : null}
              </p>
              <p className="text-xs text-slate-500">
                {review.firstViewedAt ? `관리자 첫 열람 ${formatKoreanDateTime(review.firstViewedAt)}` : '관리자가 아직 보고 상세를 열지 않음'}
                {review.historyCount > 0 ? ` · 이전 검토 이력 ${review.historyCount}건` : ''}
              </p>
              {review.status !== 'pending' && review.adminFinal && !sameStructured(review.adminFinal, structured.caregiverFinal) && (
                <div className="mt-1 bg-teal-50 rounded-lg p-2">
                  <p className="text-[11px] text-teal-700 font-bold mb-0.5">관리자가 고친 검토본</p>
                  <StructuredFields report={review.adminFinal} />
                </div>
              )}
              {review.note && (
                <p className="text-xs mt-1">
                  {review.status === 'rejected' ? '반려 사유' : '검토 메모'}: {review.note}{' '}
                  <span className={`font-bold ${review.noteVisibleToCaregiver ? 'text-teal-600' : 'text-slate-400'}`}>
                    ({review.noteVisibleToCaregiver ? '요양보호사에게 공개됨' : '관리자 전용'})
                  </span>
                </p>
              )}
            </div>
          </section>
        </div>
      </details>

      <button
        onClick={() => onOpenReport(entry.reportId)}
        className="mt-3 min-h-[40px] px-4 rounded-full border-2 border-slate-900 text-slate-900 text-xs font-bold hover:bg-slate-50"
      >
        원본 보고 열기{pending ? ' · 승인/반려' : ''}
      </button>
    </article>
  )
}

const PERIOD_OPTIONS: Array<{ value: TimelinePeriod; label: string }> = [
  { value: '7', label: '최근 7일' },
  { value: '30', label: '최근 30일' },
  { value: 'all', label: '전체' },
]

export function RecipientDetailPanel({
  repo,
  orgId,
  code,
  period,
  onChangePeriod,
  onOpenReport,
  onOpenAction,
  onBackToList,
}: {
  repo: AdminRepo
  orgId: string
  code: string
  period: TimelinePeriod
  onChangePeriod: (p: TimelinePeriod) => void
  onOpenReport: (id: string) => void
  onOpenAction: (id: string) => void
  onBackToList: () => void
}) {
  const [reloadKey, setReloadKey] = useState(0)
  // 결과를 요청 조건과 함께 보관한다 — 기간을 바꾸면 조건이 달라져 곧바로 "불러오는 중"이
  // 되고, 이전 기간의 이력을 새 기간 것처럼 잠깐이라도 보여주지 않는다.
  const requestKey = `${orgId}|${code}|${period}|${reloadKey}`
  const [result, setResult] = useState<
    { key: string; data: RecipientTimelineResponse; error?: undefined } | { key: string; data?: undefined; error: { status: number | null; message: string } } | null
  >(null)

  useEffect(() => {
    let cancelled = false
    repo
      .getRecipientTimeline(orgId, code, period)
      .then((res) => !cancelled && setResult({ key: requestKey, data: res }))
      .catch((e) => !cancelled && setResult({ key: requestKey, error: { status: errorStatus(e), message: errorMessage(e, '보고 이력을 불러오지 못했습니다.') } }))
    return () => {
      cancelled = true
    }
  }, [repo, orgId, code, period, requestKey])

  const current = result?.key === requestKey ? result : null
  const data = current?.data ?? null
  const error = current?.error ?? null

  const back = (
    <button onClick={onBackToList} className="text-slate-400 text-sm self-start">
      ← 수급자 목록
    </button>
  )

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <div className="rounded-2xl bg-red-50 border border-red-100 p-4">
          <p className="text-red-700 font-bold">{error.message}</p>
          {error.status !== 403 && error.status !== 404 && (
            <button onClick={() => setReloadKey((k) => k + 1)} className="mt-2 text-red-700 text-sm font-bold underline">
              다시 불러오기
            </button>
          )}
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <div className="flex justify-center py-16">
          <SpinnerIcon className="w-6 h-6 text-teal-600" />
        </div>
      </div>
    )
  }

  const { recipient, timeline } = data
  const latestInPeriod = timeline.entries[0]
  const latestIsInPeriod = Boolean(recipient.lastSubmitted && latestInPeriod && latestInPeriod.reportId === recipient.lastSubmitted.reportId)
  const latestChange = latestIsInPeriod ? (latestInPeriod.structured.caregiverFinal?.change ?? '').trim() || latestInPeriod.raw.text.trim() : ''

  return (
    <div className="flex flex-col gap-4">
      {back}
      <section className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900">수급자 {recipient.code}</h2>
          {!recipient.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">비활성</span>}
          <span className="text-slate-400 text-xs">{data.organization.name}</span>
        </div>
        <p className="text-sm text-slate-600 mt-1">
          담당 요양보호사: {recipient.caregivers.length > 0 ? recipient.caregivers.join(', ') : <span className="text-amber-700 font-semibold">담당 미배정</span>}
        </p>
        <p className="text-sm text-slate-600 mt-0.5">
          검토 대기 {recipient.pendingReviewCount}건
          {recipient.pendingEmergencyCount > 0 && <span className="text-red-700 font-semibold"> (응급 표현 감지 {recipient.pendingEmergencyCount}건)</span>}
          <span className="text-slate-400 text-xs"> · 전체 기간 기준</span>
        </p>
        <div className="mt-2 bg-slate-50 rounded-xl p-3 text-sm">
          <p className="text-[11px] font-semibold text-slate-500">최근 관찰</p>
          {!recipient.lastSubmitted ? (
            <p className="text-slate-400">제출된 보고가 없습니다.</p>
          ) : latestIsInPeriod ? (
            <p className="text-slate-700">
              {latestChange || '(내용 없음)'}{' '}
              <span className="text-slate-400 text-xs">
                — {formatKoreanDateTime(recipient.lastSubmitted.submittedAt)} 요양보호사 {recipient.lastSubmitted.participantCode} 보고
              </span>
            </p>
          ) : (
            <p className="text-slate-500">
              최근 제출은 {formatKoreanDateTime(recipient.lastSubmitted.submittedAt)} — 선택한 기간 밖입니다. 기간을 넓혀 확인하세요.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-2">
        <h3 className="font-bold text-slate-900 text-sm">현재 미완료 조치</h3>
        {!data.workflow.workflowReady ? (
          <p className="text-xs text-slate-500">준비 중 — 조치 저장소가 DB에 적용되기 전입니다.</p>
        ) : (
          (() => {
            const open = data.workflow.actions.filter((a) => a.status === 'open' || a.status === 'draft')
            return open.length === 0 ? (
              <p className="text-xs text-slate-500">진행 중·초안 조치 0건</p>
            ) : (
              open.map((a) => <ActionSummaryRow key={a.id} a={a} onOpen={onOpenAction} />)
            )
          })()
        )}
      </section>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2" role="group" aria-label="조회 기간">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.value}
              onClick={() => onChangePeriod(p.value)}
              aria-pressed={period === p.value}
              className={`px-3 py-1.5 rounded-full text-xs font-bold ${period === p.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-slate-400 text-[11px]">
          {timeline.since ? `${timeline.since} ~ ${timeline.today} · ` : ''}기간은 보고일(한국 시간) 기준, 시각은 제출 시각 기준입니다 — 관찰 시각은 따로 저장되지 않습니다.
        </p>
      </div>

      {timeline.drafts.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800 flex flex-col gap-1">
          <p>제출 전 임시저장 {timeline.drafts.length}건 — 요양보호사가 아직 제출하지 않아 검토 대상이 아닙니다.</p>
          {timeline.drafts
            .filter((d) => d.emergencyFlagged)
            .map((d) => (
              <button key={d.reportId} onClick={() => onOpenReport(d.reportId)} className="text-left font-bold underline">
                🔴 응급 표현이 감지된 미제출 기록 ({formatKoreanDateTime(d.startedAt)} 시작, {d.participantCode}) 열기
              </button>
            ))}
        </div>
      )}

      {timeline.entries.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-100 p-6 text-center">
          <p className="text-slate-500">선택한 기간에 제출된 보고가 없습니다.</p>
          {period !== 'all' && (
            <button onClick={() => onChangePeriod('all')} className="mt-2 text-teal-700 text-sm font-bold underline">
              전체 기간 보기
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-slate-500 text-xs">보고 {timeline.entries.length}건 · 최신 제출이 위</p>
          {timeline.entries.map((entry) => (
            <TimelineCard key={entry.reportId} entry={entry} onOpenReport={onOpenReport} workflow={data.workflow.workflowReady ? (data.workflow.byReport[entry.reportId] ?? null) : undefined} />
          ))}
        </div>
      )}
    </div>
  )
}
