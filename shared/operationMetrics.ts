/** 6단계 — 2·3단계에서 실제로 저장한 이벤트만으로 계산하는 운영 지표.
 *
 * 연구용 실증 지표(shared/statsCalc.ts)와 완전히 분리한다. 저 파일의 수식·분모는 건드리지
 * 않고, 여기서는 업무 이벤트(report_events / admin_decisions / action_obligations /
 * action_events / field_requests / field_responses / action_verifications)만 읽는다.
 *
 * 규칙:
 * - 값만 내놓지 않는다. 지표마다 분자·분모·단위·기간·기준시각·원천 이벤트·제외 건수·해석 주의를 함께 낸다.
 * - 필요한 데이터가 없으면 not_measurable(미측정), 분모가 0이면 not_applicable(해당 없음),
 *   조회가 실패하면 error(오류)다. 셋을 0%로 뭉뚱그리지 않는다.
 * - 기한 관련 비율은 항상 "최초 기한"(initial_due_*)으로 판정한다 — 기한을 미뤄도 과거 지연이 사라지지 않는다.
 * - 취소된 의무는 분모에서 빼되 취소 전 지연 여부·원래 기한·취소 건수를 따로 보인다.
 * - '다음 실제 방문' 기한은 시간 기한과 섞지 않는다. 방문 발생 자료가 없으므로 응답률을 계산하지 않는다.
 * - 과거 로그를 만들어 채우지 않는다. 이벤트가 없는 이전 기록은 제외 건수로만 남긴다.
 */
import type { CareReportRecord } from './careTypes.js'
import {
  VERIFICATION_OUTCOME_LABELS,
  timeOf,
  type ActionEvent,
  type ActionObligation,
  type ActionVerification,
  type AdminDecision,
  type CareAction,
  type FieldRequest,
  type FieldResponse,
  type ReportEvent,
  type ResponseStatus,
} from './workflow.js'

const KST_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** 0 = 전체 기간(제한 없음). */
export const OPERATION_PERIODS = [7, 30, 90, 0] as const
export type OperationPeriod = (typeof OPERATION_PERIODS)[number]

export function parseOperationPeriod(v: string | null | undefined): OperationPeriod {
  const n = Number(v)
  return v !== null && v !== undefined && v !== '' && (OPERATION_PERIODS as readonly number[]).includes(n) ? (n as OperationPeriod) : 30
}

export interface OperationWindow {
  days: OperationPeriod
  /** 시작 포함(null이면 전체 기간). */
  startIso: string | null
  /** 종료 미포함 — 한국시간 오늘 자정 다음. */
  endIso: string
  startDate: string | null
  endDate: string
  label: string
}

/** 한국 날짜 경계로 기간을 만든다. 시작 포함·종료 미포함이며 오늘 하루도 기간에 들어간다. */
export function operationWindow(now: Date, days: OperationPeriod): OperationWindow {
  const kstToday = new Date(now.getTime() + KST_MS).toISOString().slice(0, 10)
  const endMs = new Date(`${kstToday}T00:00:00Z`).getTime() - KST_MS + DAY_MS
  const endIso = new Date(endMs).toISOString()
  if (days === 0) {
    return { days, startIso: null, endIso, startDate: null, endDate: kstToday, label: '전체 기간' }
  }
  const startMs = endMs - days * DAY_MS
  return {
    days,
    startIso: new Date(startMs).toISOString(),
    endIso,
    startDate: new Date(startMs + KST_MS).toISOString().slice(0, 10),
    endDate: kstToday,
    label: `최근 ${days}일`,
  }
}

function inWindow(iso: string | null | undefined, w: OperationWindow): boolean {
  const t = timeOf(iso)
  if (t === null) return false
  const end = timeOf(w.endIso) ?? 0
  const start = w.startIso === null ? -Infinity : (timeOf(w.startIso) ?? 0)
  return t >= start && t < end
}

export type MetricState = 'ok' | 'not_measurable' | 'not_applicable' | 'error'
export const METRIC_STATE_LABELS: Record<MetricState, string> = {
  ok: '측정됨',
  not_measurable: '미측정',
  not_applicable: '해당 없음',
  error: '오류',
}

export interface MetricBreakdown {
  label: string
  count: number
  note?: string
}

export interface OperationMetric {
  id: string
  label: string
  state: MetricState
  /** 왜 이 상태인지 — 미측정·해당 없음·오류일 때 반드시 채운다. */
  stateNote: string | null
  /** 분모의 단위(의무·이슈·주기·보고·조치). 단위가 다른 지표를 합치지 않는다. */
  unit: string
  numerator: number | null
  denominator: number | null
  percent: number | null
  /** 비율이 아닌 값(중앙값·90백분위·건수 등). */
  values: Array<{ label: string; text: string }>
  definition: string
  /** 계산에 실제로 쓴 원천 이벤트·테이블. */
  sources: string[]
  /** 분모에서 뺀 것 — 조용히 사라지지 않게 건수를 남긴다. */
  excluded: MetricBreakdown[]
  /** 분자·분모 밖의 참고 건수(응답 종류, 재개 사유 등). */
  breakdown: MetricBreakdown[]
  cautions: string[]
}

export interface SourceCount {
  id: string
  label: string
  count: number | null
  unit: string
  ready: boolean
  note: string
}

export interface OperationMetricsView {
  asOf: string
  window: OperationWindow
  workflowReady: boolean
  fieldRequestsReady: boolean
  metrics: OperationMetric[]
  sourceCounts: SourceCount[]
}

export interface OperationMetricsInput {
  now: Date
  days: OperationPeriod
  workflowReady: boolean
  fieldRequestsReady: boolean
  /** 실데이터 보고만(데모·시나리오·삭제 제외) — 호출부에서 걸러 넘긴다. */
  reports: CareReportRecord[]
  reportEvents: ReportEvent[]
  decisions: AdminDecision[]
  actions: CareAction[]
  obligations: ActionObligation[]
  actionEvents: ActionEvent[]
  requests: FieldRequest[]
  responses: FieldResponse[]
  verifications: ActionVerification[]
}

function pct(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 1000) / 10
}

/** 최근접 순위법 — 작은 표본에서 보간으로 없는 값을 만들지 않는다. */
export function percentileSeconds(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '-'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}초`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  const restMin = m % 60
  if (h < 24) return restMin ? `${h}시간 ${restMin}분` : `${h}시간`
  const d = Math.floor(h / 24)
  const restHour = h % 24
  return restHour ? `${d}일 ${restHour}시간` : `${d}일`
}

const RESPONSE_BREAKDOWN_LABELS: Record<ResponseStatus, string> = {
  observed: '관찰함',
  performed: '수행함',
  not_observed: '미관찰',
  refused: '거절',
  other: '기타',
}

function notReady(id: string, label: string, unit: string, definition: string, sources: string[], why: string): OperationMetric {
  return {
    id,
    label,
    state: 'not_measurable',
    stateNote: why,
    unit,
    numerator: null,
    denominator: null,
    percent: null,
    values: [],
    definition,
    sources,
    excluded: [],
    breakdown: [],
    cautions: [],
  }
}

/** 분모가 0이면 0%가 아니라 '해당 없음'이다. */
function finish(m: OperationMetric): OperationMetric {
  if (m.state !== 'ok' || m.denominator === null) return m
  if (m.denominator === 0) {
    return { ...m, state: 'not_applicable', stateNote: '이 기간에 해당하는 대상이 없습니다(0%가 아닙니다).', percent: null }
  }
  return m
}

export function buildOperationMetrics(input: OperationMetricsInput): OperationMetricsView {
  const asOf = input.now.toISOString()
  const asOfMs = input.now.getTime()
  const w = operationWindow(input.now, input.days)
  const ready = input.workflowReady
  const frReady = ready && input.fieldRequestsReady
  const period = `기간 ${w.startDate ?? '처음'}~${w.endDate}(한국시간 자정 경계, 시작 포함·종료 다음날 자정 미포함) · 기준시각 ${asOf}`
  const actionsById = new Map(input.actions.map((a) => [a.id, a]))

  const metrics: OperationMetric[] = [
    firstReviewTime(input, w, period, ready),
    responseRate(input, w, period, asOfMs, frReady, actionsById),
    verificationOnTime(input, w, period, asOfMs, ready, actionsById),
    nextVisitRequests(input, w, period, frReady),
    actionLinkRate(input, w, period, ready),
    outcomeEvidenceRate(input, w, period, frReady, actionsById),
    reopenCount(input, w, period, ready),
  ]

  return {
    asOf,
    window: w,
    workflowReady: ready,
    fieldRequestsReady: frReady,
    metrics: metrics.map(finish),
    sourceCounts: sourceCounts(input, ready, frReady),
  }
}

// ── 1. 최초 검토시간 ────────────────────────────────────────────────
function firstReviewTime(input: OperationMetricsInput, w: OperationWindow, period: string, ready: boolean): OperationMetric {
  const definition = `제출 이벤트가 이 기간에 있는 보고 중 첫 승인·반려 이벤트까지 걸린 시간의 중앙값·90백분위. ${period}`
  const sources = ['report_events.submitted', 'report_events.review_approved', 'report_events.review_rejected']
  if (!ready) return notReady('first_review_time', '최초 검토시간', '보고', definition, sources, '2단계 저장소(report_events)가 아직 적용되지 않았습니다.')

  const submittedAt = new Map<string, number>()
  const reviewedAt = new Map<string, number>()
  for (const e of input.reportEvents) {
    const t = timeOf(e.occurred_at)
    if (t === null) continue
    const target = e.event_type === 'submitted' ? submittedAt : reviewedAt
    const cur = target.get(e.report_id)
    if (cur === undefined || t < cur) target.set(e.report_id, t)
  }
  const cohort = [...submittedAt.entries()].filter(([, t]) => inWindow(new Date(t).toISOString(), w))
  const paired: number[] = []
  let pending = 0
  let longestWait = 0
  for (const [id, sub] of cohort) {
    const rev = reviewedAt.get(id)
    if (rev !== undefined && rev >= sub) paired.push((rev - sub) / 1000)
    else {
      pending += 1
      longestWait = Math.max(longestWait, (input.now.getTime() - sub) / 1000)
    }
  }
  paired.sort((a, b) => a - b)
  // 제출 이벤트가 없는 이전 보고는 updated_at 등으로 추정하지 않고 제외 건수로만 남긴다.
  const legacy = input.reports.filter((r) => r.status === 'submitted' && inWindow(r.submitted_at, w) && !submittedAt.has(r.id)).length

  return {
    id: 'first_review_time',
    label: '최초 검토시간',
    state: 'ok',
    stateNote: null,
    unit: '보고',
    numerator: paired.length,
    denominator: cohort.length,
    percent: null,
    values: [
      { label: '중앙값', text: formatDuration(percentileSeconds(paired, 50)) },
      { label: '90백분위', text: formatDuration(percentileSeconds(paired, 90)) },
      { label: '측정된 표본', text: `${paired.length}건 / 기간 내 제출 ${cohort.length}건` },
      { label: '아직 미검토', text: pending ? `${pending}건 · 최장 대기 ${formatDuration(longestWait)}` : '0건' },
    ],
    definition,
    sources,
    excluded: [
      { label: '제출 이벤트가 없는 이전 보고', count: legacy, note: '이 기능 이전 기록 — 과거 검토 시각을 만들어 채우지 않습니다.' },
      { label: '아직 검토되지 않아 경과시간을 확정할 수 없는 보고', count: pending },
    ],
    breakdown: [],
    cautions: [
      '업무가 대기·처리된 경과시간이며 관리자가 실제 일한 시간이 아닙니다.',
      '중앙값이 줄었다는 것만으로 노동시간이 줄었다고 말할 수 없습니다.',
      `작은 표본에서 90백분위는 흔들립니다(표본 ${paired.length}건, 최근접 순위법).`,
    ],
  }
}

// ── 2. 요청 응답률 ──────────────────────────────────────────────────
function responseRate(
  input: OperationMetricsInput,
  w: OperationWindow,
  period: string,
  asOfMs: number,
  frReady: boolean,
  actionsById: Map<string, CareAction>,
): OperationMetric {
  const definition = `최초 응답기한(시각 지정)이 이 기간에 도래한 현장 응답 의무 중 기준시각까지 유효한 응답이 연결된 의무의 비율. ${period}`
  const sources = ['action_obligations.initial_due_at', 'field_requests', 'field_responses']
  if (!frReady) {
    return notReady('request_response_rate', '요청 응답률', '의무', definition, sources, '3단계 저장소(field_requests·field_responses)가 아직 적용되지 않았습니다.')
  }

  const requestsByObligation = new Map<string, FieldRequest[]>()
  for (const r of input.requests) requestsByObligation.set(r.obligation_id, [...(requestsByObligation.get(r.obligation_id) ?? []), r])
  const responsesByObligation = new Map<string, FieldResponse[]>()
  for (const r of input.responses) responsesByObligation.set(r.obligation_id, [...(responsesByObligation.get(r.obligation_id) ?? []), r])

  const dueArrived = input.obligations.filter(
    (o) =>
      o.obligation_type === 'field_response' &&
      o.initial_due_kind === 'datetime' &&
      inWindow(o.initial_due_at, w) &&
      (timeOf(o.initial_due_at) ?? Infinity) <= asOfMs &&
      actionsById.has(o.action_id),
  )
  const cancelled = dueArrived.filter((o) => o.status === 'cancelled')
  const neverPublished = dueArrived.filter((o) => o.status !== 'cancelled' && !(requestsByObligation.get(o.id)?.length))
  const denom = dueArrived.filter((o) => o.status !== 'cancelled' && (requestsByObligation.get(o.id)?.length ?? 0) > 0)

  let answered = 0
  let late = 0
  const byStatus = new Map<ResponseStatus, number>()
  for (const o of denom) {
    const rows = (responsesByObligation.get(o.id) ?? []).slice().sort((a, b) => (timeOf(a.submitted_at) ?? 0) - (timeOf(b.submitted_at) ?? 0))
    if (!rows.length) continue
    answered += 1
    const first = rows[0]
    byStatus.set(first.response_status, (byStatus.get(first.response_status) ?? 0) + 1)
    if ((timeOf(first.submitted_at) ?? 0) > (timeOf(o.initial_due_at) ?? 0)) late += 1
  }
  // 취소 전에 이미 기한이 지나 있었는지 — 취소로 과거 지연이 조용히 사라지지 않게 따로 센다.
  const lateBeforeCancel = cancelled.filter((o) => {
    const due = timeOf(o.initial_due_at)
    const at = timeOf(o.cancelled_at)
    return due !== null && at !== null && at > due && !(responsesByObligation.get(o.id)?.length)
  }).length

  return {
    id: 'request_response_rate',
    label: '요청 응답률',
    state: 'ok',
    stateNote: null,
    unit: '의무',
    numerator: answered,
    denominator: denom.length,
    percent: pct(answered, denom.length),
    values: [
      { label: '기한 지나 도착한 응답', text: `${late}건` },
      { label: '아직 응답 없음', text: `${denom.length - answered}건` },
    ],
    definition,
    sources,
    excluded: [
      {
        label: '취소된 의무',
        count: cancelled.length,
        note: lateBeforeCancel ? `그중 취소 전 이미 기한이 지나 있던 의무 ${lateBeforeCancel}건(원래 기한 보존)` : '취소 전 지연 없음',
      },
      { label: '게시된 적 없어 현장에 전달되지 않은 의무', count: neverPublished.length, note: '현장이 볼 수 없었으므로 미응답 실패로 세지 않습니다.' },
    ],
    breakdown: [...byStatus.entries()].map(([k, count]) => ({ label: `첫 응답: ${RESPONSE_BREAKDOWN_LABELS[k]}`, count })),
    cautions: [
      '기한 내 응답률이 아닙니다 — 늦게 도착한 응답도 분자에 들어갑니다(늦은 응답 건수 별도).',
      '응답이 왔다는 사실이며 문제가 해결됐다는 뜻이 아닙니다(미관찰·거절 응답도 도착으로 셉니다).',
      '미응답 의무는 분모에 그대로 남겨 둡니다.',
    ],
  }
}

// ── 3. 기한 내 결과확인율 ───────────────────────────────────────────
function verificationOnTime(
  input: OperationMetricsInput,
  w: OperationWindow,
  period: string,
  asOfMs: number,
  ready: boolean,
  actionsById: Map<string, CareAction>,
): OperationMetric {
  const definition = `최초 관리자 재확인기한(시각 지정)이 이 기간에 도래한 의무 중 그 "최초" 기한까지 결과 확인이 기록된 의무의 비율. ${period}`
  const sources = ['action_obligations.initial_due_at', 'action_verifications.verified_at']
  if (!ready) return notReady('verification_on_time', '기한 내 결과확인율', '의무', definition, sources, '2단계 저장소(action_obligations)가 아직 적용되지 않았습니다.')

  const verificationsByAction = new Map<string, ActionVerification[]>()
  for (const v of input.verifications) verificationsByAction.set(v.action_id, [...(verificationsByAction.get(v.action_id) ?? []), v])

  const dueArrived = input.obligations.filter(
    (o) =>
      o.obligation_type === 'admin_verification' &&
      o.initial_due_kind === 'datetime' &&
      inWindow(o.initial_due_at, w) &&
      (timeOf(o.initial_due_at) ?? Infinity) <= asOfMs &&
      actionsById.has(o.action_id),
  )
  const cancelled = dueArrived.filter((o) => o.status === 'cancelled')
  const denom = dueArrived.filter((o) => o.status !== 'cancelled')
  const verifiedAtOf = (o: ActionObligation): number | null => {
    const times = (verificationsByAction.get(o.action_id) ?? [])
      .filter((v) => v.cycle_no === o.cycle_no)
      .map((v) => timeOf(v.verified_at))
      .filter((t): t is number => t !== null)
    return times.length ? Math.min(...times) : null
  }
  let onTime = 0
  let lateDone = 0
  let notDone = 0
  for (const o of denom) {
    const at = verifiedAtOf(o)
    const due = timeOf(o.initial_due_at) ?? 0
    if (at === null) notDone += 1
    else if (at <= due) onTime += 1
    else lateDone += 1
  }
  const dueMoved = denom.filter((o) => o.current_due_kind !== o.initial_due_kind || o.current_due_at !== o.initial_due_at).length
  const lateBeforeCancel = cancelled.filter((o) => {
    const due = timeOf(o.initial_due_at)
    const at = timeOf(o.cancelled_at)
    return due !== null && at !== null && at > due && verifiedAtOf(o) === null
  }).length

  return {
    id: 'verification_on_time',
    label: '기한 내 결과확인율',
    state: 'ok',
    stateNote: null,
    unit: '의무',
    numerator: onTime,
    denominator: denom.length,
    percent: pct(onTime, denom.length),
    values: [
      { label: '기한 뒤에 확인됨', text: `${lateDone}건` },
      { label: '아직 결과 확인 없음', text: `${notDone}건` },
      { label: '기한이 바뀐 의무', text: `${dueMoved}건 — 판정은 언제나 최초 기한 기준입니다.` },
    ],
    definition,
    sources,
    excluded: [
      {
        label: '취소된 의무',
        count: cancelled.length,
        note: lateBeforeCancel ? `그중 취소 전 이미 기한이 지나 있던 의무 ${lateBeforeCancel}건(원래 기한 보존)` : '취소해도 최초 기한과 취소 시각은 남습니다.',
      },
    ],
    breakdown: [],
    cautions: [
      '기한을 미뤄도 과거 지연은 지워지지 않습니다 — 현재 기한이 아니라 최초 기한으로 판정합니다.',
      '결과를 확인했다는 것이지 상태가 좋아졌다는 뜻이 아닙니다.',
    ],
  }
}

// ── 3-b. '다음 실제 방문' 요청(시간 기한과 분리) ────────────────────
function nextVisitRequests(input: OperationMetricsInput, w: OperationWindow, period: string, frReady: boolean): OperationMetric {
  const definition = `기한이 '다음 실제 방문'인 현장 응답 의무. 방문이 실제로 있었는지 알려 주는 독립 자료가 없으므로 응답률을 계산하지 않는다. ${period}`
  const sources = ['action_obligations.initial_due_kind = next_actual_visit', 'field_requests', 'field_responses']
  if (!frReady) return notReady('next_visit_requests', '다음 방문 요청(별도 집계)', '의무', definition, sources, '3단계 저장소가 아직 적용되지 않았습니다.')

  const respondedObligations = new Set(input.responses.map((r) => r.obligation_id))
  const publishedObligations = new Set(input.requests.map((r) => r.obligation_id))
  const rows = input.obligations.filter((o) => o.obligation_type === 'field_response' && o.initial_due_kind === 'next_actual_visit' && inWindow(o.created_at, w))
  const published = rows.filter((o) => publishedObligations.has(o.id)).length
  const answered = rows.filter((o) => respondedObligations.has(o.id)).length
  const cancelled = rows.filter((o) => o.status === 'cancelled').length

  return {
    id: 'next_visit_requests',
    label: '다음 방문 요청(별도 집계)',
    state: rows.length === 0 ? 'not_applicable' : 'not_measurable',
    stateNote:
      rows.length === 0
        ? '이 기간에 다음 방문 기한 요청이 없습니다.'
        : '방문이 실제로 있었는지 확인할 독립 자료가 없어 응답률을 계산하지 않습니다 — 미래 방문 요청을 미응답 실패로 확정하지 않습니다.',
    unit: '의무',
    numerator: null,
    denominator: null,
    percent: null,
    values: [
      { label: '게시된 요청', text: `${published}건` },
      { label: '응답 도착', text: `${answered}건` },
      { label: '방문 발생 확인 불가', text: `${rows.length - answered}건` },
    ],
    definition,
    sources,
    excluded: [{ label: '취소된 의무', count: cancelled }],
    breakdown: [{ label: '기간 내 만들어진 다음 방문 기한 의무', count: rows.length }],
    cautions: ['시간 기한 요청과 같은 분모로 합치지 않습니다.', '방문 기회가 아직 오지 않았을 수 있습니다.'],
  }
}

// ── 4. 조치 연결률 ──────────────────────────────────────────────────
function actionLinkRate(input: OperationMetricsInput, w: OperationWindow, period: string, ready: boolean): OperationMetric {
  const definition = `이 기간에 "조치 필요"로 판단한 이슈(보고 한 건의 현재 판단) 중 기준시각까지 조치가 연결된 이슈의 비율. 판단 id로 연결됐거나, 같은 보고에 판단 뒤 만들어진 조치가 있으면 연결로 본다. ${period}`
  const sources = ['admin_decisions.decision = action_needed', 'care_actions.decision_id', 'care_actions.source_report_id']
  if (!ready) return notReady('action_link_rate', '조치 연결률', '이슈', definition, sources, '2단계 저장소(admin_decisions)가 아직 적용되지 않았습니다.')

  // 한 보고를 여러 번 판단할 수 있다 — 이슈는 보고 하나이므로 "가장 나중 판단"만 센다.
  const latestByReport = new Map<string, AdminDecision>()
  for (const d of input.decisions) {
    const cur = latestByReport.get(d.report_id)
    if (!cur || (timeOf(d.decided_at) ?? 0) >= (timeOf(cur.decided_at) ?? 0)) latestByReport.set(d.report_id, d)
  }
  const superseded = input.decisions.filter((d) => d.decision === 'action_needed' && inWindow(d.decided_at, w) && latestByReport.get(d.report_id)?.id !== d.id).length
  const needed = [...latestByReport.values()].filter((d) => d.decision === 'action_needed' && inWindow(d.decided_at, w))

  const actionsByDecision = new Map<string, CareAction[]>()
  const actionsByReport = new Map<string, CareAction[]>()
  for (const a of input.actions) {
    if (a.decision_id) actionsByDecision.set(a.decision_id, [...(actionsByDecision.get(a.decision_id) ?? []), a])
    if (a.source_report_id) actionsByReport.set(a.source_report_id, [...(actionsByReport.get(a.source_report_id) ?? []), a])
  }
  let linked = 0
  let onlyCancelled = 0
  for (const d of needed) {
    const decidedMs = timeOf(d.decided_at) ?? 0
    const rows = [
      ...(actionsByDecision.get(d.id) ?? []),
      ...(actionsByReport.get(d.report_id) ?? []).filter((a) => a.decision_id !== d.id && (timeOf(a.created_at) ?? 0) >= decidedMs),
    ]
    if (rows.some((a) => a.status !== 'cancelled')) linked += 1
    else if (rows.length) onlyCancelled += 1
  }

  return {
    id: 'action_link_rate',
    label: '조치 연결률',
    state: 'ok',
    stateNote: null,
    unit: '이슈',
    numerator: linked,
    denominator: needed.length,
    percent: pct(linked, needed.length),
    values: [{ label: '조치가 없는 이슈', text: `${needed.length - linked}건 — 분모에 그대로 남겨 둡니다.` }],
    definition,
    sources,
    excluded: [{ label: '나중에 다시 판단해 현재 판단이 아닌 옛 "조치 필요" 판단', count: superseded, note: '한 보고를 두 번 세지 않습니다.' }],
    breakdown: [{ label: '연결된 조치가 취소만 된 이슈', count: onlyCancelled, note: '조치 있음으로 세지 않습니다.' }],
    cautions: [
      '높다고 항상 좋은 것이 아닙니다 — 평소와 같은 보고에 불필요한 요청이 늘어도 올라갑니다.',
      '조치의 적절성은 표준 사례나 사람이 검토한 표본으로 따로 평가해야 합니다.',
    ],
  }
}

// ── 5. 결과 근거 보유율 ─────────────────────────────────────────────
function outcomeEvidenceRate(
  input: OperationMetricsInput,
  w: OperationWindow,
  period: string,
  frReady: boolean,
  actionsById: Map<string, CareAction>,
): OperationMetric {
  const definition = `이 기간에 종결된 업무 주기(관리자 결과 확인 한 건 = 주기 하나) 중 현장 응답 원문이 근거로 연결된 주기의 비율. ${period}`
  const sources = ['action_verifications.verified_at', 'action_verifications.response_ids', 'care_actions.status']
  if (!frReady) return notReady('outcome_evidence_rate', '결과 근거 보유율', '주기', definition, sources, '3단계 저장소(action_verifications)가 아직 적용되지 않았습니다.')

  const closed = input.verifications.filter((v) => inWindow(v.verified_at, w) && actionsById.has(v.action_id))
  const withResponses = closed.filter((v) => v.response_ids.length > 0).length
  const textOnly = closed.length - withResponses
  const closesAction = closed.filter((v) => v.closes_action).length
  const cancelledActions = input.actions.filter((a) => a.status === 'cancelled' && inWindow(a.cancelled_at, w)).length
  const byOutcome = new Map<string, number>()
  for (const v of closed) byOutcome.set(v.outcome, (byOutcome.get(v.outcome) ?? 0) + 1)

  return {
    id: 'outcome_evidence_rate',
    label: '결과 근거 보유율',
    state: 'ok',
    stateNote: null,
    unit: '주기',
    numerator: withResponses,
    denominator: closed.length,
    percent: pct(withResponses, closed.length),
    values: [
      { label: '근거 글만 있고 현장 응답 연결 없음', text: `${textOnly}건` },
      { label: '조치를 종결한 주기', text: `${closesAction}건` },
      { label: '새 후속 주기를 연 주기', text: `${closed.length - closesAction}건` },
    ],
    definition,
    sources,
    excluded: [{ label: '취소된 조치', count: cancelledActions, note: '취소는 종결이 아니므로 분모에 넣지 않습니다.' }],
    breakdown: [...byOutcome.entries()].map(([k, count]) => ({
      label: `결과: ${VERIFICATION_OUTCOME_LABELS[k as keyof typeof VERIFICATION_OUTCOME_LABELS] ?? k}`,
      count,
    })),
    cautions: [
      '형식상 근거가 연결됐다는 뜻이며, 결과가 적절했는지·상태가 좋아졌는지와는 다릅니다.',
      '확인 불가·거절·외부 인계로 종결한 주기도 종결로 셉니다(건강 개선이 아닙니다).',
    ],
  }
}

// ── 6. 재개방 건수 ──────────────────────────────────────────────────
function reopenCount(input: OperationMetricsInput, w: OperationWindow, period: string, ready: boolean): OperationMetric {
  const definition = `이 기간에 완료된 업무를 다시 연 이벤트 수와 그 고유 조치 수. ${period}`
  const sources = ['action_events.event_type = reopened']
  if (!ready) return notReady('reopen_count', '재개방 건수', '이벤트', definition, sources, '2단계 저장소(action_events)가 아직 적용되지 않았습니다.')

  const rows = input.actionEvents.filter((e) => e.event_type === 'reopened' && inWindow(e.occurred_at, w))
  const actions = new Set(rows.map((e) => e.action_id))
  const byReason = new Map<string, number>()
  for (const e of rows) {
    const key = (e.reason ?? '').trim() || '(사유 없음)'
    byReason.set(key, (byReason.get(key) ?? 0) + 1)
  }

  return {
    id: 'reopen_count',
    label: '재개방 건수',
    state: rows.length === 0 ? 'not_applicable' : 'ok',
    stateNote: rows.length === 0 ? '이 기간에 재개방 이벤트가 없습니다(0건이며, 측정 실패가 아닙니다).' : null,
    unit: '이벤트',
    numerator: rows.length,
    denominator: null,
    percent: null,
    values: [
      { label: '재개방 이벤트', text: `${rows.length}건` },
      { label: '고유 조치', text: `${actions.size}건` },
    ],
    definition,
    sources,
    excluded: [],
    breakdown: [...byReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label: `사유: ${label}`, count })),
    cautions: ['임상적 재발 건수가 아닙니다 — 업무를 다시 연 횟수입니다.', '새 사건으로 만든 조치는 여기에 들어가지 않습니다.'],
  }
}

// ── 원천 상태별 실제 건수(현재 상태 — 기간 성과와 섞지 않는다) ──────
function sourceCounts(input: OperationMetricsInput, ready: boolean, frReady: boolean): SourceCount[] {
  const submitted = input.reports.filter((r) => r.status === 'submitted')
  const openActions = input.actions.filter((a) => a.status === 'open')
  const openIds = new Set(openActions.map((a) => a.id))
  const nowMs = input.now.getTime()
  return [
    {
      id: 'reports_pending',
      label: '검토 대기 보고',
      count: submitted.filter((r) => (r.review_status ?? 'pending') === 'pending').length,
      unit: '보고',
      ready: true,
      note: '제출됐고 승인·반려 기록이 없는 보고(현재 상태).',
    },
    { id: 'actions_open', label: '열린 조치', count: ready ? openActions.length : null, unit: '조치', ready, note: '초안·완료·취소 제외.' },
    {
      id: 'requests_published',
      label: '게시된 확인 요청',
      count: frReady ? input.requests.filter((r) => r.status === 'published' && openIds.has(r.action_id)).length : null,
      unit: '요청',
      ready: frReady,
      note: '현장에 게시돼 응답을 기다리는 요청.',
    },
    {
      id: 'responses_arrived',
      label: '후속 응답 도착(결과 확인 대기)',
      count: frReady ? input.requests.filter((r) => r.status === 'answered' && openIds.has(r.action_id)).length : null,
      unit: '요청',
      ready: frReady,
      note: '응답이 왔지만 관리자 결과 확인이 남은 요청 — 응답만으로 완료가 아닙니다.',
    },
    {
      id: 'verifications_done',
      label: '관리자 재확인 완료(누적)',
      count: frReady ? input.verifications.length : null,
      unit: '주기',
      ready: frReady,
      note: '전체 기간 누적 — 위 기간 지표와 분모가 다릅니다.',
    },
    {
      id: 'obligations_overdue',
      label: '기한 경과 의무',
      count: ready
        ? input.obligations.filter(
            (o) => o.status === 'active' && o.current_due_kind === 'datetime' && (timeOf(o.current_due_at) ?? Infinity) < nowMs && openIds.has(o.action_id),
          ).length
        : null,
      unit: '의무',
      ready,
      note: '현재 기한 기준의 지금 상태 — 위 기한 내 비율(최초 기한 기준)과 다른 값입니다.',
    },
  ]
}
