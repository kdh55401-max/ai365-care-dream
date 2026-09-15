/** 5단계 수급자 관찰 화면 한 벌(달력 + 반복 보고 후보 + 값 비교 + 판단 상태 + 열린 조치). 서버·데모 공통. */
import type { CareReportRecord } from './careTypes.js'
import type { BaselineEntry } from './baseline.js'
import type { CareAction } from './workflow.js'
import { buildObservationCalendar, type CalendarWindow, type ObservationCalendar } from './observationCalendar.js'
import {
  compareScaleValues,
  computeRepeatCandidates,
  reviewStateOf,
  type CandidateReview,
  type CandidateReviewState,
  type RepeatCandidate,
  type RepeatResult,
  type ValueComparison,
  type ValueComparisonResult,
} from './changeCandidates.js'

export interface OpenActionBrief {
  id: string
  purpose: string
  status: CareAction['status']
  kind: CareAction['kind']
  sourceReportId: string | null
}

export interface RecipientObservationsView {
  recipientCode: string
  asOf: string
  today: string
  calendar: ObservationCalendar
  repeat: Omit<RepeatResult, 'candidates'> & { items: Array<{ candidate: RepeatCandidate; state: CandidateReviewState }> }
  /** 판단은 있었지만 지금은 조건을 채우지 않거나 근거가 바뀌어 다시 볼 것(판단 이력은 그대로). */
  recheck: Array<{ key: string; state: CandidateReviewState }>
  /** 4단계 기준정보가 준비됐을 때만. */
  values: (Omit<ValueComparisonResult, 'comparisons'> & { items: Array<{ comparison: ValueComparison; state: CandidateReviewState }> }) | null
  /** 판단 저장소(5단계 DB) 준비 여부 — 후보 계산 자체는 보고만으로 한다. */
  reviewsReady: boolean
  /** 같은 수급자의 초안·진행 중 조치(중복 조치를 줄이기 위해 함께 보여준다). */
  openActions: OpenActionBrief[]
}

export function buildRecipientObservations(input: {
  recipientCode: string
  reports: Array<Partial<CareReportRecord> & Pick<CareReportRecord, 'id' | 'recipient_code' | 'participant_code' | 'status'>>
  window: CalendarWindow
  today: string
  now: Date
  reviews: CandidateReview[]
  reviewsReady: boolean
  baselineEntries: BaselineEntry[] | null
  actions: CareAction[]
}): RecipientObservationsView {
  const own = input.reports.filter((r) => r.recipient_code === input.recipientCode)
  const live = own.filter((r) => !r.deleted && (r.report_source ?? 'live') === 'live')
  const reviews = input.reviews.filter((r) => r.recipient_code === input.recipientCode)
  const repeat = computeRepeatCandidates(own, input.today)
  const entries = (input.baselineEntries ?? []).filter((e) => e.recipient_code === input.recipientCode)
  const values = input.baselineEntries ? compareScaleValues(entries) : null
  const currentKeys = new Set([...repeat.candidates.map((c) => c.key), ...(values?.comparisons.map((c) => c.key) ?? [])])
  const repeatItems = repeat.candidates.map((candidate) => ({ candidate, state: reviewStateOf(candidate.key, candidate, reviews, live, entries) }))
  const valueItems = values?.comparisons.map((comparison) => ({ comparison, state: reviewStateOf(comparison.key, comparison, reviews, live, entries) })) ?? []
  const recheck = [...new Set(reviews.map((r) => r.candidate_key))]
    .filter((key) => !currentKeys.has(key))
    .map((key) => ({ key, state: reviewStateOf(key, null, reviews, live, entries) }))
    .filter((x) => x.state.recheckReasons.length > 0)
  const { candidates: _c, ...repeatRest } = repeat
  void _c
  return {
    recipientCode: input.recipientCode,
    asOf: input.now.toISOString(),
    today: input.today,
    calendar: buildObservationCalendar(own, input.window, input.today),
    repeat: { ...repeatRest, items: repeatItems },
    recheck,
    values: values ? { rule: values.rule, excluded: values.excluded, items: valueItems } : null,
    reviewsReady: input.reviewsReady,
    openActions: input.actions
      .filter((a) => a.recipient_code === input.recipientCode && (a.status === 'open' || a.status === 'draft'))
      .map((a) => ({ id: a.id, purpose: a.purpose, status: a.status, kind: a.kind, sourceReportId: a.source_report_id })),
  }
}
