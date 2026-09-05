import { useEffect, useRef, useState } from 'react'
import { ApiClientError } from '../shared/api'
import { SafetyFooter } from '../shared/SafetyNotice'
import type { FollowupItem, StructuredReport } from '../shared/types'
import { computeInformativeness } from '../shared/types'
import type { AdminRepo, ReportDetail, ReportListItem, StatsResponse } from '../shared/adminRepo'
import { realAdminRepo } from '../shared/adminRepo'
import { isDemoMode } from '../shared/demoMode'
import { demoAdminRepo } from '../demo/demoAdminRepo'
import { resetDemoData, DEMO_ADMIN_ALIAS_PASSWORD } from '../demo/demoStore'
import { computeRawInformativeness, type Fraction } from '../../../shared/statsCalc'
import { BeforeAfterBarChart, CumulativeLineChart, type BeforeAfterMetric } from './charts'

type Tab = 'dashboard' | 'reports' | 'participants'
const PARTICIPANT_CODES = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09']
const INSTITUTION_NAME = '가드림365재가복지센터'
const TARGET_PARTICIPANTS = 9
const TARGET_DAILY = 90

// 표기 규칙(사양서 예시 "14건 중 10건, 71.4%" 기준): 분모(전체) 먼저, 분자(해당) 나중.
function fmtPct(f: Fraction, unit = '건'): string {
  if (f.denominator === 0) return `평가 전`
  return `${f.denominator}${unit} 중 ${f.numerator}${unit}, ${f.percent}%`
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className ?? ''}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function InfoTip({ title, formula, num, den, note }: { title: string; formula: string; num?: number; den?: number; note?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block ml-1 align-middle">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`${title} 지표 설명`}
        className="w-4 h-4 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold leading-4 text-center hover:bg-slate-300"
      >
        i
      </button>
      {open && (
        <div className="absolute z-10 left-0 top-5 w-56 rounded-xl bg-slate-900 text-white text-[11px] p-3 shadow-lg leading-relaxed">
          <p className="font-bold mb-1">{title}</p>
          <p className="text-slate-300">{formula}</p>
          {den !== undefined && (
            <p className="text-slate-300 mt-1">
              분자 {num ?? 0} / 분모 {den}
            </p>
          )}
          {note && <p className="text-slate-400 mt-1">{note}</p>}
          <button onClick={() => setOpen(false)} className="mt-2 text-teal-300 font-bold">
            닫기
          </button>
        </div>
      )}
    </span>
  )
}

function StatCard({
  label, value, sub, big, tip,
}: { label: string; value: string; sub?: string; big?: boolean; tip?: React.ReactNode }) {
  return (
    <div className={`rounded-2xl bg-white border border-slate-100 shadow-sm p-4 ${big ? 'sm:col-span-2' : ''}`}>
      <p className="text-slate-500 text-xs font-semibold flex items-center">
        {label}
        {tip}
      </p>
      <p className={`text-slate-900 font-bold mt-1 ${big ? 'text-3xl' : 'text-lg'}`}>{value}</p>
      {sub && <p className="text-slate-400 text-xs mt-0.5 whitespace-pre-line">{sub}</p>}
    </div>
  )
}

function ConnectionBadge({ state, lastReceived, lastRefreshed }: { state: 'live' | 'delayed' | 'down'; lastReceived: string; lastRefreshed: string }) {
  const styles = {
    live: 'bg-green-50 text-green-700 border-green-200',
    delayed: 'bg-orange-50 text-orange-700 border-orange-200',
    down: 'bg-red-50 text-red-700 border-red-200',
  }
  const labels = { live: '실시간 연결', delayed: '갱신 지연', down: '연결 확인 필요' }
  return (
    <div className="text-right text-xs">
      <span className={`inline-block px-2 py-1 rounded-full border font-bold ${styles[state]}`}>{labels[state]}</span>
      <p className="text-slate-400 mt-1">마지막 수신 {lastReceived || '-'}</p>
      <p className="text-slate-400">마지막 갱신 {lastRefreshed || '-'}</p>
    </div>
  )
}

function LoginScreen({ demo, onLogin }: { demo: boolean; onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setLoading(true)
    setError(null)
    try {
      await onLogin(password)
    } catch (e) {
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : '로그인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <div className="text-center mb-2">
          <p className="text-teal-600 font-semibold">AI365 CARE DREAM</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">관리자 로그인</h1>
          {demo && <p className="text-amber-600 text-xs mt-2 font-bold">데모 모드 — 비밀번호 {DEMO_ADMIN_ALIAS_PASSWORD}</p>}
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          className="w-full text-lg border border-slate-300 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-teal-500"
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        {error && <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-3">{error}</p>}
        <button
          onClick={() => void submit()}
          disabled={!password || loading}
          className="w-full min-h-[48px] rounded-full bg-slate-900 text-white font-bold hover:bg-slate-800 transition disabled:bg-slate-300"
        >
          {loading ? '확인 중...' : '로그인'}
        </button>
      </div>
    </div>
  )
}

function ParticipantTable({ stats, reports }: { stats: StatsResponse; reports: ReportListItem[] }) {
  const rows = PARTICIPANT_CODES.map((code) => {
    const own = reports.filter((r) => r.participant_code === code && r.status === 'submitted')
    const daily = own.filter((r) => r.report_type === 'daily')
    const additional = own.filter((r) => r.report_type === 'additional')
    const lastDate = own.reduce<string | null>((acc, r) => (!acc || (r.report_date ?? '') > acc ? r.report_date ?? acc : acc), null)
    const lastActivity = own.reduce<string | null>((acc, r) => (!acc || (r.submitted_at ?? '') > acc ? r.submitted_at ?? acc : acc), null)
    const secs = own.map((r) => r.completion_seconds).filter((n): n is number => typeof n === 'number')
    const avgSec = secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : null
    const evaluated = own.filter((r) => r.ai_evaluated_at).length
    const submittedToday = daily.some((r) => r.report_date === stats.today)
    const repeatBadge = stats.stats.noChangeFlow.repeatNoInfoParticipants.includes(code)
    return { code, daily: daily.length, additional: additional.length, lastDate, lastActivity, avgSec, evaluated, own: own.length, submittedToday, repeatBadge }
  })

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white">
      <table className="text-xs w-full min-w-[640px]">
        <thead>
          <tr className="text-slate-400 text-left">
            <th className="p-2">참여자</th>
            <th className="p-2">최근 사용일</th>
            <th className="p-2">오늘 제출</th>
            <th className="p-2">기본 누적</th>
            <th className="p-2">추가 누적</th>
            <th className="p-2">평균 완료시간</th>
            <th className="p-2">관리자 평가</th>
            <th className="p-2">마지막 활동</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-t border-slate-50">
              <td className="p-2 font-bold text-slate-700">
                {r.code}
                {r.repeatBadge && (
                  <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">관찰정보 부족</span>
                )}
              </td>
              <td className="p-2 text-slate-500">{r.lastDate ?? '-'}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.submittedToday ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                  {r.submittedToday ? '제출' : '미제출'}
                </span>
              </td>
              <td className="p-2">{r.daily}</td>
              <td className="p-2">{r.additional}</td>
              <td className="p-2">{r.avgSec ?? '-'}{r.avgSec ? '초' : ''}</td>
              <td className="p-2">{r.own === 0 ? '-' : `${r.evaluated}/${r.own}`}</td>
              <td className="p-2 text-slate-400">{r.lastActivity ? r.lastActivity.slice(0, 16).replace('T', ' ') : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Dashboard({ demo, data, reports, onOpen }: { demo: boolean; data: StatsResponse | null; reports: ReportListItem[]; onOpen: (id: string) => void }) {
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <SpinnerIcon className="w-6 h-6 text-teal-600" />
      </div>
    )
  }
  const { stats, participationGrid, scenarioStats, cumulativeSeries } = data
  const isEmpty = stats.volume.totalCount === 0 && stats.participation.participantsWithAtLeastOne === 0

  const noticeCount = stats.quality.adminEvalCompletionRate.denominator
  const headlinePercent = stats.coreHeadline.percent
  const summarySentence =
    noticeCount >= 10 && stats.beforeAfter.rawActionable.percent !== null && stats.beforeAfter.aiActionable.percent !== null
      ? `요양보호사 ${stats.participation.participantsWithAtLeastOne}명이 ${stats.volume.totalCount}건을 사용했으며, 관리자가 추가 질문 없이 바로 판단한 보고 비율은 AI 적용 전 ${stats.beforeAfter.rawActionable.percent}%에서 적용 후 ${stats.beforeAfter.aiActionable.percent}%로 ${
          stats.beforeAfter.actionableDeltaPp !== null && stats.beforeAfter.actionableDeltaPp >= 0 ? '+' : ''
        }${stats.beforeAfter.actionableDeltaPp}%p 변화했습니다. 초기 실증에서 개선 신호가 관찰됐습니다.`
      : null

  const beforeAfterMetrics: BeforeAfterMetric[] = [
    { label: '바로판단가능률', before: stats.beforeAfter.rawActionable, after: stats.beforeAfter.aiActionable },
    { label: '추가질문불필요율', before: stats.beforeAfter.rawNoFollowupNeeded, after: stats.beforeAfter.aiNoFollowupNeeded },
    { label: '정보충실도(0~4)', before: stats.beforeAfter.informativenessBefore, after: stats.beforeAfter.informativenessAfter, maxValue: 4 },
    { label: '관리자 유용성(1~5)', before: null, after: stats.quality.aiUsefulnessAvg, afterOnly: true, maxValue: 5 },
  ]

  return (
    <div className="flex flex-col gap-6">
      {demo && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-2 text-amber-700 text-sm font-bold text-center">
          DEMO DATA · 실제 실증 결과가 아닙니다
        </div>
      )}

      <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">AI365 CARE DREAM 현장 실증 대시보드</h1>
            <p className="text-slate-500 text-sm mt-1">
              {INSTITUTION_NAME} · 실증기간 {data.pilotPeriod.start} ~ {data.pilotPeriod.end}
            </p>
            <p className="text-slate-400 text-xs mt-1">
              전체 참여 예정자 {TARGET_PARTICIPANTS}명 · 기본보고 목표 {TARGET_DAILY}건
            </p>
          </div>
          <ConnectionBadge
            state={demo ? 'live' : 'live'}
            lastReceived={data.generatedAt.slice(0, 16).replace('T', ' ')}
            lastRefreshed={new Date().toISOString().slice(0, 16).replace('T', ' ')}
          />
        </div>
        {summarySentence && !demo && <p className="text-slate-700 text-sm mt-4 bg-slate-50 rounded-xl p-3 leading-relaxed">{summarySentence}</p>}
        {demo && <p className="text-slate-400 text-sm mt-4">데모 데이터입니다.</p>}
        {!demo && !summarySentence && (
          <p className="text-slate-400 text-sm mt-4">관리자 평가가 10건 이상 쌓이면 실증 요약 문장이 자동으로 표시됩니다.</p>
        )}
      </div>

      <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label="실제 참여자"
              value={`${stats.participation.participantsWithAtLeastOne} / ${TARGET_PARTICIPANTS}명`}
              sub="보고를 1건 이상 제출한 참여자"
              tip={<InfoTip title="실제 참여자" formula="고유 participant_code 수 ÷ 전체 참여 예정자 9명" den={TARGET_PARTICIPANTS} num={stats.participation.participantsWithAtLeastOne} />}
            />
            <StatCard
              label="누적 돌봄보고"
              value={`${stats.volume.dailyCount} / ${TARGET_DAILY}건`}
              sub={`기본보고 목표 달성률 ${stats.volume.goalMain.percent ?? 0}%\n추가 상태변화 보고 ${stats.volume.additionalCount}건`}
              tip={<InfoTip title="누적 돌봄보고" formula="최종 제출된 daily 보고 건수 ÷ 목표 90건" den={TARGET_DAILY} num={stats.volume.dailyCount} />}
            />
            <StatCard
              label="재사용률"
              value={stats.participation.repeatUserRate.denominator === 0 ? '측정 전' : `${stats.participation.repeatUserRate.percent}%`}
              sub={`실제 참여자 ${stats.participation.repeatUserRate.denominator}명 중 ${stats.participation.repeatUserRate.numerator}명이 2회 이상 사용`}
              tip={
                <InfoTip
                  title="재사용률"
                  formula="2회 이상 제출한 참여자 수 ÷ 1회 이상 참여자 수 × 100"
                  den={stats.participation.repeatUserRate.denominator}
                  num={stats.participation.repeatUserRate.numerator}
                  note={`참여 예정자 9명 기준 보조값: ${stats.participation.repeatUserRateOfPlanned.numerator}/9`}
                />
              }
            />
            <StatCard
              label="보고 완료시간"
              value={stats.quality.completionSecondsMedian === null ? '측정 전' : `중앙값 ${Math.round(stats.quality.completionSecondsMedian)}초`}
              sub="돌봄보고 시작부터 최종 제출까지"
            />
            <StatCard
              big
              label="기관 활용 가능률"
              value={headlinePercent === null ? '평가 전' : `AI 적용 후 ${headlinePercent}%`}
              sub={
                stats.beforeAfter.rawActionable.percent === null
                  ? '평가 전'
                  : `AI 전 ${stats.beforeAfter.rawActionable.percent}% → AI 후 ${stats.beforeAfter.aiActionable.percent}%\n${
                      stats.beforeAfter.actionableDeltaPp !== null && stats.beforeAfter.actionableDeltaPp >= 0 ? '+' : ''
                    }${stats.beforeAfter.actionableDeltaPp ?? 0}%p 개선 · ${fmtPct(stats.coreHeadline)}`
              }
              tip={
                <InfoTip
                  title="기관 활용 가능률"
                  formula="관리자가 추가 확인 없이 조치 여부를 판단할 수 있었던 보고 비율 (바로이해가능=예 & 추가확인필요=아니오) ÷ 해당 단계 평가완료 건수 × 100"
                  den={stats.coreHeadline.denominator}
                  num={stats.coreHeadline.numerator}
                />
              }
            />
            <StatCard
              label="AI 사실오류율"
              value={stats.quality.inaccuracyEvaluatedCount === 0 ? '평가 전' : fmtPct(stats.quality.inaccuracyRate)}
              sub="관리자 평가에서 사실과 다른 내용이 확인된 건수"
            />
            <StatCard
              label="구조화 완료율"
              value={fmtPct(stats.quality.completionRate)}
              sub="시작한 돌봄보고 중 최종 제출까지 끝낸 비율"
              tip={<InfoTip title="구조화 완료율" formula="제출 완료(submitted) 건수 ÷ 시작한 전체 보고 건수 × 100" den={stats.quality.completionRate.denominator} num={stats.quality.completionRate.numerator} />}
            />
            <StatCard
              label="AI 추가질문 발생률"
              value={fmtPct(stats.quality.followupOccurredRate)}
              sub="AI가 추가 질문을 던진 보고 비율"
            />
            <StatCard
              label="추가정보 발견률"
              value={fmtPct(stats.quality.infoAddedRate)}
              sub="추가질문을 통해 새로운 변화 영역이 1개 이상 발견된 비율"
              tip={
                <InfoTip
                  title="추가정보 발견률"
                  formula="information_added_count>0인 보고 ÷ 제출 보고 수. information_added_count는 발견된 '사실' 개수가 아니라 새로 changed로 확인된 도메인(식사·이동 등) 개수다 — 같은 영역에서 여러 사실이 나와도 1로 집계된다."
                  den={stats.quality.infoAddedRate.denominator}
                  num={stats.quality.infoAddedRate.numerator}
                />
              }
            />
            <StatCard
              label="AI 초안 수정률"
              value={fmtPct(stats.quality.aiDraftEditRate)}
              sub="AI가 생성한 기록을 요양보호사가 수정 후 제출한 비율"
              tip={<InfoTip title="AI 초안 수정률" formula="ai_generated_report ≠ caregiver_final_report(정규화 텍스트 비교) 건수 ÷ 제출 건수 × 100" den={stats.quality.aiDraftEditRate.denominator} num={stats.quality.aiDraftEditRate.numerator} />}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <section className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <h3 className="font-bold text-slate-900 mb-3">AI 적용 전후 보고품질 비교</h3>
              {isEmpty ? (
                <p className="text-slate-400 text-sm text-center py-16">돌봄보고가 제출되면 이곳에 실시간으로 표시됩니다.</p>
              ) : (
                <BeforeAfterBarChart metrics={beforeAfterMetrics} />
              )}
            </section>
            <section className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <h3 className="font-bold text-slate-900 mb-3">일자별 누적 돌봄보고</h3>
              {isEmpty ? (
                <p className="text-slate-400 text-sm text-center py-16">돌봄보고가 제출되면 이곳에 실시간으로 표시됩니다.</p>
              ) : (
                <CumulativeLineChart series={cumulativeSeries} goal={TARGET_DAILY} />
              )}
            </section>
          </div>

          <section>
            <h3 className="font-bold text-slate-900 mb-2">현장보고 유형</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="평소와 다른 점 있음" value={fmtPct(stats.reportTypeBreakdown.changed)} />
              <StatCard label="평소와 비슷함" value={fmtPct(stats.reportTypeBreakdown.similar)} />
              <StatCard label="확인 필요" value={fmtPct(stats.reportTypeBreakdown.uncertain)} />
              <StatCard label="무정보 보고" value={fmtPct(stats.reportTypeBreakdown.noInfo)} />
            </div>
          </section>

          <section>
            <h3 className="font-bold text-slate-900 mb-2">"특이사항 없음" 대응 품질</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard
                big
                label="특이사항 없음 → 추가정보 발견률"
                value={fmtPct(stats.noChangeFlow.noChangeToInfoFoundRate)}
                sub={`특이사항 없음 최초입력 ${stats.noChangeFlow.noChangeInitialCount}건 중 AI 추가질문 후 새로운 변화 영역 발견 ${stats.noChangeFlow.noChangeInfoFoundCount}건`}
                tip={
                  <InfoTip
                    title="특이사항 없음 → 추가정보 발견률"
                    formula="no_change_initial_input=true인 보고 중 information_added_count>0인 비율. 흐름 시작 시점엔 없었지만 새로 changed로 밝혀진 도메인이 하나라도 있으면 1건으로 센다(도메인 단위 — 같은 영역에서 여러 사실이 함께 나와도 1건)."
                    den={stats.noChangeFlow.noChangeToInfoFoundRate.denominator}
                    num={stats.noChangeFlow.noChangeToInfoFoundRate.numerator}
                  />
                }
              />
              <StatCard label="무정보 보고 구체화율" value={fmtPct(stats.noChangeFlow.noInfoSpecificationRate)} />
              <StatCard
                label="평균 추가 관찰영역"
                value={stats.noChangeFlow.avgAddedDomains === null ? '측정 전' : `${stats.noChangeFlow.avgAddedDomains}개`}
                tip={<InfoTip title="평균 추가 관찰영역" formula="특이사항 없음 보고들의 information_added_count 평균 — '사실 개수'가 아니라 새로 changed로 확인된 돌봄 영역(도메인) 개수의 평균이다." />}
              />
              <StatCard label="미확인 구분률" value={fmtPct(stats.noChangeFlow.unconfirmedSeparationRate)} />
              <StatCard label="정상보고 평균 추가질문" value={stats.noChangeFlow.avgNoChangeFollowupCount === null ? '측정 전' : `${stats.noChangeFlow.avgNoChangeFollowupCount}개`} />
              <StatCard label="추가질문 응답률" value={fmtPct(stats.noChangeFlow.noChangeFollowupAnswerRate, '회')} />
              <StatCard
                label="정상보고 완료시간"
                value={stats.noChangeFlow.noChangeCompletionSecondsMedian === null ? '측정 전' : `중앙값 ${Math.round(stats.noChangeFlow.noChangeCompletionSecondsMedian)}초`}
              />
            </div>
          </section>

          <section>
            <h3 className="font-bold text-slate-900 mb-2">
              표준상황 검증 (실제 현장보고와 별도 집계 · {scenarioStats.totalCount}/{scenarioStats.targetCount}건)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="목표 진행률" value={fmtPct(scenarioStats.goal)} />
              <StatCard label="필수정보 확인률" value={fmtPct(scenarioStats.requiredInfoCoverage, '개')} />
              <StatCard label="사실 생성(오류) 건수" value={`${scenarioStats.fabricationCount}건`} />
              <StatCard label="최종보고 구조화율" value={fmtPct(scenarioStats.structuredRate)} />
            </div>
            <p className="text-slate-400 text-xs mt-2">전문가 적절성: 검증 전 (전문가 2인 평가는 아직 수행되지 않았습니다)</p>
          </section>

          <section>
            <h3 className="font-bold text-slate-900 mb-2">
              오늘 {stats.participation.todaySubmitted}명 제출
              {stats.participation.todayNotSubmittedCodes.length > 0 && ` · 미제출 ${stats.participation.todayNotSubmittedCodes.join(', ')}`}
            </h3>
            <ParticipantTable stats={data} reports={reports} />
          </section>

          <section>
            <h3 className="font-bold text-slate-900 mb-2">참여현황 히트맵</h3>
            <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white">
              <table className="text-xs w-full">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white p-2 text-left">참여자</th>
                    {participationGrid[0]?.cells.map((c) => (
                      <th key={c.date} className="p-2 whitespace-nowrap font-normal text-slate-400">
                        {c.date.slice(5)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {participationGrid.map((row) => (
                    <tr key={row.participantCode}>
                      <td className="sticky left-0 bg-white p-2 font-bold text-slate-700">{row.participantCode}</td>
                      {row.cells.map((c) => (
                        <td key={c.date} className="p-1 text-center">
                          <div
                            className={`w-6 h-6 mx-auto rounded flex items-center justify-center text-[10px] font-bold ${
                              c.date > data.today ? '' : c.dailySubmitted ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-400'
                            }`}
                            title={`${c.date} · 기본 ${c.dailySubmitted ? '제출' : '미제출'}, 추가 ${c.additionalCount}건`}
                          >
                            {c.additionalCount > 0 ? <span className="bg-teal-500 rounded-full w-full h-full flex items-center justify-center">{c.additionalCount}</span> : ''}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-slate-400 text-xs mt-2">초록 = 기본보고 제출, 청록 숫자 = 추가보고 건수, 회색 = 미제출, 빈칸 = 미래 날짜</p>
          </section>

          <section>
            <h3 className="font-bold text-slate-900 mb-2">실시간 돌봄보고</h3>
            <div className="flex flex-col gap-2">
              {reports.slice(0, 8).map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => onOpen(r.id)}
                  className={`text-left rounded-2xl bg-white border p-3 hover:border-teal-300 transition ${
                    i === 0 ? 'border-teal-300 ring-2 ring-teal-100' : 'border-slate-100'
                  }`}
                >
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-slate-900">
                      {r.participant_code} → {r.recipient_code} · {r.report_type === 'daily' ? '기본' : '추가'}
                    </span>
                    <span className="text-slate-400 text-xs">{r.submitted_at?.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{r.completion_seconds ?? '-'}초</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${r.ai_evaluated_at ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      {r.ai_evaluated_at ? '평가 완료' : '평가 대기'}
                    </span>
                    {r.ai_inaccuracy_detected && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600">사실오류</span>}
                  </div>
                </button>
              ))}
              {reports.length === 0 && <p className="text-slate-400 text-sm text-center py-6">돌봄보고가 제출되면 이곳에 실시간으로 표시됩니다.</p>}
            </div>
          </section>
        </>
    </div>
  )
}

const FIELD_LABELS: Array<{ key: keyof StructuredReport; label: string }> = [
  { key: 'change', label: '관찰한 변화' },
  { key: 'action', label: '현장에서 한 조치' },
  { key: 'result', label: '현재 상태' },
  { key: 'escalation', label: '센터 확인사항' },
]

function ReportDetailPanel({ repo, id, onBack, onChanged }: { repo: AdminRepo; id: string; onBack: () => void; onChanged: () => void }) {
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [rawActionable, setRawActionable] = useState<boolean | null>(null)
  const [rawFollowup, setRawFollowup] = useState<boolean | null>(null)
  const [rawScore, setRawScore] = useState(3)
  const [rawNote, setRawNote] = useState('')

  const [aiActionable, setAiActionable] = useState<boolean | null>(null)
  const [aiFollowup, setAiFollowup] = useState<boolean | null>(null)
  const [aiScore, setAiScore] = useState(3)
  const [followupType, setFollowupType] = useState<'none' | 'sms' | 'call'>('none')
  const [usefulness, setUsefulness] = useState(3)
  const [inaccurate, setInaccurate] = useState<boolean | null>(null)
  const [aiNote, setAiNote] = useState('')
  const [managerStatus, setManagerStatus] = useState('confirmed')

  const load = async () => {
    const r = await repo.getReport(id)
    setReport(r)
    if (r.raw_immediately_actionable !== null) setRawActionable(r.raw_immediately_actionable)
    if (r.raw_followup_needed !== null) setRawFollowup(r.raw_followup_needed)
    if (r.raw_completeness_score !== null) setRawScore(r.raw_completeness_score)
    setRawNote(r.raw_eval_note ?? '')
    if (r.ai_immediately_actionable !== null) setAiActionable(r.ai_immediately_actionable)
    if (r.ai_followup_needed !== null) setAiFollowup(r.ai_followup_needed)
    if (r.ai_completeness_score !== null) setAiScore(r.ai_completeness_score)
    if (r.actual_followup_type) setFollowupType(r.actual_followup_type)
    if (r.ai_usefulness_score !== null) setUsefulness(r.ai_usefulness_score)
    if (r.ai_inaccuracy_detected !== null) setInaccurate(r.ai_inaccuracy_detected)
    setAiNote(r.ai_eval_note ?? '')
    if (r.manager_status) setManagerStatus(r.manager_status)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!report) {
    return (
      <div className="flex justify-center py-16">
        <SpinnerIcon className="w-6 h-6 text-teal-600" />
      </div>
    )
  }

  const stage1Done = Boolean(report.raw_evaluated_at)
  const stage2Done = Boolean(report.ai_evaluated_at)
  const rawInfo = computeRawInformativeness(report.raw_input)
  const afterInfo = computeInformativeness(report.caregiver_final_report ?? report.ai_generated_report)

  const saveStage1 = async () => {
    if (rawActionable === null || rawFollowup === null) {
      setError('원문 평가 항목을 모두 선택해 주세요.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await repo.evaluateRaw(id, {
        rawImmediatelyActionable: rawActionable, rawFollowupNeeded: rawFollowup, rawCompletenessScore: rawScore, rawEvalNote: rawNote,
      })
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const saveStage2 = async () => {
    if (aiActionable === null || aiFollowup === null || inaccurate === null) {
      setError('AI 보고 평가 항목을 모두 선택해 주세요.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await repo.evaluateAi(id, {
        aiImmediatelyActionable: aiActionable, aiFollowupNeeded: aiFollowup, aiCompletenessScore: aiScore,
        actualFollowupType: followupType, aiUsefulnessScore: usefulness, aiInaccuracyDetected: inaccurate, aiEvalNote: aiNote, managerStatus,
      })
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    const reason = window.prompt('삭제 사유를 입력해 주세요.')
    if (!reason || !reason.trim()) return
    if (!window.confirm('정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return
    try {
      await repo.deleteReport(id, reason)
      onChanged()
      onBack()
    } catch (e) {
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  const boolRadio = (value: boolean | null, set: (v: boolean) => void, yesLabel = '예', noLabel = '아니오') => (
    <div className="flex gap-2">
      <button onClick={() => set(true)} className={`flex-1 min-h-[44px] rounded-xl border-2 font-bold ${value === true ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-200 text-slate-700'}`}>
        {yesLabel}
      </button>
      <button onClick={() => set(false)} className={`flex-1 min-h-[44px] rounded-xl border-2 font-bold ${value === false ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}>
        {noLabel}
      </button>
    </div>
  )
  const scoreButtons = (value: number, set: (v: number) => void) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => set(n)} className={`flex-1 min-h-[40px] rounded-lg border font-bold ${value === n ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-200 text-slate-700'}`}>
          {n}
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      <button onClick={onBack} className="text-slate-400 text-sm self-start">
        ← 목록으로
      </button>
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-slate-900">
          {report.participant_code} · {report.recipient_code} · {report.report_type === 'daily' ? '기본' : '추가'}
          {report.report_source === 'scenario' && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">표준상황</span>}
        </h2>
        <button onClick={() => void handleDelete()} className="text-red-500 text-xs font-semibold">
          삭제
        </button>
      </div>
      <p className="text-slate-400 text-xs">
        제출: {report.submitted_at ?? '-'} · 소요 {report.completion_seconds ?? '-'}초 · 초기선택:{' '}
        {report.initial_status_choice === 'changed' ? '평소와 다름' : report.initial_status_choice === 'similar' ? '평소와 비슷' : report.initial_status_choice === 'uncertain' ? '확인 필요' : '-'}
        {report.no_information_report && ' · 무정보 보고'}
      </p>

      <section className="rounded-2xl bg-white border border-slate-100 p-4">
        <h3 className="font-bold text-slate-900 mb-2">1단계 · 최초 원문 평가 (AI 결과 비공개)</h3>
        <div className="bg-slate-50 rounded-xl p-3 mb-1 whitespace-pre-wrap text-slate-700">{report.raw_input}</div>
        <p className="text-slate-400 text-xs mb-3">자동 정보충실도(참고): {rawInfo} / 4</p>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-1">원문만으로 바로 판단 가능한가</p>
            {boolRadio(rawActionable, setRawActionable)}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-1">추가 질문이 필요한가</p>
            {boolRadio(rawFollowup, setRawFollowup)}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-1">필수정보 충실도 (1~5)</p>
            {scoreButtons(rawScore, setRawScore)}
          </div>
          <textarea value={rawNote} onChange={(e) => setRawNote(e.target.value)} placeholder="원문 평가 메모" rows={2} className="w-full border border-slate-200 rounded-xl p-2 text-sm" />
          <button onClick={() => void saveStage1()} disabled={saving} className="min-h-[44px] rounded-full bg-teal-600 text-white font-bold hover:bg-teal-700 disabled:bg-slate-300">
            {stage1Done ? '원문 평가 다시 저장' : '원문 평가 저장'}
          </button>
          {stage1Done && <p className="text-teal-600 text-xs text-center">저장됨 · {report.raw_evaluated_at}</p>}
        </div>
      </section>

      {stage1Done && (
        <section className="rounded-2xl bg-white border border-slate-100 p-4">
          <h3 className="font-bold text-slate-900 mb-2">2단계 · AI 적용 후 평가</h3>
          <div className="bg-slate-50 rounded-xl p-3 mb-3 text-sm">
            <p className="font-semibold text-slate-600 mb-1">AI 추가 질문 · 답변</p>
            {report.followup_answers.length === 0 ? (
              <p className="text-slate-400">추가 질문 없음</p>
            ) : (
              report.followup_answers.map((f: FollowupItem, i: number) => (
                <p key={i} className="text-slate-700">
                  Q. {f.question} → A. {f.answer}
                </p>
              ))
            )}
          </div>
          {FIELD_LABELS.map(({ key, label }) => (
            <div key={key} className="mb-3">
              <p className="text-sm font-semibold text-slate-600 mb-1">{label}</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-50 rounded-lg p-2">
                  <p className="text-slate-400 text-[10px] mb-0.5">AI 생성</p>
                  <p className="text-slate-700 whitespace-pre-wrap">{report.ai_generated_report?.[key]}</p>
                </div>
                <div className="bg-teal-50 rounded-lg p-2">
                  <p className="text-teal-500 text-[10px] mb-0.5">최종 제출</p>
                  <p className="text-slate-700 whitespace-pre-wrap">{report.caregiver_final_report?.[key]}</p>
                </div>
              </div>
            </div>
          ))}
          <p className="text-slate-400 text-xs mb-3">자동 정보충실도(참고): {afterInfo} / 4 (전 {rawInfo} → 후 {afterInfo})</p>

          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">최종보고만으로 바로 이해 가능한가</p>
              {boolRadio(aiActionable, setAiActionable)}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">추가 질문이 필요한가</p>
              {boolRadio(aiFollowup, setAiFollowup)}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">필수정보 충실도 (1~5)</p>
              {scoreButtons(aiScore, setAiScore)}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">실제 추가 전화·문자 확인 발생</p>
              <div className="flex gap-2">
                {(['none', 'sms', 'call'] as const).map((t) => (
                  <button key={t} onClick={() => setFollowupType(t)} className={`flex-1 min-h-[40px] rounded-lg border font-bold text-sm ${followupType === t ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-200 text-slate-700'}`}>
                    {t === 'none' ? '필요없음' : t === 'sms' ? '문자확인' : '전화확인'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">보고의 업무 유용성 (1~5)</p>
              {scoreButtons(usefulness, setUsefulness)}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">사실과 다른 내용이 포함됐는가</p>
              {boolRadio(inaccurate, setInaccurate)}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">처리 상태</p>
              <select value={managerStatus} onChange={(e) => setManagerStatus(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2">
                <option value="confirmed">확인 완료</option>
                <option value="needs_followup">추가 확인 필요</option>
                <option value="called">전화함</option>
                <option value="closed">종결</option>
              </select>
            </div>
            <textarea value={aiNote} onChange={(e) => setAiNote(e.target.value)} placeholder="관리자 메모" rows={2} className="w-full border border-slate-200 rounded-xl p-2 text-sm" />
            <button onClick={() => void saveStage2()} disabled={saving} className="min-h-[44px] rounded-full bg-slate-900 text-white font-bold hover:bg-slate-800 disabled:bg-slate-300">
              {stage2Done ? 'AI 평가 다시 저장' : 'AI 평가 저장'}
            </button>
            {stage2Done && <p className="text-teal-600 text-xs text-center">저장됨 · {report.ai_evaluated_at}</p>}
            {stage1Done && stage2Done && (
              <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 flex flex-col gap-1">
                <p className="font-bold text-slate-700">이 건의 변화</p>
                <p>정보충실도: {rawInfo}점 → {afterInfo}점</p>
                <p>추가 질문: {rawFollowup ? '필요' : '불필요'} → {aiFollowup ? '필요' : '불필요'}</p>
                <p>바로 판단 가능: {rawActionable ? '예' : '아니오'} → {aiActionable ? '예' : '아니오'}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {error && <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-3">{error}</p>}
    </div>
  )
}

function ReportsPanel({ repo, onOpen }: { repo: AdminRepo; onOpen: (id: string) => void }) {
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [source, setSource] = useState<'live' | 'scenario'>('live')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    void repo
      .listReports(source)
      .then(setReports)
      .finally(() => setLoading(false))
  }, [repo, source])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button onClick={() => setSource('live')} className={`px-3 py-1.5 rounded-full text-xs font-bold ${source === 'live' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
          실제 현장보고
        </button>
        <button onClick={() => setSource('scenario')} className={`px-3 py-1.5 rounded-full text-xs font-bold ${source === 'scenario' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
          표준상황 검증
        </button>
      </div>
      <div className="flex gap-2">
        <button onClick={() => void repo.exportCsv('summary')} className="flex-1 text-center min-h-[44px] flex items-center justify-center rounded-full border-2 border-slate-900 text-slate-900 font-bold text-sm hover:bg-slate-50">
          요약 CSV
        </button>
        <button onClick={() => void repo.exportCsv('full')} className="flex-1 text-center min-h-[44px] flex items-center justify-center rounded-full bg-slate-900 text-white font-bold text-sm hover:bg-slate-800">
          전체 CSV
        </button>
      </div>
      {loading && (
        <div className="flex justify-center py-10">
          <SpinnerIcon className="w-6 h-6 text-teal-600" />
        </div>
      )}
      {!loading && reports.length === 0 && <p className="text-slate-400 text-center py-10">아직 보고가 없습니다.</p>}
      {reports.map((r) => (
        <button key={r.id} onClick={() => onOpen(r.id)} className="text-left rounded-2xl bg-white border border-slate-100 shadow-sm p-4 hover:border-teal-300 transition">
          <div className="flex justify-between items-center text-sm">
            <span className="font-bold text-slate-900">
              {r.participant_code} → {r.recipient_code}
            </span>
            <span className="text-slate-400">{r.report_type === 'daily' ? '기본' : '추가'}</span>
          </div>
          <div className="flex justify-between items-center mt-1 text-xs text-slate-400">
            <span>{r.submitted_at ?? '미제출'}</span>
            <span>{r.completion_seconds ? `${r.completion_seconds}초` : ''}</span>
          </div>
          <div className="flex gap-1 mt-2 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.status === 'submitted' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
              {r.status === 'submitted' ? '제출완료' : '임시저장'}
            </span>
            {r.raw_evaluated_at && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">원문평가</span>}
            {r.ai_evaluated_at && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-white">AI평가완료</span>}
            {r.no_information_report && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">무정보</span>}
          </div>
        </button>
      ))}
    </div>
  )
}

function ParticipantsPanel({ repo }: { repo: AdminRepo }) {
  const [participants, setParticipants] = useState<Array<{ code: string; active: boolean; pinSet: boolean; updatedAt: string }>>([])
  const [issuedPin, setIssuedPin] = useState<{ code: string; pin: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setParticipants(await repo.listParticipants())
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetPin = async (code: string) => {
    if (!window.confirm(`${code}의 PIN을 초기화할까요? 기존 PIN은 즉시 무효화됩니다.`)) return
    const res = await repo.resetPin(code)
    setIssuedPin(res)
    await load()
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <SpinnerIcon className="w-6 h-6 text-teal-600" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {issuedPin && (
        <div className="rounded-2xl bg-teal-50 border border-teal-200 p-4 text-center">
          <p className="text-teal-700 font-bold">
            {issuedPin.code} 새 PIN: {issuedPin.pin}
          </p>
          <p className="text-teal-600 text-xs mt-1">이 PIN은 다시 표시되지 않습니다. 지금 오프라인으로 전달하세요.</p>
        </div>
      )}
      {participants.map((p) => (
        <div key={p.code} className="flex items-center justify-between rounded-2xl bg-white border border-slate-100 shadow-sm p-4">
          <div>
            <p className="font-bold text-slate-900">{p.code}</p>
            <p className="text-xs text-slate-400">{p.pinSet ? 'PIN 설정됨' : 'PIN 미설정'}</p>
          </div>
          <button onClick={() => void resetPin(p.code)} className="min-h-[40px] px-4 rounded-full border-2 border-slate-900 text-slate-900 font-bold text-sm hover:bg-slate-50">
            PIN 초기화
          </button>
        </div>
      ))}
    </div>
  )
}

function PresentationView({ data, demo, status }: { data: StatsResponse; demo: boolean; status: 'in_progress' | 'final' }) {
  const { stats, scenarioStats } = data
  const recent = [] as string[]
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center px-6 py-10">
      {demo && <div className="mb-4 px-4 py-1.5 rounded-full bg-amber-500 text-slate-900 text-sm font-bold">DEMO DATA · 실제 실증 결과가 아닙니다</div>}
      <p className="text-teal-300 font-semibold">{INSTITUTION_NAME} · 2주 현장 실증</p>
      <p className="text-slate-400 text-sm mt-1">{status === 'final' ? '최종 실증 결과' : '중간집계 · 데이터 수집 진행 중'}</p>
      <h1 className="text-3xl sm:text-5xl font-bold mt-6 text-center">AI365 CARE DREAM 초기 실증 성과</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-10 w-full max-w-4xl text-center">
        <div>
          <p className="text-4xl font-bold">{stats.participation.participantsWithAtLeastOne}</p>
          <p className="text-slate-400 text-sm mt-1">실제 참여자</p>
        </div>
        <div>
          <p className="text-4xl font-bold">{stats.volume.totalCount}</p>
          <p className="text-slate-400 text-sm mt-1">누적 보고 건수</p>
        </div>
        <div>
          <p className="text-4xl font-bold">{stats.participation.repeatUserRate.denominator === 0 ? '—' : `${stats.participation.repeatUserRate.percent}%`}</p>
          <p className="text-slate-400 text-sm mt-1">재사용률</p>
        </div>
        <div>
          <p className="text-4xl font-bold">{stats.quality.completionSecondsMedian === null ? '—' : `${Math.round(stats.quality.completionSecondsMedian)}초`}</p>
          <p className="text-slate-400 text-sm mt-1">보고 완료시간</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6 mt-10 w-full max-w-4xl">
        <div className="bg-slate-800 rounded-2xl p-6 text-center">
          <p className="text-slate-400 text-sm">AI 적용 전후 바로 판단 가능률</p>
          <p className="text-3xl font-bold mt-2 text-teal-300">
            {stats.beforeAfter.rawActionable.percent ?? '—'}% → {stats.beforeAfter.aiActionable.percent ?? '—'}%
          </p>
        </div>
        <div className="bg-slate-800 rounded-2xl p-6 text-center">
          <p className="text-slate-400 text-sm">정보충실도 전후 차이 (0~4)</p>
          <p className="text-3xl font-bold mt-2 text-teal-300">
            {stats.beforeAfter.informativenessBefore ?? '—'} → {stats.beforeAfter.informativenessAfter ?? '—'}
          </p>
        </div>
      </div>

      <div className="mt-8 w-full max-w-4xl text-center text-slate-300 text-sm">
        AI 사실오류 {stats.quality.inaccuracyCount}건 (평가 {stats.quality.inaccuracyEvaluatedCount}건 중) · 표준상황 검증{' '}
        {scenarioStats.totalCount}/{scenarioStats.targetCount}건
      </div>

      {recent.length === 0 && <p className="text-slate-500 text-xs mt-10">익명화된 최근 사례는 준비 중입니다.</p>}
    </div>
  )
}

function AdminApp() {
  const demo = isDemoMode()
  const repo: AdminRepo = demo ? demoAdminRepo : realAdminRepo
  const presentationRoute = window.location.pathname.startsWith('/admin/presentation')

  const [phase, setPhase] = useState<'loading' | 'login' | 'app'>('loading')
  const [tab, setTab] = useState<Tab>('dashboard')
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [liveReports, setLiveReports] = useState<ReportListItem[]>([])
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [presentationStatus, setPresentationStatus] = useState<'in_progress' | 'final'>('in_progress')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadStats = () => {
    void Promise.all([repo.getStats(), repo.listReports('live')])
      .then(([s, r]) => {
        setStats(s)
        setLiveReports(r.filter((x) => x.status === 'submitted'))
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    void (async () => {
      try {
        const session = await repo.getSession()
        setPhase(session.authenticated ? 'app' : 'login')
      } catch {
        setPhase('login')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'app') return
    loadStats()
    pollRef.current = setInterval(loadStats, 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const handleLogin = async (password: string) => {
    await repo.login(password)
    setPhase('app')
  }
  const handleLogout = async () => {
    await repo.logout().catch(() => undefined)
    setPhase('login')
  }
  const handleResetDemo = () => {
    resetDemoData()
    window.location.reload()
  }

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <SpinnerIcon className="w-8 h-8 text-teal-600" />
      </div>
    )
  }
  if (phase === 'login') return <LoginScreen demo={demo} onLogin={handleLogin} />

  if (presentationRoute) {
    if (!stats) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <SpinnerIcon className="w-8 h-8 text-teal-300" />
        </div>
      )
    }
    return (
      <div>
        <div className="fixed top-4 right-4 z-10 flex gap-2">
          <select
            value={presentationStatus}
            onChange={(e) => setPresentationStatus(e.target.value as 'in_progress' | 'final')}
            className="text-xs bg-slate-800 text-white rounded-full px-3 py-1 border border-slate-600"
          >
            <option value="in_progress">중간집계</option>
            <option value="final">최종 실증 결과</option>
          </select>
          <a href="/admin" className="text-xs bg-slate-800 text-white rounded-full px-3 py-1 border border-slate-600">
            관리자 화면으로
          </a>
        </div>
        <PresentationView data={stats} demo={demo} status={presentationStatus} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-5xl flex-1 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-teal-600 font-semibold text-sm">AI365 CARE DREAM</p>
            <h1 className="text-xl font-bold text-slate-900">관리자 검증 화면</h1>
          </div>
          <div className="flex items-center gap-3">
            {demo && (
              <button onClick={handleResetDemo} className="text-amber-600 text-xs font-bold underline">
                데모 초기화
              </button>
            )}
            <a href="/admin/presentation" className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-bold">
              피칭 화면
            </a>
            <button onClick={() => void handleLogout()} className="text-slate-400 text-sm">
              로그아웃
            </button>
          </div>
        </div>

        <div className="flex gap-2 border-b border-slate-200">
          {(
            [
              ['dashboard', '대시보드'],
              ['reports', '보고 목록'],
              ['participants', '참여자 관리'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setTab(id)
                setSelectedReportId(null)
              }}
              className={`px-3 py-2 text-sm font-bold border-b-2 -mb-px ${tab === id ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-400'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && <Dashboard demo={demo} data={stats} reports={liveReports} onOpen={(id) => { setTab('reports'); setSelectedReportId(id) }} />}
        {tab === 'reports' &&
          (selectedReportId ? (
            <ReportDetailPanel repo={repo} id={selectedReportId} onBack={() => setSelectedReportId(null)} onChanged={loadStats} />
          ) : (
            <ReportsPanel repo={repo} onOpen={setSelectedReportId} />
          ))}
        {tab === 'participants' && <ParticipantsPanel repo={repo} />}
      </div>
      <div className="w-full max-w-5xl">
        <SafetyFooter />
      </div>
    </div>
  )
}

export default AdminApp
