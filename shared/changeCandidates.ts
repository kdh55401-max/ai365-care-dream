/** 돌봄 연속성 5단계 — 반복 보고 후보와 비교 가능한 값 차이. 서버·데모 공통 규칙.
 *
 * 반복 보고 후보(초기 운영 규칙 repeat_changed v1):
 *   같은 수급자·같은 세부 영역에 "변화(changed)"가 저장된 보고가 기준일 포함 최근 7일 중 서로 다른 날 2일 이상.
 *   같은 날 여러 보고는 하루로 센다. 세부 영역끼리·수급자끼리 섞지 않는다.
 *   표시는 "식사 변화가 2일 보고됨" — 증상 지속·악화로 단정하지 않는다(보고자 진술의 반복일 뿐).
 *   관찰일이 저장되지 않아 날짜는 보고일(한국 시간) 기준이다. 관찰일 기준 계산과 섞지 않고, 관찰일 기준은
 *   "관찰일이 기록된 보고 없음 — 계산 대상 0, 제외 N"으로 따로 알린다. 반려된 보고는 신호에서 뺀다.
 *   후보의 정체(key)는 규칙·버전·기준·수급자·세부 영역·에피소드 시작일로 정해 매번 새로 만들지 않는다
 *   (에피소드 = 변화 보고일 사이 간격이 7일 미만으로 이어진 묶음).
 *
 * 값 비교(scale_value_diff v1):
 *   관리자 확인된 현재 버전의 정식 척도 결과끼리, 도구명·버전·단위가 같고 측정일이 다르며 값이 다를 때만.
 *   계획·목표, 관리자 메모, 초안·철회·이전 버전, 측정일 없음, 같은 날 상충 값, 측정 맥락이 기록되지 않은 일반 관찰 수치는
 *   비교하지 않는다. 수치 차이를 악화·호전으로 해석하지 않는다.
 *
 * 후보와 관리자 판단은 분리한다 — 판단은 따로 쌓이고(수정·삭제 없음) 기존 조치에 선택적으로 연결된다. */
import { DOMAIN_LABELS, type CareReportRecord, type DomainKey } from './careTypes.js'
import { storedObservations } from './recipientHub.js'
import { calendarReports, shiftDate } from './observationCalendar.js'
import { isEffective, type BaselineEntry } from './baseline.js'
import { ADMIN_ACTOR_SCOPE, WorkflowError, type CareAction, type WorkflowContext } from './workflow.js'

export const REPEAT_RULE = {
  id: 'repeat_changed',
  version: 1,
  windowDays: 7,
  minDistinctDays: 2,
  label: '최근 7일(기준일 포함) 중 서로 다른 날 2일 이상, 같은 수급자·같은 세부 영역에 변화 보고',
} as const

export const VALUE_RULE = {
  id: 'scale_value_diff',
  version: 1,
  label: '같은 도구·버전·단위의 관리자 확인 정식 척도 값이 측정일에 따라 다름',
} as const

export type CandidateKind = 'repeat_changed' | 'scale_value_diff'

type SigReport = Partial<CareReportRecord> & Pick<CareReportRecord, 'id' | 'recipient_code' | 'participant_code' | 'status'>

export interface ChangeSignal {
  reportId: string
  recipientCode: string
  domain: DomainKey
  /** 보고일(한국 시간) — 관찰일이 아니다. */
  date: string
  submittedAt: string | null
  participantCode: string
}

export interface RepeatCandidate {
  key: string
  kind: 'repeat_changed'
  ruleId: string
  ruleVersion: number
  basis: 'report_date'
  recipientCode: string
  domain: DomainKey
  domainLabel: string
  /** 창 안에서 변화가 보고된 서로 다른 날(오름차순). */
  days: string[]
  signals: ChangeSignal[]
  episodeStart: string
  windowStart: string
  windowEnd: string
  headline: string
}

export interface RepeatResult {
  rule: typeof REPEAT_RULE
  basis: 'report_date'
  windowStart: string
  windowEnd: string
  candidates: RepeatCandidate[]
  /** 창 안의 변화 신호(보고·항목 단위) 수와 변화가 보고된 서로 다른 수급자 수 — 후보 수와 구분. */
  signalsInWindow: number
  changedRecipients: number
  /** 관찰일 기준 계산: 관찰일이 저장되지 않아 계산 대상이 없다(보고일 기준과 섞지 않음). */
  observationDateBasis: { available: false; excludedSignals: number }
  /** 반려된 보고라서 신호에서 뺀 수. */
  excludedRejected: number
}

export function repeatHeadline(domain: DomainKey, days: number): string {
  return `${DOMAIN_LABELS[domain]} 변화가 ${days}일 보고됨`
}

/** 변화 신호. 반려된 보고의 신호는 따로 돌려준다 — 날 수에는 넣지 않지만 후보의 정체(에피소드 시작일)는
 * 흔들지 않게 한다(반려 뒤에도 같은 후보에 판단이 남아 "재검토 필요"로 보이게). */
export function changeSignals(reports: SigReport[]): { signals: ChangeSignal[]; rejectedSignals: ChangeSignal[]; rejected: number } {
  const signals: ChangeSignal[] = []
  const rejectedSignals: ChangeSignal[] = []
  for (const r of calendarReports(reports)) {
    const changed = storedObservations(r).filter((o) => o.status === 'changed')
    const target = (r.review_status ?? 'pending') === 'rejected' ? rejectedSignals : signals
    for (const o of changed) {
      target.push({ reportId: r.id, recipientCode: r.recipient_code, domain: o.domain, date: r.report_date as string, submittedAt: r.submitted_at ?? null, participantCode: r.participant_code })
    }
  }
  return { signals, rejectedSignals, rejected: rejectedSignals.length }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** 이 날짜가 속한 에피소드의 시작일(간격이 창 길이 미만으로 이어진 변화 보고일 묶음의 첫날). */
function episodeStartOf(allDates: string[], last: string): string {
  const sorted = [...new Set(allDates)].filter((d) => d <= last).sort()
  let start = sorted[sorted.length - 1] ?? last
  for (let i = sorted.length - 1; i > 0; i--) {
    if (daysBetween(sorted[i - 1], sorted[i]) < REPEAT_RULE.windowDays) start = sorted[i - 1]
    else break
  }
  return start
}

export function repeatKey(recipientCode: string, domain: DomainKey, episodeStart: string): string {
  return `${REPEAT_RULE.id}@v${REPEAT_RULE.version}|report_date|${recipientCode}|${domain}|${episodeStart}`
}

export function computeRepeatCandidates(reports: SigReport[], today: string): RepeatResult {
  const windowStart = shiftDate(today, -(REPEAT_RULE.windowDays - 1))
  const { signals, rejectedSignals, rejected } = changeSignals(reports)
  const identityDates = new Map<string, string[]>()
  for (const s of [...signals, ...rejectedSignals].filter((x) => x.date <= today)) {
    const k = `${s.recipientCode}|${s.domain}`
    identityDates.set(k, [...(identityDates.get(k) ?? []), s.date])
  }
  const past = signals.filter((s) => s.date <= today)
  const inWindow = past.filter((s) => s.date >= windowStart)
  const groups = new Map<string, ChangeSignal[]>()
  for (const s of past) {
    const k = `${s.recipientCode}|${s.domain}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  const candidates: RepeatCandidate[] = []
  for (const list of groups.values()) {
    const windowSignals = list.filter((s) => s.date >= windowStart).sort((a, b) => a.date.localeCompare(b.date) || (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
    const days = [...new Set(windowSignals.map((s) => s.date))].sort()
    if (days.length < REPEAT_RULE.minDistinctDays) continue
    const { recipientCode, domain } = windowSignals[0]
    const episodeStart = episodeStartOf(identityDates.get(`${recipientCode}|${domain}`) ?? list.map((s) => s.date), days[days.length - 1])
    candidates.push({
      key: repeatKey(recipientCode, domain, episodeStart),
      kind: 'repeat_changed',
      ruleId: REPEAT_RULE.id,
      ruleVersion: REPEAT_RULE.version,
      basis: 'report_date',
      recipientCode,
      domain,
      domainLabel: DOMAIN_LABELS[domain],
      days,
      signals: windowSignals,
      episodeStart,
      windowStart,
      windowEnd: today,
      headline: repeatHeadline(domain, days.length),
    })
  }
  candidates.sort((a, b) => a.recipientCode.localeCompare(b.recipientCode) || DOMAIN_KEYS_ORDER(a.domain) - DOMAIN_KEYS_ORDER(b.domain))
  return {
    rule: REPEAT_RULE,
    basis: 'report_date',
    windowStart,
    windowEnd: today,
    candidates,
    signalsInWindow: inWindow.length,
    changedRecipients: new Set(inWindow.map((s) => s.recipientCode)).size,
    observationDateBasis: { available: false, excludedSignals: inWindow.length },
    excludedRejected: rejected,
  }
}

function DOMAIN_KEYS_ORDER(d: DomainKey): number {
  return Object.keys(DOMAIN_LABELS).indexOf(d)
}

// ── 값 비교(정식 척도만) ─────────────────────────────────────────────
export interface ValueComparison {
  key: string
  kind: 'scale_value_diff'
  ruleId: string
  ruleVersion: number
  recipientCode: string
  toolName: string
  toolVersion: string
  unit: string
  domain: DomainKey | null
  earlier: BaselineEntry
  later: BaselineEntry
  /** 두 값이 모두 숫자일 때만(나중 − 이전). 범주 값은 null. */
  difference: number | null
  headline: string
}

export interface ValueComparisonResult {
  rule: typeof VALUE_RULE
  comparisons: ValueComparison[]
  /** 비교하지 않은 이유별 건수(투명성). */
  excluded: Array<{ reason: string; count: number }>
}

function valueOf(e: BaselineEntry): string {
  return e.value_numeric !== null && e.value_numeric !== undefined ? String(Number(e.value_numeric)) : (e.value_text ?? '').trim()
}

export function valueKey(recipientCode: string, earlierId: string, laterId: string): string {
  return `${VALUE_RULE.id}@v${VALUE_RULE.version}|${recipientCode}|${earlierId}|${laterId}`
}

export function compareScaleValues(entries: BaselineEntry[]): ValueComparisonResult {
  const excluded = new Map<string, number>()
  const skip = (reason: string) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1)
  const usable: BaselineEntry[] = []
  for (const e of entries) {
    if (e.kind === 'plan_goal') skip('계획·목표 — 관찰값과 비교하지 않음')
    else if (e.kind === 'admin_note') skip('관리자 메모 — 비교하지 않음')
    else if (!isEffective(e)) skip('초안·철회·이전 버전 — 비교하지 않음')
    else if (e.kind === 'observation_assessment') {
      if (e.value_numeric !== null && e.value_numeric !== undefined) skip('관찰·평가 수치 — 측정 맥락이 기록되지 않아 비교하지 않음')
    } else if (e.kind === 'scale_result') {
      if (!e.reference_date) skip('측정일 없음 — 비교하지 않음')
      else usable.push(e)
    }
  }
  const groups = new Map<string, BaselineEntry[]>()
  for (const e of usable) {
    const k = `${e.recipient_code}|${(e.tool_name ?? '').trim().toLowerCase()}|${(e.tool_version ?? '').trim()}|${(e.unit ?? '').trim().toLowerCase()}`
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  const comparisons: ValueComparison[] = []
  for (const list of groups.values()) {
    const byDate = new Map<string, BaselineEntry[]>()
    for (const e of list) byDate.set(e.reference_date as string, [...(byDate.get(e.reference_date as string) ?? []), e])
    const points: BaselineEntry[] = []
    for (const [, same] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (new Set(same.map(valueOf)).size > 1) {
        skip('같은 측정일에 값이 상충 — 비교하지 않음')
        continue
      }
      points.push(same[0])
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      if (valueOf(a) === valueOf(b)) continue // 같은 값이면 후보를 만들지 않는다
      const numeric = a.value_numeric !== null && a.value_numeric !== undefined && b.value_numeric !== null && b.value_numeric !== undefined
      const difference = numeric ? Number(b.value_numeric) - Number(a.value_numeric) : null
      comparisons.push({
        key: valueKey(a.recipient_code, a.id, b.id),
        kind: 'scale_value_diff',
        ruleId: VALUE_RULE.id,
        ruleVersion: VALUE_RULE.version,
        recipientCode: a.recipient_code,
        toolName: a.tool_name as string,
        toolVersion: a.tool_version as string,
        unit: a.unit as string,
        domain: a.domain,
        earlier: a,
        later: b,
        difference,
        headline: `${a.tool_name} ${a.tool_version}: ${valueOf(a)}${a.unit} (${a.reference_date}) → ${valueOf(b)}${b.unit} (${b.reference_date})`,
      })
    }
  }
  return { rule: VALUE_RULE, comparisons, excluded: [...excluded.entries()].map(([reason, count]) => ({ reason, count })) }
}

// ── 관리자 판단(후보와 분리) ───────────────────────────────────────────
export const CANDIDATE_DECISIONS = ['change_confirmed', 'within_usual', 'needs_check', 'not_comparable'] as const
export type CandidateDecision = (typeof CANDIDATE_DECISIONS)[number]
export const CANDIDATE_DECISION_LABELS: Record<CandidateDecision, string> = {
  change_confirmed: '변화 확인',
  within_usual: '평소 범위',
  needs_check: '추가 확인 필요',
  not_comparable: '비교 부적절',
}

export interface CandidateReview {
  id: string
  organization_id: string
  candidate_key: string
  candidate_kind: CandidateKind
  rule_id: string
  rule_version: number
  basis: string | null
  recipient_code: string
  domain: string | null
  /** 판단 당시 근거 스냅샷(보고 id·날짜 또는 기준정보 id·버전). */
  evidence: { reportIds?: string[]; days?: string[]; entryIds?: string[]; entryVersions?: number[] }
  decision: CandidateDecision
  reason: string
  linked_action_id: string | null
  reviewed_at: string
  actor_scope: string
  entered_by_label: string | null
  request_id: string
}

export type ReviewableCandidate = RepeatCandidate | ValueComparison

export interface CandidateReviewInput {
  candidateKey: string
  decision: CandidateDecision
  reason: string
  linkedActionId?: string | null
  enteredByLabel?: string | null
  requestId: string
}

export function evidenceOf(c: ReviewableCandidate): CandidateReview['evidence'] {
  return c.kind === 'repeat_changed'
    ? { reportIds: [...new Set(c.signals.map((s) => s.reportId))], days: c.days }
    : { entryIds: [c.earlier.id, c.later.id], entryVersions: [c.earlier.version, c.later.version] }
}

export function planCandidateReview(c: ReviewableCandidate, input: CandidateReviewInput, linkedAction: CareAction | null, ctx: WorkflowContext): CandidateReview {
  if (!(CANDIDATE_DECISIONS as readonly string[]).includes(input.decision)) throw new WorkflowError(400, '판단을 선택해 주세요.')
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : ''
  if (!reason) throw new WorkflowError(400, '판단 근거를 입력해 주세요(어떤 보고·값을 보고 판단했는지).')
  if (input.linkedActionId) {
    if (!linkedAction || linkedAction.id !== input.linkedActionId) throw new WorkflowError(404, '연결할 조치를 찾을 수 없습니다.')
    if (linkedAction.recipient_code !== c.recipientCode) throw new WorkflowError(400, '다른 수급자의 조치에는 연결할 수 없습니다.')
    if (linkedAction.status !== 'draft' && linkedAction.status !== 'open') throw new WorkflowError(409, '초안·진행 중인 조치에만 연결합니다.')
  }
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim().slice(0, 200) : ''
  if (!requestId) throw new WorkflowError(400, '요청 식별자가 없습니다.')
  return {
    id: ctx.newId(),
    organization_id: ctx.organizationId,
    candidate_key: c.key,
    candidate_kind: c.kind,
    rule_id: c.ruleId,
    rule_version: c.ruleVersion,
    basis: c.kind === 'repeat_changed' ? c.basis : null,
    recipient_code: c.recipientCode,
    domain: c.domain,
    evidence: evidenceOf(c),
    decision: input.decision,
    reason,
    linked_action_id: input.linkedActionId ?? null,
    reviewed_at: ctx.now,
    actor_scope: ADMIN_ACTOR_SCOPE,
    entered_by_label: typeof input.enteredByLabel === 'string' ? input.enteredByLabel.trim().slice(0, 100) || null : null,
    request_id: requestId,
  }
}

export interface CandidateReviewState {
  latest: CandidateReview | null
  history: CandidateReview[]
  /** 판단 뒤 새로 들어온 근거 보고 수(자동으로 판단을 바꾸지 않는다). */
  newEvidenceSinceReview: number
  /** 판단 당시 근거가 반려·삭제·변경돼 다시 볼 필요가 있는 이유. */
  recheckReasons: string[]
}

/** 후보(또는 더 이상 조건을 채우지 않는 과거 판단)의 판단 상태. liveReports는 삭제·연습을 뺀 현재 보고, entries는 현재 기준정보. */
export function reviewStateOf(
  key: string,
  current: ReviewableCandidate | null,
  reviews: CandidateReview[],
  liveReports: Array<{ id: string; review_status?: string | null }>,
  entries: Array<Pick<BaselineEntry, 'id' | 'status' | 'superseded_at'>> = [],
): CandidateReviewState {
  const history = reviews.filter((r) => r.candidate_key === key).sort((a, b) => Date.parse(a.reviewed_at) - Date.parse(b.reviewed_at))
  const latest = history[history.length - 1] ?? null
  const recheckReasons: string[] = []
  let newEvidenceSinceReview = 0
  if (latest) {
    const reportById = new Map(liveReports.map((r) => [r.id, r]))
    for (const id of latest.evidence.reportIds ?? []) {
      const r = reportById.get(id)
      if (!r) recheckReasons.push('판단 당시 근거 보고가 지금 없음(삭제 등)')
      else if (r.review_status === 'rejected') recheckReasons.push('판단 당시 근거 보고가 반려됨')
    }
    const entryById = new Map(entries.map((e) => [e.id, e]))
    for (const id of latest.evidence.entryIds ?? []) {
      const e = entryById.get(id)
      if (!e || e.status === 'retracted') recheckReasons.push('판단 당시 기준정보가 철회됨')
      else if (e.superseded_at) recheckReasons.push('판단 당시 기준정보가 새 버전으로 바뀜')
    }
    if (current && current.kind === 'repeat_changed') {
      const seen = new Set(latest.evidence.reportIds ?? [])
      newEvidenceSinceReview = new Set(current.signals.map((s) => s.reportId).filter((id) => !seen.has(id))).size
    }
  }
  return { latest, history, newEvidenceSinceReview, recheckReasons: [...new Set(recheckReasons)] }
}
