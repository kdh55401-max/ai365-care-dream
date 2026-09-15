/** 돌봄 연속성 5단계 — 수급자 관찰 달력(7일·30일)과 날짜별 원문 근거. 서버·데모 공통 계산.
 *
 * - 보고에 저장된 항목별 상태(storedObservations)만 쓴다. 저장되지 않은 항목을 정상·이상으로 채우지 않는다.
 * - 세부 키(식사/수분, 이동/낙상 …)를 그대로 한 줄씩 보인다. 식사·활동·안전·신체·인지·정서·기타는 화면 묶음일 뿐이고,
 *   세분화 이전 복합 키(식사·수분, 이동·낙상)는 추정 분해하지 않고 따로 한 줄로 둔다.
 * - 칸 상태: 평소와 같음 / 변화 / 미관찰 / 불확실 / 미언급 / 보고 없음 / 항목 저장 없음 / 여러 기록·상충 — 문자와 기호로 구분.
 *   같은 날 여러 보고·상충 기록은 숨기지 않고 모두 펼쳐 보인다.
 * - 날짜는 보고일(한국 시간) 기준이다. 관찰 시각·관찰일은 저장되지 않아 관찰일 기준 표시는 하지 않는다(섞지 않음).
 * - 숫자 없는 관찰을 점수·그래프로 바꾸지 않는다. */
import { DOMAIN_LABELS, type CareReportRecord, type DomainKey, type DomainStatus, type InitialStatusChoice, type ReportType } from './careTypes.js'
import { storedObservations, type ObservationEntry } from './recipientHub.js'

export type CalendarWindow = 7 | 30
export function parseCalendarWindow(v: string | null | undefined): CalendarWindow {
  return v === '30' ? 30 : 7
}

/** 화면 묶음(세부 키는 그대로 유지). 복합 레거시 키는 기록이 있을 때만 줄로 보인다. */
export const DISPLAY_GROUPS: Array<{ id: string; label: string; keys: DomainKey[] }> = [
  { id: 'meal', label: '식사', keys: ['meal', 'hydration', 'meal_hydration'] },
  { id: 'activity', label: '활동', keys: ['mobility', 'mobility_fall'] },
  { id: 'safety', label: '안전', keys: ['fall'] },
  { id: 'body', label: '신체', keys: ['excretion', 'pain_breathing', 'sleep', 'skin_hygiene', 'medication'] },
  { id: 'cognition', label: '인지', keys: ['cognition_communication'] },
  { id: 'emotion', label: '정서', keys: ['emotion_behavior'] },
  { id: 'other', label: '기타', keys: ['other', 'not_checked'] },
]
const LEGACY_OR_OPTIONAL: DomainKey[] = ['meal_hydration', 'mobility_fall', 'not_checked']

export type CellState = 'no_report' | 'not_stored' | 'not_mentioned' | 'same_as_usual' | 'changed' | 'not_observed' | 'uncertain' | 'mixed'
export const CELL_STATE_DISPLAY: Record<CellState, { symbol: string; label: string }> = {
  same_as_usual: { symbol: '○', label: '평소와 같음' },
  changed: { symbol: '▲', label: '변화' },
  not_observed: { symbol: '－', label: '미관찰' },
  uncertain: { symbol: '?', label: '불확실' },
  not_mentioned: { symbol: '·', label: '미언급' },
  no_report: { symbol: ' ', label: '보고 없음' },
  not_stored: { symbol: '□', label: '항목 저장 없음' },
  mixed: { symbol: '◆', label: '여러 기록·상충' },
}
export const CELL_STATE_ORDER: CellState[] = ['same_as_usual', 'changed', 'not_observed', 'uncertain', 'not_mentioned', 'mixed', 'not_stored', 'no_report']

export const INITIAL_CHOICE_LABELS: Record<string, string> = { changed: '평소와 다름', similar: '평소와 비슷함', uncertain: '확인 필요' }

type CalReport = Partial<CareReportRecord> & Pick<CareReportRecord, 'id' | 'recipient_code' | 'participant_code' | 'status'>

export interface DayReport {
  reportId: string
  participantCode: string
  reportType: ReportType
  submittedAt: string | null
  reviewStatus: string
  /** 요양보호사가 고른 보고 전체 상태(항목별 상태와 별개). 없으면 null. */
  initialStatusChoice: InitialStatusChoice
  rawExcerpt: string | null
  observations: ObservationEntry[]
  /** 이 보고에 항목별 상태가 하나라도 저장돼 있는지. */
  hasStoredItems: boolean
  emergencyFlagged: boolean
}

export interface CellEntry {
  reportId: string
  status: DomainStatus
  participantCode: string
  submittedAt: string | null
  /** 반려된 보고의 표시(기록은 그대로 보이지만 반복 후보 계산에서는 빠진다). */
  rejected: boolean
}

export interface CalendarCell {
  date: string
  state: CellState
  entries: CellEntry[]
}

export interface CalendarRow {
  domain: DomainKey
  label: string
  legacy: boolean
  cells: CalendarCell[]
}

export interface ObservationCalendar {
  window: CalendarWindow
  /** 날짜 기준 — 관찰일이 저장되지 않아 항상 보고일. */
  basis: 'report_date'
  start: string
  end: string
  days: Array<{ date: string; reports: DayReport[] }>
  groups: Array<{ id: string; label: string; rows: CalendarRow[] }>
  counts: { reports: number; reportsWithItems: number; reportsWithoutItems: number; daysWithReports: number }
}

/** 한국 날짜 문자열(YYYY-MM-DD)에서 n일 전/후. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function excerpt(t: string | null | undefined, max = 160): string | null {
  const v = (t ?? '').trim()
  if (!v) return null
  return v.length > max ? `${v.slice(0, max)}…` : v
}

/** 달력에 쓰는 보고: 실제(연습 아님)·제출·삭제 안 됨. */
export function calendarReports<T extends CalReport>(reports: T[]): T[] {
  return reports.filter((r) => !r.deleted && (r.report_source ?? 'live') === 'live' && r.status === 'submitted' && typeof r.report_date === 'string')
}

export function buildObservationCalendar(reports: CalReport[], window: CalendarWindow, today: string): ObservationCalendar {
  const start = shiftDate(today, -(window - 1))
  const dates = Array.from({ length: window }, (_, i) => shiftDate(start, i))
  const inWindow = calendarReports(reports).filter((r) => (r.report_date as string) >= start && (r.report_date as string) <= today)
  const byDate = new Map<string, CalReport[]>()
  for (const r of inWindow) byDate.set(r.report_date as string, [...(byDate.get(r.report_date as string) ?? []), r])
  for (const list of byDate.values()) list.sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''))

  const days = dates.map((date) => ({
    date,
    reports: (byDate.get(date) ?? []).map((r) => {
      const observations = storedObservations(r)
      return {
        reportId: r.id,
        participantCode: r.participant_code,
        reportType: (r.report_type ?? 'daily') as ReportType,
        submittedAt: r.submitted_at ?? null,
        reviewStatus: r.review_status ?? 'pending',
        initialStatusChoice: (r.initial_status_choice ?? null) as InitialStatusChoice,
        rawExcerpt: excerpt(r.raw_input),
        observations,
        hasStoredItems: observations.length > 0,
        emergencyFlagged: Boolean(r.emergency_flagged),
      }
    }),
  }))

  const present = new Set(inWindow.flatMap((r) => storedObservations(r).map((o) => o.domain)))
  const groups = DISPLAY_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    rows: g.keys
      .filter((k) => !LEGACY_OR_OPTIONAL.includes(k) || present.has(k))
      .map((domain) => ({
        domain,
        label: DOMAIN_LABELS[domain],
        legacy: domain === 'meal_hydration' || domain === 'mobility_fall',
        cells: days.map(({ date, reports: dayReports }) => {
          if (dayReports.length === 0) return { date, state: 'no_report' as CellState, entries: [] }
          const entries: CellEntry[] = dayReports.flatMap((r) =>
            r.observations
              .filter((o) => o.domain === domain)
              .map((o) => ({ reportId: r.reportId, status: o.status, participantCode: r.participantCode, submittedAt: r.submittedAt, rejected: r.reviewStatus === 'rejected' })),
          )
          if (entries.length === 0) {
            // 그날 보고는 있지만 이 항목 기록이 없다: 항목별 상태를 저장한 보고가 있으면 미언급, 아무 보고도 저장하지 않았으면 "항목 저장 없음".
            return { date, state: (dayReports.some((r) => r.hasStoredItems) ? 'not_mentioned' : 'not_stored') as CellState, entries }
          }
          const statuses = new Set(entries.map((e) => e.status))
          const state: CellState = statuses.size > 1 ? 'mixed' : ([...statuses][0] as CellState)
          return { date, state, entries }
        }),
      })),
  })).filter((g) => g.rows.length > 0)

  return {
    window,
    basis: 'report_date',
    start,
    end: today,
    days,
    groups,
    counts: {
      reports: inWindow.length,
      reportsWithItems: inWindow.filter((r) => storedObservations(r).length > 0).length,
      reportsWithoutItems: inWindow.filter((r) => storedObservations(r).length === 0).length,
      daysWithReports: days.filter((d) => d.reports.length > 0).length,
    },
  }
}
