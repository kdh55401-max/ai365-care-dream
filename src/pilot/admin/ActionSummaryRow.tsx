import { ACTION_KIND_LABELS, ACTION_STATUS_LABELS, OBLIGATION_TYPE_LABELS } from '../../../shared/workflow'
import type { ActionSummary } from '../../../shared/workflowViews'
import { formatDue } from './adminFormat'

/** 조치 한 줄 요약(목록·수급자 상세·보고 상세 공통). */
export function ActionSummaryRow({ a, onOpen }: { a: ActionSummary; onOpen: (id: string) => void }) {
  const current = a.obligations.filter((o) => o.cycleNo === a.currentCycle)
  return (
    <button onClick={() => onOpen(a.id)} className="text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{ACTION_STATUS_LABELS[a.status]}</span>
        <span className="font-bold text-slate-900">수급자 {a.recipientCode}</span>
        <span className="text-slate-500 text-xs">{ACTION_KIND_LABELS[a.kind]}</span>
        {a.overdue && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">기한 지남</span>}
        {a.dueToday && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">오늘 재확인</span>}
        {a.kind === 'field_request' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">현장 요청 미게시</span>}
      </div>
      <p className="text-sm text-slate-700 mt-0.5">{a.purpose}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">
        {a.ownerLabel ? `담당 ${a.ownerLabel}(입력값)` : '담당 미지정'} ·{' '}
        {current.map((o) => `${OBLIGATION_TYPE_LABELS[o.type]} ${formatDue(o.currentDueKind, o.currentDueAt)}`).join(' · ')}
      </p>
    </button>
  )
}
