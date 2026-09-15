import { ACTION_KIND_LABELS, ACTION_STATUS_LABELS, FIELD_REQUEST_STATUS_LABELS, OBLIGATION_TYPE_LABELS, VERIFICATION_OUTCOME_LABELS } from '../../../shared/workflow'
import type { ActionSummary } from '../../../shared/workflowViews'
import { REQUEST_WAIT_LABELS } from '../../../shared/fieldRequests'
import { formatDue } from './adminFormat'

function requestBadge(a: ActionSummary): { text: string; style: string } | null {
  if (a.kind !== 'field_request') return null
  if (a.awaitingVerification) return { text: '응답 도착 · 결과 확인 대기', style: 'bg-indigo-100 text-indigo-800' }
  if (a.request?.routing) return { text: '재배정 필요', style: 'bg-orange-100 text-orange-800' }
  if (a.request) return { text: `현장 요청 ${FIELD_REQUEST_STATUS_LABELS[a.request.status]}`, style: 'bg-sky-100 text-sky-800' }
  if (a.fieldMessageStatus === 'unpublished' && (a.status === 'open' || a.status === 'draft')) return { text: '현장 요청 미게시', style: 'bg-slate-100 text-slate-500' }
  return null
}

/** 조치 한 줄 요약(목록·수급자 상세·보고 상세 공통). */
export function ActionSummaryRow({ a, onOpen }: { a: ActionSummary; onOpen: (id: string) => void }) {
  const current = a.obligations.filter((o) => o.cycleNo === a.currentCycle)
  const badge = requestBadge(a)
  return (
    <button onClick={() => onOpen(a.id)} className="text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{ACTION_STATUS_LABELS[a.status]}</span>
        <span className="font-bold text-slate-900">수급자 {a.recipientCode}</span>
        <span className="text-slate-500 text-xs">{ACTION_KIND_LABELS[a.kind]}</span>
        {a.overdue && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">기한 지남</span>}
        {a.dueToday && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">오늘 재확인</span>}
        {badge && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.style}`}>{badge.text}</span>}
        {a.closureOutcome && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">결과: {VERIFICATION_OUTCOME_LABELS[a.closureOutcome]}</span>
        )}
      </div>
      <p className="text-sm text-slate-700 mt-0.5">{a.purpose}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">
        {a.ownerLabel ? `담당 ${a.ownerLabel}(입력값)` : '담당 미지정'} ·{' '}
        {current.map((o) => `${OBLIGATION_TYPE_LABELS[o.type]} ${formatDue(o.currentDueKind, o.currentDueAt)}`).join(' · ')}
      </p>
      {a.request?.status === 'published' && a.request.waitState && <p className="text-[11px] text-slate-500 mt-0.5">{REQUEST_WAIT_LABELS[a.request.waitState]}</p>}
    </button>
  )
}
