import { useEffect, useRef, useState } from 'react'
import { ApiClientError } from '../shared/api'
import { SafetyFooter } from '../shared/SafetyNotice'
import type { FollowupItem, StructuredReport } from '../shared/types'
import { computeInformativeness } from '../shared/types'
import type { AdminRepo, ReportDetail, ReportListItem, StatsResponse } from '../shared/adminRepo'
import { realAdminRepo, ReviewConflictError } from '../shared/adminRepo'
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

/** 빈 값을 "문제없음"으로 바꾸지 않고 그대로 "미기록"류로 보여주기 위해, 값이
 * 있을 때만 잘라서 반환한다(없으면 null — 호출부가 자기 문구를 붙인다). */
function truncateText(v: string | undefined, max = 40): string | null {
  if (!v || !v.trim()) return null
  const t = v.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** AI가 어르신 위험도를 판단하는 게 아니라, "Gemini 응답을 실제로 썼는지"만 보여주는
 * 기술 상태 배지. 응급신호(위험도) 배지와 절대 섞지 않는다.
 *
 * 추적 범위(중요): ai_fallback_used는 "최종 기록(구조화 보고문) 생성" 단계 하나만
 * 본다 — 추가질문 생성도 같은 Gemini 호출(runCareReportTurn)을 거치지만, 그
 * 단계는 실패해도 대체(fallback)로 조용히 넘어가는 경로 자체가 코드에 없다(성공
 * 아니면 오류를 던져 재시도 화면으로 감 — 실패한 시도는 저장되지 않는다). 그래서
 * "제출된 보고"라면 추가질문 단계들은 (재시도를 거쳤더라도) 전부 성공한 뒤에야
 * 여기 온 것이지만, 이 배지 자체는 그 사실까지 보증하지 않고 "최종 기록" 단계만
 * 말한다는 걸 라벨에 명시한다.
 * ruleBasedByDesign=true("평소와 비슷했어요" 흐름)면 애초에 Gemini를 부르지 않는
 * 설계이므로, "추적 안 됨(확인 불가)"과 구분해 "AI 미호출(규칙 기반)"로 보여준다. */
function FallbackBadge({ used, ruleBasedByDesign }: { used: boolean | null | undefined; ruleBasedByDesign?: boolean }) {
  if (ruleBasedByDesign) {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">전체: AI 미호출(규칙 기반)</span>
  }
  if (used === null || used === undefined) {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">최종 기록: AI 처리상태 확인 불가</span>
  }
  if (used) {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">최종 기록: AI 대체 처리됨</span>
  }
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-50 text-slate-400">최종 기록: AI 처리 성공</span>
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

/** "센터가 확인할 돌봄" 우선순위 요약 — 연구용 KPI보다 먼저, 화면 맨 위에 둔다.
 * AI 오류(폴백/처리실패)와 어르신 위험도(응급신호)는 서로 다른 축이라 절대 같은
 * 배지로 섞지 않는다: 응급신호는 "우선 확인이 필요한 보고"에, AI 처리 이상은
 * 각 카드 안의 별도 문구로만 보여준다. */
function PriorityCareStrip({ reports, today, onOpen }: { reports: ReportListItem[]; today: string; onOpen: (id: string) => void }) {
  const submitted = reports.filter((r) => r.status === 'submitted' && r.report_source !== 'scenario')
  const urgent = submitted.filter((r) => r.emergency_flagged && (r.review_status ?? 'pending') === 'pending')
  const unreviewed = submitted.filter((r) => (r.review_status ?? 'pending') === 'pending')
  const todayReports = submitted.filter((r) => r.report_date === today)
  const todayParticipants = new Set(todayReports.map((r) => r.participant_code).filter((c): c is string => Boolean(c)))

  return (
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
      <h2 className="font-bold text-slate-900 mb-3">센터가 확인할 돌봄</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`rounded-2xl p-3 ${urgent.length > 0 ? 'bg-red-50 border border-red-200' : 'bg-slate-50'}`}>
          <p className={`text-2xl font-bold ${urgent.length > 0 ? 'text-red-700' : 'text-slate-900'}`}>{urgent.length}건</p>
          <p className={`text-xs mt-0.5 ${urgent.length > 0 ? 'text-red-600' : 'text-slate-400'}`}>우선 확인 필요(응급신호·미확인)</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-2xl font-bold text-slate-900">{unreviewed.length}건</p>
          <p className="text-slate-400 text-xs mt-0.5">아직 확인하지 않은 보고</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-2xl font-bold text-slate-900">{todayReports.length}건</p>
          <p className="text-slate-400 text-xs mt-0.5">오늘 완료된 보고</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-2xl font-bold text-slate-900">{todayParticipants.size}명</p>
          <p className="text-slate-400 text-xs mt-0.5">오늘 참여한 요양보호사</p>
        </div>
      </div>
      {urgent.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {urgent.slice(0, 3).map((r) => (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="text-left rounded-xl border border-red-200 bg-red-50 p-3 hover:border-red-400 transition"
            >
              <span className="font-bold text-red-700 text-sm">
                🔴 {r.participant_code} → {r.recipient_code}
              </span>
              <span className="text-red-500 text-xs ml-2">{r.submitted_at?.slice(0, 16).replace('T', ' ')}</span>
            </button>
          ))}
        </div>
      )}
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

      <PriorityCareStrip reports={reports} today={data.today} onOpen={onOpen} />

      <details className="rounded-3xl bg-white border border-slate-100 shadow-sm">
        <summary className="cursor-pointer select-none p-5 font-bold text-slate-900">실증 지표 자세히 보기 (연구용)</summary>
        <div className="px-5 pb-5 flex flex-col gap-6">
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
              value={stats.participation.repeatUserRate.denominator === 0 ? '관찰 중' : `${stats.participation.repeatUserRate.percent}%`}
              sub={
                stats.participation.repeatUserRate.denominator === 0
                  ? `아직 재사용 여부를 판단할 만큼 관찰 기간이 지난 참여자가 없음 (첫 제출이 오늘인 ${stats.participation.stillObservingParticipants}명은 관찰 중)`
                  : `관찰 기간을 확보한 ${stats.participation.repeatUserRate.denominator}명 중 ${stats.participation.repeatUserRate.numerator}명이 2회 이상 사용 (관찰 중 ${stats.participation.stillObservingParticipants}명 별도)`
              }
              tip={
                <InfoTip
                  title="재사용률"
                  formula="2회 이상 제출한 참여자 수 ÷ 첫 제출일이 오늘 이전인(=최소 하루 관찰 기간이 지난) 참여자 수 × 100. 첫 제출이 오늘인 참여자는 아직 다시 쓸 기회가 없었을 수 있어 분모에서 뺀다."
                  den={stats.participation.repeatUserRate.denominator}
                  num={stats.participation.repeatUserRate.numerator}
                  note={`참여 예정자 9명 기준 보조값: ${stats.participation.repeatUserRateOfPlanned.numerator}/9`}
                />
              }
            />
            <StatCard
              label="시작~제출 경과시간"
              value={stats.quality.completionTime.medianAllSeconds === null ? '측정 전' : `중앙값 ${Math.round(stats.quality.completionTime.medianAllSeconds)}초`}
              sub={
                stats.quality.completionTime.medianWithinThresholdSeconds === null
                  ? '돌봄보고 시작부터 최종 제출까지(대기시간 포함 가능)'
                  : `${stats.quality.completionTime.thresholdSeconds / 60}분 이내 완료 ${
                      stats.quality.completionTime.sampleCount - stats.quality.completionTime.excludedFromThresholdCount
                    }건 중앙값 ${Math.round(stats.quality.completionTime.medianWithinThresholdSeconds)}초 (${
                      stats.quality.completionTime.excludedFromThresholdCount
                    }건은 화면을 열어둔 채 대기했을 가능성이 있어 제외)`
              }
              tip={
                <InfoTip
                  title="시작~제출 경과시간"
                  formula="이 값은 '시작부터 제출까지 흐른 전체 시간'이며, 실제로 화면을 붙잡고 응답한 시간과는 다를 수 있다(턴별 상호작용 시간은 별도로 기록하지 않아 계산할 수 없음)."
                />
              }
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
              label="제출 완료율"
              value={fmtPct(stats.quality.completionRate)}
              sub={`제출 완료 ${stats.quality.completionBreakdown.completed} · 장기 미완료 ${stats.quality.completionBreakdown.longPending} · 진행 중 ${stats.quality.completionBreakdown.inProgress}(분모 제외)`}
              tip={
                <InfoTip
                  title="제출 완료율"
                  formula={`시작한 돌봄보고가 실제로 제출까지 이어졌는지만 보는 지표(AI가 잘 작동했는지는 이 값이 아니라 "AI 폴백 발생률"을 봐야 한다). 제출 완료 건수 ÷ (제출 완료 + 장기 미완료) × 100. "장기 미완료"는 시작 후 ${stats.quality.completionBreakdown.longPendingThresholdHours}시간이 지나도 제출되지 않은 draft를 가리키는 관찰값일 뿐, 실패·중단으로 확정한 것이 아니다(이 시간 기준도 편의상 정한 값). 방금 시작해 아직 작성 중인 draft는 분모에서 뺀다.`}
                  den={stats.quality.completionRate.denominator}
                  num={stats.quality.completionRate.numerator}
                />
              }
            />
            <StatCard
              label="AI 폴백(대체) 발생률 · 최종 기록 생성 단계"
              value={stats.quality.fallbackRate.denominator === 0 ? '확인 불가' : fmtPct(stats.quality.fallbackRate)}
              sub={
                stats.quality.fallbackUnknownCount > 0
                  ? `최종 보고문 생성 단계에서 규칙 기반 대체가 쓰인 비율 (추적 이전 기록 ${stats.quality.fallbackUnknownCount}건은 확인 불가)`
                  : '최종 보고문 생성 단계에서 규칙 기반 대체가 쓰인 비율'
              }
              tip={
                <InfoTip
                  title="AI 폴백(대체) 발생률 · 최종 기록 생성 단계"
                  formula="최종 보고문이 Gemini 실패/무효 응답으로 규칙 기반 대체(fallbackReport)를 썼던 건수 ÷ 이 값이 기록된(ai_fallback_used가 null이 아닌) 제출 건수 × 100. 추가질문 생성 단계도 같은 Gemini 호출을 거치지만 그 단계는 실패 시 대체 없이 오류로 재시도되므로(저장되지 않음) 이 지표에 안 잡힌다 — '최종 기록 생성'이라는 이 지표의 범위를 벗어난 단계는 별도로 추적하지 않는다. 보고가 저장됐다는 것과 AI가 정상 작동했다는 것은 다른 사실이다."
                  den={stats.quality.fallbackRate.denominator}
                  num={stats.quality.fallbackRate.numerator}
                />
              }
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
              tip={
                <InfoTip
                  title="AI 초안 수정률"
                  formula="ai_generated_report ≠ caregiver_final_report(정규화 텍스트 비교) 건수 ÷ 제출 건수 × 100"
                  den={stats.quality.aiDraftEditRate.denominator}
                  num={stats.quality.aiDraftEditRate.numerator}
                  note="주의: 수정하지 않았다는 것이 곧 초안이 적절했다는 뜻은 아니다(그냥 넘어갔을 수도 있음) — 품질 판단은 관리자 평가(2단계) 점수를 함께 봐야 한다."
                />
              }
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
            <h3 className="font-bold text-slate-900 mb-2">
              현장보고 유형
              <InfoTip
                title="현장보고 유형"
                formula="요양보호사가 실제로 선택하거나 확인된 상태별 비율. '미분류'는 '이야기 시작'/'글로 입력하기'로 곧바로 말해 평소와 다름·비슷함·확인필요 중 아무것도 고르지 않은 보고 — 아직 어떤 상태인지 확인되지 않았다는 뜻이며 '평소와 비슷함(정상 확인됨)'과 다르다."
              />
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard label="평소와 다른 점 있음" value={fmtPct(stats.reportTypeBreakdown.changed)} />
              <StatCard label="평소와 비슷함" value={fmtPct(stats.reportTypeBreakdown.similar)} />
              <StatCard label="확인 필요" value={fmtPct(stats.reportTypeBreakdown.uncertain)} />
              <StatCard label="무정보 보고" value={fmtPct(stats.reportTypeBreakdown.noInfo)} />
              <StatCard label="미분류" value={fmtPct(stats.reportTypeBreakdown.unclassified)} sub="평소와 다름/비슷함/확인필요를 선택하지 않은 보고" />
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
        </div>
      </details>
    </div>
  )
}

const FIELD_LABELS: Array<{ key: keyof StructuredReport; label: string }> = [
  { key: 'change', label: '관찰한 돌봄 상황' },
  { key: 'action', label: '현장에서 한 조치' },
  { key: 'result', label: '현재 상태' },
  { key: 'escalation', label: '센터 확인사항' },
  { key: 'caregiverNote', label: '요양보호사 상황·지원 요청 (발화 원문 발췌)' },
]

function emptyStructuredReport(): StructuredReport {
  return { change: '', action: '', result: '', escalation: '', caregiverNote: '' }
}

/** 관리자 화면 전반에서 시각을 사람이 바로 읽을 수 있는 형태로 보여준다("2026-09-
 * 12T02:14:22.716+00:00" 같은 원본 문자열을 그대로 노출하지 않는다) — 올해면 연도를
 * 생략해 더 짧게 보여준다. */
function formatKoreanDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const datePart = d.toLocaleDateString('ko-KR', { year: sameYear ? undefined : 'numeric', month: 'long', day: 'numeric' })
  const timePart = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
  return `${datePart} ${timePart}`
}

/** "관리자 재확인·수정 시간"(사업계획서 핵심 실증 지표)의 원재료 — 열람 시각과
 * 처리(승인/반려) 시각의 차이를 분 단위로 보여준다. 둘 중 하나라도 없으면 계산하지
 * 않는다(추정해서 채우지 않음). 음수(예: 데이터 이상)는 표시하지 않는다. */
function formatElapsedMinutes(fromIso: string | null, toIso: string | null): string | null {
  if (!fromIso || !toIso) return null
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  const minutes = Math.round((to - from) / 60000)
  if (minutes < 1) return '1분 미만'
  if (minutes < 60) return `${minutes}분`
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`
}

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

  // 관리자 검토(승인/반려) — 위 1/2단계 연구용 평가와 별개의 운영 워크플로우.
  const [reviewDraft, setReviewDraft] = useState<StructuredReport>(emptyStructuredReport())
  // 기본은 "빠른 판단" 모드 — 정리문을 읽기 전용 요약으로 보여주고 승인/반려 버튼을
  // 바로 아래에 둔다. 실제로 고칠 내용이 있을 때만 펼쳐서 입력칸으로 바꾼다(재확인·
  // 수정 시간을 줄이는 것이 목표이므로 기본값이 "다 펼쳐진 긴 폼"이면 안 된다).
  const [editingReview, setEditingReview] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  // 기본값 false — 요양보호사에게 보이려면 관리자가 매번 명시적으로 체크해야 한다.
  const [reviewNoteVisible, setReviewNoteVisible] = useState(false)
  const [showRejectNote, setShowRejectNote] = useState(false)
  const [reviewSaving, setReviewSaving] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

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
    // 검토 폼은 관리자 확정본이 있으면 그걸, 없으면 요양보호사 확인본/AI 초안 순으로 채운다.
    setReviewDraft(r.admin_final_report ?? r.caregiver_final_report ?? r.ai_generated_report ?? emptyStructuredReport())
    setReviewNote(r.review_status === 'rejected' ? (r.review_note ?? '') : '')
    // 이미 저장된 공개 여부를 그대로 이어서 보여준다(다시 검토할 때 실수로 되돌리지
    // 않도록) — 새 보고를 열 때는 항상 false로 시작한다.
    setReviewNoteVisible(r.review_status !== 'pending' ? r.review_note_visible_to_caregiver === true : false)
    setShowRejectNote(false)
    setEditingReview(false)
    setReviewError(null)
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

  const submitReview = async (reviewStatus: 'approved' | 'rejected') => {
    if (reviewStatus === 'rejected' && !reviewNote.trim()) {
      setReviewError('반려 사유를 입력해 주세요.')
      return
    }
    setReviewSaving(true)
    setReviewError(null)
    try {
      const updated = await repo.reviewReport({
        id,
        reviewStatus,
        reviewNote: reviewNote.trim() || undefined,
        reviewNoteVisibleToCaregiver: reviewNoteVisible && Boolean(reviewNote.trim()),
        adminFinalReport: reviewDraft,
        expectedUpdatedAt: report.updated_at,
        requestId: `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      setReport(updated)
      setReviewDraft(updated.admin_final_report ?? reviewDraft)
      setShowRejectNote(false)
      setEditingReview(false)
      onChanged()
    } catch (e) {
      if (e instanceof ReviewConflictError) {
        // 저장 실패/충돌 시 관리자가 작성 중이던 내용(reviewDraft)은 그대로 둔다 —
        // 서버 최신값으로 자동 덮어쓰지 않는다. 필요하면 사람이 직접 새로고침한다.
        setReviewError('다른 곳에서 먼저 저장된 내용이 있습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.')
      } else {
        setReviewError(e instanceof ApiClientError || e instanceof Error ? e.message : '검토 결과를 저장하지 못했습니다.')
      }
    } finally {
      setReviewSaving(false)
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
          {report.emergency_flagged && (
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
              🔴 {report.status === 'submitted' ? '응급신호 감지' : '미제출·확인 전 주의 신호'}
            </span>
          )}
          {report.status === 'submitted' && (
            <span className="ml-2 inline-block align-middle">
              <FallbackBadge used={report.ai_fallback_used} ruleBasedByDesign={report.initial_status_choice === 'similar'} />
            </span>
          )}
        </h2>
        <button onClick={() => void handleDelete()} className="text-red-500 text-xs font-semibold">
          삭제
        </button>
      </div>
      <p className="text-slate-400 text-xs">
        제출 {formatKoreanDateTime(report.submitted_at)} · 작성 {report.completion_seconds ?? '-'}초 ·{' '}
        {report.initial_status_choice === 'changed' ? '평소와 다름' : report.initial_status_choice === 'similar' ? '평소와 비슷' : report.initial_status_choice === 'uncertain' ? '확인 필요' : '초기선택 없음'}
        {report.no_information_report && ' · 무정보 보고'}
      </p>
      <p className="text-slate-400 text-xs">
        {report.admin_first_viewed_at ? `열람 ${formatKoreanDateTime(report.admin_first_viewed_at)}` : '아직 열람 전'}
        {report.admin_first_viewed_at && report.reviewed_at && (
          <> · 처리까지 {formatElapsedMinutes(report.admin_first_viewed_at, report.reviewed_at) ?? '-'}</>
        )}
      </p>

      {report.status !== 'submitted' ? (
        <section className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
          <p className="text-amber-700 font-bold text-sm">아직 제출 전(임시저장)입니다 — 검토할 수 없습니다.</p>
          <p className="text-amber-600 text-xs mt-1">
            {report.emergency_flagged
              ? '응급 신호가 감지된 채로 저장만 된 상태입니다. 이 자체는 관리자 알림이 아니며, 이 화면을 직접 열어야 보입니다.'
              : '요양보호사가 아직 확인·제출하지 않았습니다.'}
          </p>
        </section>
      ) : (
        <section className="rounded-2xl bg-white border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-slate-900">관리자 검토</h3>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                report.review_status === 'approved'
                  ? 'bg-teal-100 text-teal-700'
                  : report.review_status === 'rejected'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {report.review_status === 'approved' ? '승인됨' : report.review_status === 'rejected' ? '반려됨' : '검토 대기'}
            </span>
          </div>

          {report.review_status !== 'pending' && report.admin_final_report && (
            <div className={`rounded-xl p-3 mb-3 text-sm ${report.review_status === 'approved' ? 'bg-teal-50' : 'bg-red-50 border border-red-100'}`}>
              <p className={`text-xs font-bold mb-1 ${report.review_status === 'approved' ? 'text-teal-600' : 'text-red-600'}`}>
                {report.review_status === 'approved' ? '승인본 (활용 가능 기록)' : '반려 시 검토본 (재작업 필요 — 활용 가능 기록 아님)'}
              </p>
              {FIELD_LABELS.map(({ key, label }) => (
                <p key={key} className="text-slate-700">
                  <span className="text-slate-400">{label}: </span>
                  {report.admin_final_report?.[key] || '-'}
                </p>
              ))}
              {report.review_status === 'rejected' && report.review_note && (
                <p className="text-red-700 mt-1">
                  반려 사유: {report.review_note}{' '}
                  <span className={`text-[10px] font-bold ${report.review_note_visible_to_caregiver ? 'text-teal-600' : 'text-slate-400'}`}>
                    ({report.review_note_visible_to_caregiver ? '요양보호사에게 공개됨' : '관리자 전용(비공개)'})
                  </span>
                </p>
              )}
              <p className="text-slate-400 text-[11px] mt-1">{formatKoreanDateTime(report.reviewed_at)}</p>
            </div>
          )}

          {/* 원문 대조 — 지금까지는 이 화면 아래(1단계 연구용 평가 섹션)까지 스크롤해야
              원문을 볼 수 있었다. 실제 승인/반려 판단에 쓰는 원문은 바로 여기, 수정 폼
              바로 위에서 대조할 수 있어야 재확인·수정 시간이 줄어든다. */}
          {report.raw_input && (
            <details className="mb-3 rounded-xl border border-slate-200 bg-slate-50" open>
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-600">
                원문 대조 보기 (요양보호사가 실제로 말/입력한 내용)
              </summary>
              <div className="px-3 pb-3 whitespace-pre-wrap text-sm text-slate-700">{report.raw_input}</div>
            </details>
          )}

          {/* 기본은 요약(읽기 전용) — 대부분의 경우 원문과 대조해서 "이상 없음"만
              확인하고 바로 승인하면 된다. 실제로 고칠 내용이 있을 때만 펼쳐서 입력칸을
              보여준다(항상 4칸 다 펼쳐두면 승인/반려 버튼까지 스크롤이 길어져 오히려
              재확인·수정 시간을 늘린다). */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-500 text-xs">정리문 · 이상 없으면 바로 승인하세요</p>
            <button onClick={() => setEditingReview((v) => !v)} className="text-teal-600 text-xs font-bold underline shrink-0">
              {editingReview ? '요약으로 보기' : '내용 수정'}
            </button>
          </div>
          {editingReview
            ? FIELD_LABELS.map(({ key, label }) => (
                <div key={key} className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 mb-1">{label}</p>
                  <textarea
                    value={reviewDraft[key]}
                    onChange={(e) => setReviewDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                    rows={2}
                    className="w-full border border-slate-200 rounded-lg p-2 text-sm"
                  />
                </div>
              ))
            : FIELD_LABELS.map(({ key, label }) => (
                <p key={key} className="text-sm text-slate-700 mb-1.5">
                  <span className="text-slate-400">{label}: </span>
                  {reviewDraft[key] || '-'}
                </p>
              ))}

          {showRejectNote && (
            <>
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="반려 사유를 입력해 주세요 (필수)"
                rows={2}
                className="w-full border border-red-200 rounded-lg p-2 text-sm mt-1"
              />
              <label className="flex items-start gap-2 mt-1.5 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={reviewNoteVisible}
                  onChange={(e) => setReviewNoteVisible(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  이 사유를 요양보호사의 "내가 남긴 돌봄기록"에 보이기 — 체크하지 않으면 관리자만 볼 수
                  있는 내부 메모로 남는다(기본값). 실명·개인정보를 적지 않는다.
                </span>
              </label>
            </>
          )}
          {reviewError && <p className="text-red-700 text-xs mt-2">{reviewError}</p>}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => void submitReview('approved')}
              disabled={reviewSaving}
              className="flex-1 min-h-[44px] rounded-full bg-teal-600 text-white font-bold hover:bg-teal-700 disabled:bg-slate-300"
            >
              {reviewSaving ? '저장 중...' : '승인'}
            </button>
            <button
              onClick={() => (showRejectNote ? void submitReview('rejected') : setShowRejectNote(true))}
              disabled={reviewSaving}
              className="flex-1 min-h-[44px] rounded-full border-2 border-red-500 text-red-600 font-bold hover:bg-red-50 disabled:opacity-50"
            >
              {showRejectNote ? '반려 확정' : '반려'}
            </button>
          </div>

          {report.review_history.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 flex flex-col gap-1">
              <p className="font-bold text-slate-600">검토 이력 (공유 관리자 접근 — 개인 식별 불가)</p>
              {report.review_history.map((h, i) => (
                <p key={i}>
                  {formatKoreanDateTime(h.at)} · {h.review_status === 'approved' ? '승인' : h.review_status === 'rejected' ? '반려' : '대기'}
                  {h.review_note ? ` · ${h.review_note}` : ''}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

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
          {stage1Done && <p className="text-teal-600 text-xs text-center">저장됨 · {formatKoreanDateTime(report.raw_evaluated_at)}</p>}
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
            {stage2Done && <p className="text-teal-600 text-xs text-center">저장됨 · {formatKoreanDateTime(report.ai_evaluated_at)}</p>}
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

function todayKstDateStringClient(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function ReportsPanel({ repo, onOpen }: { repo: AdminRepo; onOpen: (id: string) => void }) {
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [source, setSource] = useState<'live' | 'scenario'>('live')
  const [loading, setLoading] = useState(true)
  const today = todayKstDateStringClient()
  const [rangeStart, setRangeStart] = useState(today)
  const [rangeEnd, setRangeEnd] = useState(today)
  const [computedAt, setComputedAt] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    void repo
      .listReports(source)
      .then((rows) => {
        setReports(rows)
        setComputedAt(new Date().toLocaleString('ko-KR'))
      })
      .finally(() => setLoading(false))
  }, [repo, source])

  // 관리자 기본 3지표(조회기간 기준, 기본값 오늘/KST). statsCalc.ts의 연구용 KPI와는
  // 별개로 계산한다 — 데모/기술테스트/삭제 기록은 listReports('live')가 애초에
  // 포함하지 않는다(실제 DB에는 데모 데이터 자체가 없고, deleted=false만 조회).
  const inRange = reports.filter((r) => (r.report_date ?? '') >= rangeStart && (r.report_date ?? '') <= rangeEnd)
  const delivered = inRange.filter((r) => r.status === 'submitted')
  const participantCount = new Set(delivered.map((r) => r.participant_code).filter((c): c is string => Boolean(c))).size
  const reviewed = delivered.filter((r) => r.review_status === 'approved' || r.review_status === 'rejected')
  const approvedCount = reviewed.filter((r) => r.review_status === 'approved').length
  const rejectedCount = reviewed.filter((r) => r.review_status === 'rejected').length
  const pendingCount = delivered.length - reviewed.length
  const reviewRate = delivered.length > 0 ? Math.round((reviewed.length / delivered.length) * 1000) / 10 : null

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

      {source === 'live' && (
        <div className="rounded-2xl bg-white border border-slate-100 p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-bold text-slate-500">조회기간</label>
            <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-xs" />
            <span className="text-slate-400 text-xs">~</span>
            <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-xs" />
            <button onClick={() => { setRangeStart(today); setRangeEnd(today) }} className="text-teal-600 text-xs font-bold underline ml-auto">
              오늘로 초기화
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xl font-bold text-slate-900">{participantCount}</p>
              <p className="text-slate-400 text-[11px] mt-0.5">참여 요양보호사 수</p>
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{delivered.length}</p>
              <p className="text-slate-400 text-[11px] mt-0.5">전달 완료 기록 수</p>
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{delivered.length === 0 ? '아직 기록 없음' : `${reviewRate}%`}</p>
              <p className="text-slate-400 text-[11px] mt-0.5">
                검토율 {delivered.length > 0 && `(${reviewed.length}/${delivered.length})`}
              </p>
            </div>
          </div>
          {delivered.length > 0 && (
            <p className="text-slate-400 text-[11px] text-center">
              승인 {approvedCount} · 반려 {rejectedCount} · 미검토 {pendingCount}
            </p>
          )}
          {computedAt && <p className="text-slate-300 text-[10px] text-center">집계 시각 {computedAt}</p>}
        </div>
      )}
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
      {reports.map((r) => {
        const finalReport = r.caregiver_final_report ?? r.ai_generated_report
        return (
          <button key={r.id} onClick={() => onOpen(r.id)} className="text-left rounded-2xl bg-white border border-slate-100 shadow-sm p-4 hover:border-teal-300 transition">
            <div className="flex justify-between items-center text-sm">
              <span className="font-bold text-slate-900">
                {r.participant_code} → {r.recipient_code}
              </span>
              <span className="text-slate-400">{r.report_type === 'daily' ? '기본' : '추가'}</span>
            </div>
            <div className="flex justify-between items-center mt-1 text-xs text-slate-400">
              <span>{r.submitted_at ? formatKoreanDateTime(r.submitted_at) : '미제출'}</span>
              <span>{r.completion_seconds ? `${r.completion_seconds}초` : ''}</span>
            </div>
            {r.status === 'submitted' && (
              <div className="mt-2 flex flex-col gap-0.5 text-xs">
                <p className="text-slate-700">
                  <span className="text-slate-400">관찰: </span>
                  {truncateText(finalReport?.change) ?? '미기록'}
                </p>
                <p className="text-slate-700">
                  <span className="text-slate-400">대응: </span>
                  {truncateText(finalReport?.action) ?? '미기록'}
                </p>
                <p className="text-slate-700">
                  <span className="text-slate-400">센터 확인: </span>
                  {truncateText(finalReport?.escalation) ?? '확인 필요'}
                </p>
              </div>
            )}
            <div className="flex gap-1 mt-2 flex-wrap">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.status === 'submitted' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                {r.status === 'submitted' ? '제출완료' : '임시저장'}
              </span>
              {r.status === 'submitted' && <FallbackBadge used={r.ai_fallback_used} ruleBasedByDesign={r.initial_status_choice === 'similar'} />}
              {r.raw_evaluated_at && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">원문평가</span>}
              {r.ai_evaluated_at && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-white">AI평가완료</span>}
              {r.no_information_report && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">무정보</span>}
              {r.emergency_flagged && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">🔴 응급신호</span>}
              {r.status === 'submitted' && r.review_status === 'approved' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">승인됨</span>
              )}
              {r.status === 'submitted' && r.review_status === 'rejected' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">반려됨</span>
              )}
              {r.status === 'submitted' && (!r.review_status || r.review_status === 'pending') && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">검토 대기</span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function ParticipantsPanel({ repo }: { repo: AdminRepo }) {
  const [participants, setParticipants] = useState<
    Array<{ code: string; active: boolean; pinSet: boolean; updatedAt: string; recipientCodes: string[] }>
  >([])
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
            <p className="text-xs text-slate-400 mt-0.5">
              담당 수급자: {p.recipientCodes.length > 0 ? p.recipientCodes.join(', ') : '배정 없음'}
            </p>
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
          {/* isDemoMode()는 현재 URL의 query만 본다 — query 없이 /admin으로만 가면
              데모 모드가 풀려 일반 로그인 화면이 뜬다(DEP-01). 지금 데모 중일 때만
              demo=1을 이어 붙인다. */}
          <a
            href={demo ? '/admin?demo=1' : '/admin'}
            className="text-xs bg-slate-800 text-white rounded-full px-3 py-1 border border-slate-600"
          >
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
            <a
              href={demo ? '/admin/presentation?demo=1' : '/admin/presentation'}
              className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-bold"
            >
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

        {/* Dashboard 탭에는 이미 자체 DEMO 배너가 있다 — 여기서는 그 배너가 없는
            나머지 탭(보고 목록/상세, 참여자 관리)에서만 데모 출처를 남긴다(DEP-03). */}
        {demo && tab !== 'dashboard' && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-2 text-amber-700 text-sm font-bold text-center">
            DEMO DATA · 실제 실증 결과가 아닙니다
          </div>
        )}
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
