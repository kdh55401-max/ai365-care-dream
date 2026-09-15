/** 관리자 수급자 허브(기관 → 수급자 목록 → 수급자 상세 타임라인)와 검토 대기 목록의
 * 계산. 서버(api/admin/recipients)와 데모 저장소가 같은 함수를 쓴다 — 화면은 이
 * 결과만 그린다.
 *
 * 원칙:
 * - 보고 원문(요양보호사의 말/입력 그대로 = 보고자 진술), AI 정리 초안, 요양보호사
 *   확인·제출본, 관리자 검토(승인/반려)를 서로 다른 필드로 내려준다. 합치지 않는다.
 * - 항목별 관찰 상태는 보고에 실제로 저장된 값만 쓴다. 저장되지 않은 항목은 결과에
 *   넣지 않는다(= "정보 없음"을 정상·이상·미응답 어느 쪽으로도 바꾸지 않는다).
 * - 검토 대기 "이유"는 저장된 필드에서만 뽑는다. 새 위험도·중증도를 만들지 않는다. */
import {
  DOMAIN_KEYS,
  DOMAIN_LABELS,
  normalizeReportRecord,
  type CareReportRecord,
  type DomainEntry,
  type DomainKey,
  type DomainStatus,
  type FollowupItem,
  type InitialStatusChoice,
  type ReportType,
  type ReviewStatus,
  type StructuredReport,
} from './careTypes.js'

export type TimelinePeriod = '7' | '30' | 'all'
export const DEFAULT_TIMELINE_PERIOD: TimelinePeriod = '30'

export function parseTimelinePeriod(v: string | null | undefined): TimelinePeriod {
  return v === '7' || v === '30' || v === 'all' ? v : DEFAULT_TIMELINE_PERIOD
}

export const OBSERVATION_STATUS_LABELS: Record<DomainStatus, string> = {
  same_as_usual: '평소와 같음',
  changed: '변화 보고',
  not_observed: '미관찰',
  uncertain: '불확실',
  not_mentioned: '미언급',
}

export interface ObservationEntry {
  domain: DomainKey
  label: string
  status: DomainStatus
  statusLabel: string
}

export interface ReviewReason {
  code: string
  label: string
  tone: 'alert' | 'info'
}

export interface ReviewQueueItem {
  reportId: string
  recipientCode: string
  participantCode: string
  reportType: ReportType
  reportDate: string
  submittedAt: string | null
  emergencyFlagged: boolean
  reasons: ReviewReason[]
  /** 관찰 내용 한 줄 — 요양보호사 확인본의 "관찰한 돌봄 상황"이 있으면 그것, 없으면 원문. */
  excerpt: string | null
  excerptSource: 'caregiver_final' | 'raw_input' | null
}

export interface RecipientSummary {
  code: string
  active: boolean
  /** 현재 활성 배정된 요양보호사 코드. 비어 있으면 "담당 미배정"이다. */
  caregivers: string[]
  lastSubmitted: { reportId: string; submittedAt: string | null; reportDate: string; participantCode: string } | null
  submittedCount: number
  pendingReviewCount: number
  pendingEmergencyCount: number
  draftCount: number
}

export interface TimelineEntry {
  reportId: string
  reportType: ReportType
  reportDate: string
  submittedAt: string | null
  author: { role: 'caregiver'; code: string }
  raw: { text: string; followups: FollowupItem[] }
  structured: {
    aiDraft: StructuredReport | null
    caregiverFinal: StructuredReport | null
    /** true=최종 기록 생성 단계에서 규칙 기반 대체가 쓰였음, null=기록 이전이라 확인 불가. */
    aiFallbackUsed: boolean | null
    /** "평소와 비슷했어요" 흐름은 애초에 AI를 부르지 않고 규칙 템플릿으로 정리한다. */
    ruleBasedByDesign: boolean
    /** 요양보호사가 AI 초안을 고쳐서 제출했는지(공백 차이 무시). 둘 중 하나가 없으면 null. */
    caregiverEdited: boolean | null
  }
  review: {
    status: ReviewStatus
    reviewedAt: string | null
    firstViewedAt: string | null
    adminFinal: StructuredReport | null
    note: string | null
    noteVisibleToCaregiver: boolean
    historyCount: number
  }
  observations: ObservationEntry[]
  initialStatusChoice: InitialStatusChoice
  noInformationReport: boolean
  emergencyFlagged: boolean
  reviewReasons: ReviewReason[]
}

export interface DraftSummary {
  reportId: string
  startedAt: string
  participantCode: string
  emergencyFlagged: boolean
}

export interface RecipientTimeline {
  period: TimelinePeriod
  /** 기간 시작일(보고일 KST, 포함). 'all'이면 null. */
  since: string | null
  today: string
  entries: TimelineEntry[]
  drafts: DraftSummary[]
}

type HubReport = Partial<CareReportRecord> & Pick<CareReportRecord, 'id' | 'recipient_code' | 'participant_code' | 'status'>

function isLiveReport(r: HubReport): boolean {
  return !r.deleted && (r.report_source ?? 'live') === 'live'
}

function isPendingReview(r: HubReport): boolean {
  return r.status === 'submitted' && (r.review_status ?? 'pending') === 'pending'
}

function sameText(a: StructuredReport | null | undefined, b: StructuredReport | null | undefined): boolean {
  const fields: Array<keyof StructuredReport> = ['change', 'action', 'result', 'escalation']
  const norm = (v: string | undefined) => (v ?? '').trim().replace(/\s+/g, ' ')
  return fields.every((f) => norm(a?.[f]) === norm(b?.[f]))
}

function asEntries(v: unknown): DomainEntry[] {
  return Array.isArray(v) ? (v as DomainEntry[]).filter((e) => e && typeof e.domain === 'string' && typeof e.status === 'string') : []
}

/** 보고에 저장된 영역별 상태(4개 목록)를 하나로 모아 영역 순서대로 돌려준다.
 * 저장된 값이 없으면 빈 배열이다 — 여기서 어떤 상태도 추정해 만들지 않는다. */
export function storedObservations(r: HubReport): ObservationEntry[] {
  const all = [
    ...asEntries(r.observed_domains_json),
    ...asEntries(r.changed_domains_json),
    ...asEntries(r.unobserved_domains_json),
    ...asEntries(r.uncertain_domains_json),
  ]
  const seen = new Set<string>()
  const result: ObservationEntry[] = []
  for (const e of all) {
    if (!(e.domain in DOMAIN_LABELS) || !(e.status in OBSERVATION_STATUS_LABELS)) continue
    const key = `${e.domain}:${e.status}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ domain: e.domain, label: DOMAIN_LABELS[e.domain], status: e.status, statusLabel: OBSERVATION_STATUS_LABELS[e.status] })
  }
  return result.sort((a, b) => DOMAIN_KEYS.indexOf(a.domain) - DOMAIN_KEYS.indexOf(b.domain))
}

/** 이 보고를 관리자가 왜 확인해야 하는지 — 저장된 필드에서만 뽑는다. 승인/반려가
 * 끝났거나 제출 전이면 빈 배열이다. 첫 항목은 항상 "검토 기록 없음"(목록에 오른 이유). */
export function reviewReasons(r: HubReport): ReviewReason[] {
  if (!isPendingReview(r)) return []
  const reasons: ReviewReason[] = [{ code: 'not_reviewed', label: '제출 후 승인·반려 기록 없음', tone: 'info' }]
  if (r.emergency_flagged) {
    reasons.push({ code: 'emergency_signal', label: '응급 표현 감지(규칙 기반 · 임상 판정 아님)', tone: 'alert' })
  }
  const obs = storedObservations(r)
  const changed = obs.filter((o) => o.status === 'changed').map((o) => o.label)
  if (changed.length > 0) reasons.push({ code: 'changed_items', label: `변화 보고 항목: ${changed.join('·')}`, tone: 'alert' })
  if (r.initial_status_choice === 'changed') {
    reasons.push({ code: 'choice_changed', label: '요양보호사가 "평소와 다른 점 있음"을 선택', tone: 'alert' })
  } else if (r.initial_status_choice === 'uncertain') {
    reasons.push({ code: 'choice_uncertain', label: '요양보호사가 "확인 필요"를 선택', tone: 'alert' })
  } else if (r.initial_status_choice === 'similar') {
    reasons.push({ code: 'choice_similar', label: '"평소와 비슷함" 보고 — 원문 확인 후 바로 검토 가능', tone: 'info' })
  }
  const unclear = obs.filter((o) => o.status === 'not_observed' || o.status === 'uncertain').map((o) => `${o.label}(${o.statusLabel})`)
  if (unclear.length > 0) reasons.push({ code: 'unclear_items', label: `확인 못한 항목: ${unclear.join('·')}`, tone: 'info' })
  const final = r.caregiver_final_report ?? r.ai_generated_report
  if (final?.caregiverNote && final.caregiverNote.trim()) {
    reasons.push({ code: 'caregiver_note', label: '요양보호사 본인 상황·지원 요청 포함(어르신 상태와 별개)', tone: 'alert' })
  }
  if (r.ai_fallback_used === true) {
    reasons.push({ code: 'ai_fallback', label: 'AI 정리 대체 처리됨 — 원문과 대조 필요', tone: 'info' })
  }
  if (r.no_information_report) reasons.push({ code: 'no_information', label: '관찰 정보가 없는 보고', tone: 'info' })
  return reasons
}

function excerptOf(r: HubReport, max = 80): { excerpt: string | null; excerptSource: ReviewQueueItem['excerptSource'] } {
  const cut = (t: string) => (t.length > max ? `${t.slice(0, max)}…` : t)
  const change = (r.caregiver_final_report?.change ?? '').trim()
  if (change) return { excerpt: cut(change), excerptSource: 'caregiver_final' }
  const raw = (r.raw_input ?? '').trim()
  if (raw) return { excerpt: cut(raw), excerptSource: 'raw_input' }
  return { excerpt: null, excerptSource: null }
}

/** 기관 첫 화면의 "검토할 보고" 목록. 정렬은 저장된 값만 쓴다: 응급 표현 감지 표시가
 * 있는 보고 먼저, 그 안에서는 제출이 오래된(오래 기다린) 순서. 위험도 점수가 아니다. */
export function buildReviewQueue(reports: HubReport[]): ReviewQueueItem[] {
  return reports
    .filter((r) => isLiveReport(r) && isPendingReview(r))
    .sort((a, b) => {
      const ea = a.emergency_flagged ? 0 : 1
      const eb = b.emergency_flagged ? 0 : 1
      if (ea !== eb) return ea - eb
      return (a.submitted_at ?? a.created_at ?? '').localeCompare(b.submitted_at ?? b.created_at ?? '')
    })
    .map((r) => ({
      reportId: r.id,
      recipientCode: r.recipient_code,
      participantCode: r.participant_code,
      reportType: r.report_type ?? 'daily',
      reportDate: r.report_date ?? '',
      submittedAt: r.submitted_at ?? null,
      emergencyFlagged: Boolean(r.emergency_flagged),
      reasons: reviewReasons(r),
      ...excerptOf(r),
    }))
}

export interface RecipientRow {
  code: string
  active: boolean
}
export interface AssignmentRow {
  caregiver_code: string
  recipient_code: string
  active: boolean
}

/** 수급자 목록. 검토 대기 보고가 있는 수급자를 먼저, 그다음 코드 순. */
export function summarizeRecipients(recipients: RecipientRow[], assignments: AssignmentRow[], reports: HubReport[]): RecipientSummary[] {
  const live = reports.filter(isLiveReport)
  const rows = recipients.map((rec): RecipientSummary => {
    const own = live.filter((r) => r.recipient_code === rec.code)
    const submitted = own
      .filter((r) => r.status === 'submitted')
      .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))
    const pending = submitted.filter(isPendingReview)
    const last = submitted[0]
    return {
      code: rec.code,
      active: rec.active,
      caregivers: assignments
        .filter((a) => a.recipient_code === rec.code && a.active)
        .map((a) => a.caregiver_code)
        .sort(),
      lastSubmitted: last
        ? { reportId: last.id, submittedAt: last.submitted_at ?? null, reportDate: last.report_date ?? '', participantCode: last.participant_code }
        : null,
      submittedCount: submitted.length,
      pendingReviewCount: pending.length,
      pendingEmergencyCount: pending.filter((r) => r.emergency_flagged).length,
      draftCount: own.filter((r) => r.status === 'draft').length,
    }
  })
  return rows.sort((a, b) => {
    const pa = a.pendingReviewCount > 0 ? 0 : 1
    const pb = b.pendingReviewCount > 0 ? 0 : 1
    if (pa !== pb) return pa - pb
    return a.code.localeCompare(b.code)
  })
}

/** 'YYYY-MM-DD'(KST 보고일)에서 n일을 뺀 날짜. 달력 계산만 하므로 UTC로 처리해도 같다. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function periodSince(period: TimelinePeriod, today: string): string | null {
  if (period === 'all') return null
  return shiftDate(today, -(Number(period) - 1))
}

function toTimelineEntry(raw: HubReport): TimelineEntry {
  const r = normalizeReportRecord(raw as CareReportRecord)
  return {
    reportId: r.id,
    reportType: r.report_type,
    reportDate: r.report_date,
    submittedAt: r.submitted_at,
    author: { role: 'caregiver', code: r.participant_code },
    raw: {
      text: r.raw_input ?? '',
      // 실제로 오간 질문·답변만 — 답이 빈 항목은 "물어봤지만 답 없음"으로 그대로 둔다.
      followups: Array.isArray(r.followup_answers) ? r.followup_answers : [],
    },
    structured: {
      aiDraft: r.ai_generated_report,
      caregiverFinal: r.caregiver_final_report,
      aiFallbackUsed: r.ai_fallback_used ?? null,
      ruleBasedByDesign: r.initial_status_choice === 'similar',
      caregiverEdited: r.ai_generated_report && r.caregiver_final_report ? !sameText(r.ai_generated_report, r.caregiver_final_report) : null,
    },
    review: {
      status: r.review_status,
      reviewedAt: r.reviewed_at,
      firstViewedAt: r.admin_first_viewed_at,
      adminFinal: r.admin_final_report,
      note: r.review_note,
      noteVisibleToCaregiver: r.review_note_visible_to_caregiver,
      historyCount: r.review_history.length,
    },
    observations: storedObservations(r),
    initialStatusChoice: r.initial_status_choice ?? null,
    noInformationReport: Boolean(r.no_information_report),
    emergencyFlagged: Boolean(r.emergency_flagged),
    reviewReasons: reviewReasons(r),
  }
}

/** 한 수급자의 보고 이력(최신 제출이 위). 호출부가 이미 이 수급자의 보고만 넘긴다.
 * 기간은 보고일(report_date, KST) 기준이다 — 관찰 시각은 따로 저장되지 않는다.
 * 제출 전 임시저장은 검토 대상이 아니므로 이력에 섞지 않고 따로 요약한다. */
export function buildRecipientTimeline(reports: HubReport[], period: TimelinePeriod, today: string): RecipientTimeline {
  const since = periodSince(period, today)
  const inPeriod = reports.filter((r) => isLiveReport(r) && (!since || (r.report_date ?? '') >= since))
  const entries = inPeriod
    .filter((r) => r.status === 'submitted')
    .sort((a, b) => (b.submitted_at ?? b.created_at ?? '').localeCompare(a.submitted_at ?? a.created_at ?? ''))
    .map(toTimelineEntry)
  const drafts = inPeriod
    .filter((r) => r.status === 'draft')
    .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))
    .map((r) => ({ reportId: r.id, startedAt: r.started_at ?? r.created_at ?? '', participantCode: r.participant_code, emergencyFlagged: Boolean(r.emergency_flagged) }))
  return { period, since, today, entries, drafts }
}
