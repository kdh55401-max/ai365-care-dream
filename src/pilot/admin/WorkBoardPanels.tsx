import { useEffect, useState } from 'react'
import type { ActionListResponse, AdminRepo } from '../shared/adminRepo'
import {
  WORK_CATEGORY_LABELS,
  type ActionWorkItem,
  type RequestWorkItem,
  type SafetySignalItem,
  type VerificationWorkItem,
  type WorkBoard,
  type WorkCategory,
} from '../../../shared/workBoard'
import { ACTION_KIND_LABELS, OBLIGATION_TYPE_LABELS, RESPONSE_STATUS_LABELS, SAFETY_OUTCOME_LABELS, type DueKind, type ResponseStatus } from '../../../shared/workflow'
import { REQUEST_WAIT_LABELS, ROUTING_PROBLEM_LABELS } from '../../../shared/fieldRequests'
import { CANDIDATE_DECISION_LABELS } from '../../../shared/changeCandidates'
import { ACTION_FILTER_LABELS, ACTION_FILTERS, type ActionFilter } from '../../../shared/workflowViews'
import { formatDue, formatKoreanDateTime, type WorkCard } from './adminFormat'
import { formatDuration } from '../../../shared/operationMetrics'
import { SpinnerIcon } from './adminBadges'
import { ReviewQueueList } from './RecipientHub'
import { ActionSummaryRow } from './ActionSummaryRow'

/** 기관 첫 화면의 업무 카드·통합 목록, 카드별 전체 목록, 조치 목록(2단계).
 * 숫자와 목록은 모두 서버가 같은 기준 시각으로 계산한 WorkBoard에서 나온다. */


const CATEGORY_STYLE: Record<WorkCategory, string> = {
  safety: 'bg-red-100 text-red-700',
  overdue: 'bg-amber-100 text-amber-800',
  verification_today: 'bg-teal-100 text-teal-800',
  verification_pending: 'bg-indigo-100 text-indigo-800',
  reassign: 'bg-orange-100 text-orange-800',
  report_attention: 'bg-slate-900 text-white',
  report_general: 'bg-slate-100 text-slate-600',
}

function Card({ title, onClick, children, tone = 'plain' }: { title: string; onClick: () => void; children: React.ReactNode; tone?: 'alert' | 'plain' | 'muted' }) {
  const style = tone === 'alert' ? 'bg-red-50 border-red-200' : tone === 'muted' ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200'
  return (
    <button onClick={onClick} className={`text-left rounded-2xl border p-3 hover:border-teal-400 transition ${style}`}>
      <p className="text-xs font-semibold text-slate-500">{title}</p>
      <div className="mt-1">{children}</div>
      <p className="text-[10px] text-teal-700 font-bold mt-1.5">전체 목록 보기 →</p>
    </button>
  )
}

function NotReady() {
  return (
    <>
      <p className="text-base font-bold text-slate-400">준비 중</p>
      <p className="text-[11px] text-slate-400 mt-0.5">DB 마이그레이션 적용 전 — 숫자를 만들지 않습니다</p>
    </>
  )
}

/** 네 카드는 대상·단위가 달라 합산하지 않는다. */
/** 기준 시각에서 얼마나 기다렸는지 — 카드와 목록이 같은 board.asOf를 쓴다. */
function waitedFor(since: string | null, asOf: string): string | null {
  const from = since ? Date.parse(since) : NaN
  const to = Date.parse(asOf)
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  return formatDuration(Math.max(0, (to - from) / 1000))
}

export function WorkCards({ board, onOpenCard }: { board: WorkBoard; onOpenCard: (card: WorkCard) => void }) {
  const { cards } = board
  return (
    <div>
      <p className="text-[11px] text-slate-400 mb-1.5">
        카드마다 세는 단위가 다릅니다(신호·보고·조치·요청·수급자) — 숫자를 더하지 마세요. 카드를 누르면 같은 기준 시각·같은 조건의 전체 목록이 열립니다.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card title="안전 신호 미검토" onClick={() => onOpenCard('safety')} tone={cards.safety.signals > 0 ? 'alert' : 'plain'}>
          {cards.safety.ready ? (
            <p className="text-xl font-bold text-slate-900">
              {cards.safety.signals}건 <span className="text-xs font-normal text-slate-500">· 수급자 {cards.safety.recipients}명</span>
            </p>
          ) : (
            <>
              <p className="text-xl font-bold text-slate-900">
                {cards.safety.signals}건 <span className="text-xs font-normal text-slate-500">검토 여부 미확인</span>
              </p>
              <p className="text-[11px] text-slate-400">안전 검토 저장 준비 전(DB 적용 필요)</p>
            </>
          )}
          {(cards.safety.draftSignals > 0 || cards.safety.legacyUnclear > 0) && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              {cards.safety.draftSignals > 0 && `미제출 ${cards.safety.draftSignals}건 별도`}
              {cards.safety.draftSignals > 0 && cards.safety.legacyUnclear > 0 && ' · '}
              {cards.safety.legacyUnclear > 0 && `이전 보고 검토 여부 불명확 ${cards.safety.legacyUnclear}건`}
            </p>
          )}
        </Card>
        <Card title="새 보고 미확인" onClick={() => onOpenCard('reports')}>
          <p className="text-xl font-bold text-slate-900">
            {cards.reports.reports}건 <span className="text-xs font-normal text-slate-500">· 수급자 {cards.reports.recipients}명</span>
          </p>
          <p className="text-[11px] text-slate-400">제출 후 승인·반려 기록이 없는 보고</p>
          {/* '일반 미확인'이 계속 뒤로 밀리지 않도록 대기 건수와 최장 대기시간을 카드에서 바로 보인다. */}
          <p className="text-[11px] text-slate-500 mt-0.5" data-testid="reports-waiting">
            변화·확인 필요 {cards.reports.attention}건 · 일반 {cards.reports.general}건
            {cards.reports.oldestGeneralSince && ` · 일반 최장 대기 ${waitedFor(cards.reports.oldestGeneralSince, board.asOf)}`}
          </p>
        </Card>
        <Card title="기한 지난 조치" onClick={() => onOpenCard('overdue')} tone={cards.overdue.ready ? 'plain' : 'muted'}>
          {cards.overdue.ready ? (
            <>
              <p className="text-xl font-bold text-slate-900">
                {cards.overdue.actions}건 <span className="text-xs font-normal text-slate-500">조치</span>
              </p>
              <p className="text-[11px] text-slate-400">지난 기한 {cards.overdue.obligations}개(응답·재확인·수행 기한 합)</p>
            </>
          ) : (
            <NotReady />
          )}
        </Card>
        <Card title="오늘 재확인" onClick={() => onOpenCard('today')} tone={cards.today.ready ? 'plain' : 'muted'}>
          {cards.today.ready ? (
            <>
              <p className="text-xl font-bold text-slate-900">
                {cards.today.actions}건 <span className="text-xs font-normal text-slate-500">조치</span>
              </p>
              <p className="text-[11px] text-slate-400">한국 날짜 {board.today.date} 관리자 재확인기한</p>
            </>
          ) : (
            <NotReady />
          )}
        </Card>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
        <Card title="현장 응답 대기 요청" onClick={() => onOpenCard('requests')} tone={cards.requests.ready ? 'plain' : 'muted'}>
          {cards.requests.ready ? (
            <>
              <p className="text-xl font-bold text-slate-900">
                {cards.requests.requests}건 <span className="text-xs font-normal text-slate-500">요청</span>
              </p>
              <p className="text-[11px] text-slate-400">
                기한 지남 {cards.requests.overdue} · 보고 있었지만 답 없음 {cards.requests.reportsWithoutAnswer} · 방문 대기 {cards.requests.awaitingVisit}
              </p>
            </>
          ) : (
            <NotReady />
          )}
        </Card>
        <Card title="응답 도착 · 결과 확인 대기" onClick={() => onOpenCard('verification')} tone={cards.verification.ready ? 'plain' : 'muted'}>
          {cards.verification.ready ? (
            <>
              <p className="text-xl font-bold text-slate-900">
                {cards.verification.actions}건 <span className="text-xs font-normal text-slate-500">조치</span>
              </p>
              <p className="text-[11px] text-slate-400">현장 답은 왔고 관리자 결과 확인 전(완료 아님)</p>
            </>
          ) : (
            <NotReady />
          )}
        </Card>
        <Card title="재배정·담당 필요" onClick={() => onOpenCard('reassign')} tone={cards.reassign.ready ? 'plain' : 'muted'}>
          {cards.reassign.ready ? (
            <>
              <p className="text-xl font-bold text-slate-900">
                {cards.reassign.requests}건 <span className="text-xs font-normal text-slate-500">요청</span>
              </p>
              <p className="text-[11px] text-slate-400">담당 미지정 조치 {cards.reassign.unassignedActions}건 별도</p>
            </>
          ) : (
            <NotReady />
          )}
        </Card>
        <Card title="반복 보고 후보" onClick={() => onOpenCard('repeat')}>
          <p className="text-xl font-bold text-slate-900">
            {cards.repeat.candidates}건 <span className="text-xs font-normal text-slate-500">· 수급자 {cards.repeat.recipients}명</span>
          </p>
          <p className="text-[11px] text-slate-400">
            보고일 기준 최근 7일 · 판단 전 {cards.repeat.unreviewed}건 · 변화가 보고된 수급자 {cards.repeat.changedRecipients}명(신호 {cards.repeat.signals}건)
          </p>
        </Card>
      </div>
      <p className="text-[10px] text-slate-400 mt-1.5">
        카드는 대상과 단위가 달라 합산하지 않습니다 · 서버 전체 집계 · 기준 시각 {formatKoreanDateTime(board.asOf)} · 오늘 제출 보고 {board.todayActivity.submittedReports}건(요양보호사 {board.todayActivity.participants}명)
      </p>
    </div>
  )
}

/** 운영 규칙 순서의 통합 목록(같은 대상은 가장 앞 범주에 한 번). 전부 보여준다. */
export function CombinedWorkList({
  board,
  onOpenReport,
  onOpenAction,
  onOpenRecipient,
}: {
  board: WorkBoard
  onOpenReport: (id: string) => void
  onOpenAction: (id: string) => void
  onOpenRecipient: (code: string) => void
}) {
  if (board.combined.length === 0) return <p className="text-slate-500 text-sm bg-slate-50 rounded-xl p-3">지금 처리할 업무가 없습니다(0건).</p>
  return (
    <div className="flex flex-col gap-2">
      <p className="text-slate-400 text-xs">
        지금 할 일 {board.combined.length}건 · 순서: 안전 신호 미검토 → 기한 지난 조치 → 오늘 재확인 → 응답 도착·결과 확인 → 재배정 필요 → 변화·확인 필요 보고 → 새 보고, 같은 범주는 오래 기다린 순(운영 규칙 — 임상 중증도 아님)
      </p>
      {board.combined.map((item) => (
        <div key={item.key} className={`rounded-xl border p-3 ${item.category === 'safety' ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'}`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CATEGORY_STYLE[item.category]}`}>{WORK_CATEGORY_LABELS[item.category]}</span>
            <span className="font-bold text-slate-900">수급자 {item.recipientCode}</span>
            <span className="text-slate-400 text-xs">{item.waitingSince ? `${formatKoreanDateTime(item.waitingSince)}부터` : '시각 없음'}</span>
          </div>
          <p className="text-slate-700 text-sm mt-1">{item.headline}</p>
          {item.notes.length > 0 && <p className="text-[11px] text-slate-500 mt-0.5">{item.notes.join(' · ')}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            {item.actionId && (
              <button onClick={() => onOpenAction(item.actionId!)} className="min-h-[34px] px-3 rounded-full bg-slate-900 text-white text-xs font-bold">
                조치 열기
              </button>
            )}
            {item.reportId && (
              <button
                onClick={() => onOpenReport(item.reportId!)}
                className={`min-h-[34px] px-3 rounded-full text-xs font-bold ${item.actionId ? 'border border-slate-300 text-slate-700' : 'bg-slate-900 text-white'}`}
              >
                {item.actionId ? '근거 보고' : '보고 열기 · 검토'}
              </button>
            )}
            <button onClick={() => onOpenRecipient(item.recipientCode)} className="min-h-[34px] px-3 rounded-full border border-slate-300 text-slate-700 text-xs font-bold">
              {item.recipientCode} 기록 흐름
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function SafetyRows({ items, onOpenReport, note }: { items: SafetySignalItem[]; onOpenReport: (id: string) => void; note?: string }) {
  if (items.length === 0) return <p className="text-slate-500 text-sm bg-slate-50 rounded-xl p-3">0건</p>
  return (
    <div className="flex flex-col gap-2">
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
      {items.map((s) => (
        <button key={s.reportId} onClick={() => onOpenReport(s.reportId)} className="text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300">
          <p className="text-sm">
            <span className="font-bold text-slate-900">수급자 {s.recipientCode}</span> <span className="text-slate-500">요양보호사 {s.participantCode}</span>{' '}
            <span className="text-slate-400 text-xs">
              {s.reportStatus === 'submitted' ? '제출' : '임시저장 시작'} {formatKoreanDateTime(s.at)}
            </span>
          </p>
          <p className="text-sm text-slate-700 mt-0.5">{s.excerpt ?? '(원문 없음)'}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            안전 검토: {s.latestReview ? SAFETY_OUTCOME_LABELS[s.latestReview.outcome] : '기록 없음'} · 보고 검토:{' '}
            {s.reportReviewStatus === 'approved' ? '승인됨' : s.reportReviewStatus === 'rejected' ? '반려됨' : '대기'}(별개)
          </p>
        </button>
      ))}
    </div>
  )
}

function ActionRows({ items, onOpenAction, mode }: { items: ActionWorkItem[]; onOpenAction: (id: string) => void; mode: 'overdue' | 'today' }) {
  if (items.length === 0) return <p className="text-slate-500 text-sm bg-slate-50 rounded-xl p-3">0건</p>
  return (
    <div className="flex flex-col gap-2">
      {items.map((a) => (
        <button key={a.actionId} onClick={() => onOpenAction(a.actionId)} className="text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300">
          <p className="text-sm">
            <span className="font-bold text-slate-900">수급자 {a.recipientCode}</span> <span className="text-slate-500">{ACTION_KIND_LABELS[a.kind]}</span>
          </p>
          <p className="text-sm text-slate-700 mt-0.5">{a.purpose}</p>
          <ul className="text-[11px] text-slate-600 mt-0.5">
            {(mode === 'overdue' ? a.overdue : a.dueToday).map((o) => (
              <li key={o.obligationId}>
                {OBLIGATION_TYPE_LABELS[o.type]}: {formatDue(o.dueKind, o.dueAt)}
                {(o.initialDueKind !== o.dueKind || o.initialDueAt !== o.dueAt) && ` (최초 ${formatDue(o.initialDueKind, o.initialDueAt)})`}
              </li>
            ))}
          </ul>
          <p className="text-[11px] mt-0.5">{a.ownerLabel ? <span className="text-slate-500">담당 {a.ownerLabel}(입력값)</span> : <span className="text-amber-700 font-semibold">담당 미지정</span>}</p>
        </button>
      ))}
    </div>
  )
}

function RequestRows({ items, onOpenAction }: { items: RequestWorkItem[]; onOpenAction: (id: string) => void }) {
  if (items.length === 0) return <p className="text-slate-500 text-sm bg-slate-50 rounded-xl p-3">0건</p>
  return (
    <div className="flex flex-col gap-2">
      {items.map((r) => (
        <button key={r.requestId} onClick={() => onOpenAction(r.actionId)} className="text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300">
          <p className="text-sm">
            <span className="font-bold text-slate-900">수급자 {r.recipientCode}</span>{' '}
            <span className="text-slate-500">{r.targetMode === 'specific_caregiver' ? `대상 ${r.targetCaregiverCode}` : '현재 배정 요양보호사'}</span>{' '}
            <span className="text-slate-400 text-xs">게시 {formatKoreanDateTime(r.publishedAt)}</span>
          </p>
          <p className="text-sm text-slate-700 mt-0.5">“{r.message}”</p>
          <p className="text-[11px] text-slate-600 mt-0.5">
            응답기한 {formatDue(r.responseDueKind as DueKind, r.responseDueAt)} · {r.waitState ? REQUEST_WAIT_LABELS[r.waitState] : '-'}
            {r.reportsSincePublish > 0 && ` · 게시 뒤 보고 ${r.reportsSincePublish}건`}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">{r.firstShownAt ? `현장 화면 첫 표시 ${formatKoreanDateTime(r.firstShownAt)}` : '현장 화면 표시 기록 없음'}</p>
          {r.routing && <p className="text-[11px] text-orange-700 font-semibold mt-0.5">{ROUTING_PROBLEM_LABELS[r.routing]}</p>}
        </button>
      ))}
    </div>
  )
}

function VerificationRows({ items, onOpenAction }: { items: VerificationWorkItem[]; onOpenAction: (id: string) => void }) {
  if (items.length === 0) return <p className="text-slate-500 text-sm bg-slate-50 rounded-xl p-3">0건</p>
  return (
    <div className="flex flex-col gap-2">
      {items.map((v) => (
        <button key={v.requestId} onClick={() => onOpenAction(v.actionId)} className="text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300">
          <p className="text-sm">
            <span className="font-bold text-slate-900">수급자 {v.recipientCode}</span> <span className="text-slate-400 text-xs">응답 도착 {formatKoreanDateTime(v.answeredAt)}</span>
          </p>
          <p className="text-sm text-slate-700 mt-0.5">{v.purpose}</p>
          <p className="text-[11px] text-slate-600 mt-0.5">
            응답 {v.responseCount}건 · 최근 답: {v.latestResponseStatus ? RESPONSE_STATUS_LABELS[v.latestResponseStatus as ResponseStatus] : '-'} ·{' '}
            {v.ownerLabel ? `담당 ${v.ownerLabel}(입력값)` : '담당 미지정'}
          </p>
        </button>
      ))}
    </div>
  )
}

const CARD_TITLES: Record<WorkCard, string> = {
  safety: '안전 신호 미검토',
  reports: '새 보고 미확인',
  overdue: '기한 지난 조치',
  today: '오늘 재확인',
  requests: '현장 응답 대기 요청',
  verification: '응답 도착 · 결과 확인 대기',
  reassign: '재배정·담당 필요',
  repeat: '반복 보고 후보(보고일 기준)',
}

/** 카드를 누르면 여는 전체 목록 — 카드 숫자와 같은 계산 결과의 목록 전부. */
export function WorkCardListPanel({
  card,
  board,
  error,
  onBack,
  onOpenReport,
  onOpenAction,
  onOpenRecipient,
}: {
  card: WorkCard
  board: WorkBoard | null
  error: string | null
  onBack: () => void
  onOpenReport: (id: string) => void
  onOpenAction: (id: string) => void
  onOpenRecipient: (code: string) => void
}) {
  const back = (
    <button onClick={onBack} className="text-slate-400 text-sm self-start">
      ← 기관 첫 화면
    </button>
  )
  if (error) return <div className="flex flex-col gap-3">{back}<p className="text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">{error}</p></div>
  if (!board) return <div className="flex flex-col gap-3">{back}<div className="flex justify-center py-16"><SpinnerIcon className="w-6 h-6 text-teal-600" /></div></div>
  const ready = board.workflowReady
  return (
    <div className="flex flex-col gap-3">
      {back}
      <div>
        <h2 className="text-lg font-bold text-slate-900">{CARD_TITLES[card]}</h2>
        <p className="text-[11px] text-slate-400">기준 시각 {formatKoreanDateTime(board.asOf)} · 서버 전체 집계(첫 화면 카드와 같은 계산)</p>
      </div>
      {card === 'safety' && (
        <>
          {!ready && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-2">안전 검토 저장소가 준비되기 전입니다(DB 마이그레이션 적용 필요) — 아래는 기록된 신호일 뿐 검토 여부는 확인할 수 없습니다.</p>}
          <SafetyRows items={board.lists.safety} onOpenReport={onOpenReport} note="제출된 보고의 규칙 기반 응급 표현 신호 중 안전 검토 기록이 없는 것 — 보고 승인과 별개. 안전 검토 완료가 대상자 안전을 보증하지 않습니다." />
          <h3 className="font-bold text-slate-900 text-sm mt-2">제출 전 임시저장에 남은 신호 ({board.lists.safetyDrafts.length}건 · 제출 지표 제외)</h3>
          <SafetyRows items={board.lists.safetyDrafts} onOpenReport={onOpenReport} note="서버에 저장된 임시저장만 보입니다. 기기에만 있는 초안은 수집하지 않습니다." />
          {ready && (
            <>
              <h3 className="font-bold text-slate-900 text-sm mt-2">이전 보고 — 검토 여부 불명확 ({board.lists.safetyLegacy.length}건)</h3>
              <SafetyRows items={board.lists.safetyLegacy} onOpenReport={onOpenReport} note="이 기능 전에 보고 승인·반려만 되고 안전 검토 기록이 없는 신호 — 검토했는지 알 수 없어 따로 둡니다." />
            </>
          )}
        </>
      )}
      {card === 'reports' && <ReviewQueueList items={board.lists.reports} error={null} onOpenReport={onOpenReport} onOpenRecipient={onOpenRecipient} />}
      {(card === 'overdue' || card === 'today') &&
        (ready ? (
          <>
            <p className="text-[11px] text-slate-500">
              {card === 'overdue'
                ? '진행 중인 조치 중 현재 기한이 지난 의무가 있는 조치(조치 수). 초안·완료·취소와 게시 전 현장 응답은 제외.'
                : '진행 중인 조치 중 관리자 재확인기한이 오늘(한국 날짜)인 조치.'}
            </p>
            <ActionRows items={card === 'overdue' ? board.lists.overdue : board.lists.today} onOpenAction={onOpenAction} mode={card} />
          </>
        ) : (
          <p className="text-slate-500 bg-slate-50 rounded-xl p-3 text-sm">준비 중 — 조치·기한 저장소가 DB에 적용되기 전입니다.</p>
        ))}
      {(card === 'requests' || card === 'verification') &&
        (board.fieldRequestsReady ? (
          card === 'requests' ? (
            <>
              <p className="text-[11px] text-slate-500">
                게시돼 현장 답을 기다리는 요청(진행 중 조치). 다음 방문이 있었는지 알 수 없으면 미응답 실패로 확정하지 않습니다 — 게시 뒤 이 수급자 보고가 있었는지를 따로 보여줍니다.
              </p>
              <RequestRows items={board.lists.requests} onOpenAction={onOpenAction} />
            </>
          ) : (
            <>
              <p className="text-[11px] text-slate-500">현장 응답이 도착해 현장 응답 대기는 풀렸고, 관리자 결과 확인(요약·근거)이 남은 조치.</p>
              <VerificationRows items={board.lists.verification} onOpenAction={onOpenAction} />
            </>
          )
        ) : (
          <p className="text-slate-500 bg-slate-50 rounded-xl p-3 text-sm">준비 중 — 현장 요청 저장소(3단계 DB 마이그레이션)가 적용되기 전입니다.</p>
        ))}
      {card === 'repeat' && (
        <>
          <p className="text-[11px] text-slate-500">
            초기 운영 규칙 v1: 최근 7일(한국 날짜) 중 서로 다른 날 2일 이상, 같은 수급자·같은 세부 영역에 변화가 저장된 보고. 같은 날 여러 보고는 하루. 관찰일이 저장되지 않아
            보고일 기준입니다. 증상 지속·악화 판단이 아닙니다. 항목별 상태가 저장된 보고만 셉니다.
          </p>
          {board.lists.repeat.length === 0 ? (
            <p className="text-slate-500 text-sm bg-slate-50 rounded-xl p-3">0건</p>
          ) : (
            <div className="flex flex-col gap-2">
              {board.lists.repeat.map(({ candidate: c, latestDecision, needsRecheck, newEvidence }) => (
                <button key={c.key} onClick={() => onOpenRecipient(c.recipientCode)} className="text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300">
                  <p className="text-sm">
                    <span className="font-bold text-slate-900">수급자 {c.recipientCode}</span> <span className="text-slate-700">{c.headline}</span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    보고일 {c.days.join(', ')} · {latestDecision ? `관리자 판단: ${CANDIDATE_DECISION_LABELS[latestDecision]}` : '판단 전'}
                    {newEvidence > 0 && ` · 판단 뒤 새 보고 ${newEvidence}건`}
                    {needsRecheck && ' · 재검토 필요'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {card === 'reassign' &&
        (ready ? (
          <>
            {board.fieldRequestsReady ? (
              <>
                <p className="text-[11px] text-slate-500">게시 요청이 지금 배정 기준으로 누구에게도 보이지 않는 경우(배정 해제·지정 대상 변경).</p>
                <RequestRows items={board.lists.reassignRequests} onOpenAction={onOpenAction} />
              </>
            ) : (
              <p className="text-slate-500 bg-slate-50 rounded-xl p-3 text-sm">게시 요청 재배정: 준비 중(3단계 DB 적용 전).</p>
            )}
            <h3 className="font-bold text-slate-900 text-sm mt-2">담당 미지정 조치 ({board.lists.unassignedActions.length}건)</h3>
            <p className="text-[11px] text-slate-500">초안·진행 중 조치 중 업무 담당자 입력값이 없는 것.</p>
            <ActionRows items={board.lists.unassignedActions} onOpenAction={onOpenAction} mode="today" />
          </>
        ) : (
          <p className="text-slate-500 bg-slate-50 rounded-xl p-3 text-sm">준비 중 — 조치 저장소가 DB에 적용되기 전입니다.</p>
        ))}
    </div>
  )
}

export function ActionsPanel({
  repo,
  orgId,
  filter,
  recipientCode,
  onChangeFilter,
  onOpenAction,
}: {
  repo: AdminRepo
  orgId: string
  filter: ActionFilter
  recipientCode?: string
  onChangeFilter: (f: ActionFilter) => void
  onOpenAction: (id: string) => void
}) {
  const key = `${orgId}|${filter}|${recipientCode ?? ''}`
  const [result, setResult] = useState<{ key: string; data?: ActionListResponse; error?: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    repo
      .listActions(orgId, filter, recipientCode)
      .then((data) => !cancelled && setResult({ key, data }))
      .catch((e) => !cancelled && setResult({ key, error: e instanceof Error ? e.message : '조치 목록을 불러오지 못했습니다.' }))
    return () => {
      cancelled = true
    }
  }, [repo, orgId, filter, recipientCode, key])
  const current = result?.key === key ? result : null
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold text-slate-900">조치{recipientCode ? ` · 수급자 ${recipientCode}` : ''}</h2>
        <p className="text-[11px] text-slate-400">관리자 조치와 기한. 현장 요청은 관리자가 조치 화면에서 게시해야 현장에 보입니다.</p>
      </div>
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="조치 필터">
        {ACTION_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => onChangeFilter(f)}
            aria-pressed={filter === f}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}
          >
            {ACTION_FILTER_LABELS[f]}
          </button>
        ))}
      </div>
      {!current && (
        <div className="flex justify-center py-10">
          <SpinnerIcon className="w-6 h-6 text-teal-600" />
        </div>
      )}
      {current?.error && <p className="text-red-700 bg-red-50 border border-red-100 rounded-2xl p-3 text-sm">불러오기 실패: {current.error}</p>}
      {current?.data && !current.data.workflowReady && <p className="text-slate-500 bg-slate-50 rounded-xl p-3 text-sm">준비 중 — 조치 저장소가 DB에 적용되기 전입니다.</p>}
      {current?.data?.workflowReady && (
        <>
          <p className="text-[11px] text-slate-400">
            {current.data.actions.length}건 · 기준 시각 {formatKoreanDateTime(current.data.asOf)}
          </p>
          {current.data.actions.length === 0 && <p className="text-slate-500 bg-slate-50 rounded-xl p-3 text-sm">0건</p>}
          {current.data.actions.map((a) => (
            <ActionSummaryRow key={a.id} a={a} onOpen={onOpenAction} />
          ))}
        </>
      )}
    </div>
  )
}
