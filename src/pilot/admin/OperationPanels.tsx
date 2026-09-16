import { useEffect, useState } from 'react'
import type { AdminRepo, StatsResponse } from '../shared/adminRepo'
import {
  METRIC_STATE_LABELS,
  OPERATION_PERIODS,
  formatDuration,
  type OperationMetric,
  type OperationMetricsView,
  type OperationPeriod,
} from '../../../shared/operationMetrics'
import type { WorkBoard } from '../../../shared/workBoard'
import { formatKoreanDateTime } from './adminFormat'
import { SpinnerIcon } from './adminBadges'

/** 6단계 — 운영 지표(2·3단계 이벤트 기반)와 시스템 상태.
 *
 * 연구용 실증 지표(shared/statsCalc.ts · 아래 '실증 지표 자세히 보기')와 분모·기간·의미가 다르다.
 * 두 가지를 같은 표에 섞지 않고 섹션을 나눠 보여준다. 값만 내놓지 않고 분자·분모·단위·기간·
 * 기준시각·원천 이벤트·제외 건수·해석 주의를 항상 함께 보인다. */

const PERIOD_LABELS: Record<OperationPeriod, string> = { 7: '최근 7일', 30: '최근 30일', 90: '최근 90일', 0: '전체 기간' }

const STATE_STYLE: Record<string, string> = {
  ok: 'bg-teal-100 text-teal-800',
  not_measurable: 'bg-slate-200 text-slate-600',
  not_applicable: 'bg-slate-100 text-slate-500',
  error: 'bg-red-100 text-red-700',
}

function MetricCard({ metric }: { metric: OperationMetric }) {
  const [open, setOpen] = useState(false)
  const hasRatio = metric.state === 'ok' && metric.percent !== null && metric.denominator !== null
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="operation-metric" data-metric={metric.id}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-bold text-slate-900 text-sm">{metric.label}</h4>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${STATE_STYLE[metric.state] ?? STATE_STYLE.not_measurable}`}>
          {METRIC_STATE_LABELS[metric.state]}
        </span>
      </div>

      {hasRatio ? (
        <p className="mt-1.5">
          <span className="text-2xl font-bold text-slate-900">{metric.percent}%</span>
          <span className="text-xs text-slate-500 ml-2">
            {metric.numerator} / {metric.denominator}
            {metric.unit}
          </span>
        </p>
      ) : metric.state === 'ok' && metric.values.length > 0 ? (
        // 비율이 아닌 지표(최초 검토시간·재개방 건수)는 첫 값을 크게 보인다.
        <p className="mt-1.5">
          <span className="text-2xl font-bold text-slate-900">{metric.values[0].text}</span>
          <span className="text-xs text-slate-500 ml-2">{metric.values[0].label}</span>
        </p>
      ) : (
        <p className="mt-1.5 text-sm font-bold text-slate-500">{metric.stateNote ?? '—'}</p>
      )}
      {hasRatio && metric.stateNote && <p className="text-[11px] text-slate-500 mt-0.5">{metric.stateNote}</p>}

      {metric.values.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {metric.values.map((v) => (
            <div key={v.label} className="text-[11px]">
              <dt className="text-slate-400">{v.label}</dt>
              <dd className="text-slate-700 font-semibold">{v.text}</dd>
            </div>
          ))}
        </dl>
      )}

      <button onClick={() => setOpen((v) => !v)} className="mt-2 text-[11px] font-bold text-teal-700 underline" aria-expanded={open}>
        {open ? '정의·분모 접기' : '정의·분모·제외 보기'}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 text-[11px] text-slate-600 border-t border-slate-100 pt-2">
          <p>
            <span className="font-bold text-slate-700">정의 · </span>
            {metric.definition}
          </p>
          <p>
            <span className="font-bold text-slate-700">원천 · </span>
            {metric.sources.join(' / ')}
          </p>
          {metric.excluded.length > 0 && (
            <div>
              <p className="font-bold text-slate-700">분모에서 뺀 것</p>
              <ul className="list-disc ml-4">
                {metric.excluded.map((x) => (
                  <li key={x.label}>
                    {x.label} {x.count}건{x.note ? ` — ${x.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {metric.breakdown.length > 0 && (
            <div>
              <p className="font-bold text-slate-700">참고 구성</p>
              <ul className="list-disc ml-4">
                {metric.breakdown.map((x) => (
                  <li key={x.label}>
                    {x.label} {x.count}건{x.note ? ` — ${x.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {metric.cautions.length > 0 && (
            <div>
              <p className="font-bold text-slate-700">해석 주의</p>
              <ul className="list-disc ml-4">
                {metric.cautions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function OperationMetricsPanel({ repo, orgId }: { repo: AdminRepo; orgId: string }) {
  const [period, setPeriod] = useState<OperationPeriod>(30)
  const [view, setView] = useState<OperationMetricsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  // '다시 계산 중'은 따로 상태를 두지 않고 받아 온 결과의 기간과 고른 기간을 비교해 판단한다.
  const stale = view !== null && view.window.days !== period

  useEffect(() => {
    // 기간을 빨리 바꾸면 응답이 뒤바뀔 수 있어, 화면을 떠난 요청의 결과는 버린다.
    let alive = true
    repo
      .getOperationMetrics(orgId, period)
      .then((next) => {
        if (!alive) return
        setView(next)
        setError(null)
      })
      .catch((e: unknown) => {
        // 조회 실패는 "0건"이 아니라 오류다 — 이전 결과가 있으면 그대로 두고 오류를 함께 알린다.
        if (alive) setError(e instanceof Error ? e.message : '운영 지표를 불러오지 못했습니다.')
      })
    return () => {
      alive = false
    }
  }, [repo, orgId, period])

  return (
    <section className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 flex flex-col gap-3" aria-label="운영 지표">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-900">운영 지표 (업무 연결)</h2>
          <p className="text-xs text-slate-500 mt-0.5">2·3단계에서 실제로 저장한 업무 이벤트로만 계산합니다. 아래 연구용 실증 지표와 분모·기간·의미가 다릅니다.</p>
        </div>
        <div className="flex gap-1" role="group" aria-label="집계 기간">
          {OPERATION_PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs px-2.5 py-1 rounded-full font-bold ${period === p ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'}`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">
          오류 — {error}
          {view && ' (아래는 이전에 받은 결과입니다)'}
        </p>
      )}
      {!view && !error && (
        <div className="flex justify-center py-6">
          <SpinnerIcon className="w-5 h-5 text-teal-600" />
        </div>
      )}
      {stale && <p className="text-[11px] text-slate-400">기간을 바꿔 다시 계산하는 중입니다 — 아래는 이전 기간의 결과입니다.</p>}

      {view && (
        <>
          <p className="text-[11px] text-slate-500 bg-slate-50 rounded-xl p-2.5" data-testid="operation-window">
            기간 {view.window.startDate ?? '처음'} ~ {view.window.endDate} · 한국시간 자정 경계(시작 포함) · 기준시각 {formatKoreanDateTime(view.asOf)}
            {!view.workflowReady && ' · 2단계 저장소 미적용'}
            {view.workflowReady && !view.fieldRequestsReady && ' · 3단계 저장소 미적용'}
          </p>

          <div className="grid sm:grid-cols-2 gap-2">
            {view.metrics.map((m) => (
              <MetricCard key={m.id} metric={m} />
            ))}
          </div>

          <div>
            <h3 className="font-bold text-slate-900 text-sm mt-2">원천 상태별 실제 건수 (지금 상태)</h3>
            <p className="text-[11px] text-slate-500">기간 성과가 아니라 현재 남아 있는 업무입니다 — 위 비율과 분모가 다릅니다.</p>
            <ul className="mt-2 grid sm:grid-cols-3 gap-2">
              {view.sourceCounts.map((s) => (
                <li key={s.id} className="rounded-2xl border border-slate-200 p-3">
                  <p className="text-[11px] text-slate-500 font-semibold">{s.label}</p>
                  {s.ready ? (
                    <p className="text-lg font-bold text-slate-900">
                      {s.count}
                      <span className="text-xs font-normal text-slate-500 ml-1">{s.unit}</span>
                    </p>
                  ) : (
                    <p className="text-sm font-bold text-slate-400">준비 중 (DB 적용 전)</p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5">{s.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}

/** AI 처리 실패·전송 실패·갱신 지연 — 수급자 안전 신호와 분리해서 본다. */
export function SystemStatusStrip({ board, boardError, stats, lastRefreshed }: { board: WorkBoard | null; boardError: string | null; stats: StatsResponse | null; lastRefreshed: string }) {
  const fallback = stats?.stats.quality.fallbackRate ?? null
  const unknown = stats?.stats.quality.fallbackUnknownCount ?? null
  return (
    <section className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5" aria-label="시스템 상태">
      <h2 className="font-bold text-slate-900">시스템 상태</h2>
      <p className="text-[11px] text-slate-500 mt-0.5">수급자 안전 신호는 시스템 오류가 아닙니다 — 위 &lsquo;안전 신호 미검토&rsquo; 카드에서 봅니다.</p>
      <ul className="mt-3 grid sm:grid-cols-3 gap-2">
        <li className="rounded-2xl border border-slate-200 p-3">
          <p className="text-[11px] text-slate-500 font-semibold">업무 자료 갱신</p>
          {boardError ? (
            <p className="text-sm font-bold text-red-700">오류 — {boardError}</p>
          ) : board ? (
            <p className="text-sm font-bold text-slate-900">정상</p>
          ) : (
            <p className="text-sm font-bold text-slate-400">불러오는 중</p>
          )}
          <p className="text-[10px] text-slate-400 mt-0.5">
            서버 기준시각 {board ? formatKoreanDateTime(board.asOf) : '-'} · 화면 갱신 {lastRefreshed}
          </p>
        </li>
        <li className="rounded-2xl border border-slate-200 p-3">
          <p className="text-[11px] text-slate-500 font-semibold">AI 처리 실패(규칙 대체)</p>
          {fallback && fallback.denominator > 0 ? (
            <p className="text-sm font-bold text-slate-900">
              {fallback.numerator} / {fallback.denominator}건
              <span className="text-xs font-normal text-slate-500 ml-1">({fallback.percent}%)</span>
            </p>
          ) : (
            <p className="text-sm font-bold text-slate-400">{stats ? '측정 전 (기록된 표본 없음)' : '불러오는 중'}</p>
          )}
          <p className="text-[10px] text-slate-400 mt-0.5">{unknown ? `확인 불가(이 기록 이전) ${unknown}건` : '저장이 실패한 것이 아니라 최종 보고문을 규칙으로 대체한 건수입니다.'}</p>
        </li>
        <li className="rounded-2xl border border-slate-200 p-3">
          <p className="text-[11px] text-slate-500 font-semibold">전송 실패</p>
          <p className="text-sm font-bold text-slate-400">미측정</p>
          <p className="text-[10px] text-slate-400 mt-0.5">전송 실패·재시도를 따로 저장하지 않습니다 — 0건이 아니라 측정하지 않는 것입니다.</p>
        </li>
      </ul>
    </section>
  )
}

/** 현장 부담 — 기존 실증 지표의 정의를 그대로 쓰고 표본·기간만 드러낸다. */
export function FieldBurdenPanel({ stats }: { stats: StatsResponse }) {
  const q = stats.stats.quality
  const t = q.completionTime
  return (
    <section className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5" aria-label="현장 부담">
      <h2 className="font-bold text-slate-900">현장 부담 (기존 정의 유지)</h2>
      <p className="text-[11px] text-slate-500 mt-0.5">
        실증기간 {stats.pilotPeriod.start} ~ {stats.pilotPeriod.end} · 제출 보고 기준. 정의와 분모는 기존 실증 지표 그대로입니다.
      </p>
      <dl className="mt-3 grid sm:grid-cols-3 gap-2">
        <div className="rounded-2xl border border-slate-200 p-3">
          <dt className="text-[11px] text-slate-500 font-semibold">작성 경과시간 중앙값</dt>
          <dd className="text-lg font-bold text-slate-900">{t.sampleCount > 0 ? formatDuration(t.medianAllSeconds) : '측정 전'}</dd>
          <p className="text-[10px] text-slate-400 mt-0.5">표본 {t.sampleCount}건 · 시작~제출 전체 경과시간</p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-3">
          <dt className="text-[11px] text-slate-500 font-semibold">추가질문 발생률</dt>
          <dd className="text-lg font-bold text-slate-900">
            {q.followupOccurredRate.percent === null ? '측정 전' : `${q.followupOccurredRate.percent}%`}
          </dd>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {q.followupOccurredRate.numerator} / {q.followupOccurredRate.denominator}건 · AI가 실제로 질문한 보고
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-3">
          <dt className="text-[11px] text-slate-500 font-semibold">제출 완료율</dt>
          <dd className="text-lg font-bold text-slate-900">{q.completionRate.percent === null ? '측정 전' : `${q.completionRate.percent}%`}</dd>
          <p className="text-[10px] text-slate-400 mt-0.5">
            제출 {q.completionBreakdown.completed} · 장기 미완료 {q.completionBreakdown.longPending} · 진행 중 {q.completionBreakdown.inProgress}(분모 제외)
          </p>
        </div>
      </dl>
      <ul className="mt-2 text-[11px] text-slate-500 list-disc ml-4">
        <li>제출까지의 경과시간은 화면을 켜 둔 시간이 섞일 수 있어 실제 노동시간이 아닙니다 — 시간 절감의 근거로 쓰지 않습니다.</li>
        <li>전후 비교를 하려면 같은 조건의 이전 기록이 있어야 합니다. 이 배포에는 도입 전 로그가 없어 전후 효과를 주장하지 않습니다.</li>
        <li>실패·재시도 횟수는 저장하지 않아 미측정입니다.</li>
      </ul>
    </section>
  )
}
