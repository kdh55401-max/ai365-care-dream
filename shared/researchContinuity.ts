import { DOMAIN_LABELS, type DomainKey, type DomainStatus } from './careTypes.js'

/**
 * 연구용 MVP 핵심 규칙(관찰 → 보고 → 확인질문 → 사람 확정 → 관리자 → 다음 방문).
 * 서버·화면·합성 데모가 같이 쓰는 순수 함수만 둔다. AI 호출이 없어도 항상 동작한다
 * (규칙 기반 Observer). 진단·처치 지시는 만들지 않는다.
 */

/** 보고 내용의 출처. 기본값을 두지 않는다 — 모르면 undefined로 남긴다. */
export type EvidenceSource = 'direct_observation' | 'self_report' | 'family_report'

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSource, string> = {
  direct_observation: '직접 관찰',
  self_report: '어르신 본인 진술',
  family_report: '가족 진술',
}

/** 질문에 대한 응답 상태. 관찰 상태(DomainStatus)와 별개 축이다. */
export type AnswerState = 'answered' | 'skipped' | 'no_response'

/** 날짜가 붙은 기록 한 줄. 과거 기록과 오늘 기록 모두 이 모양이다. */
export interface DomainObservation {
  /** 같은 사건을 이어 붙이는 id */
  eventId: string
  domain: DomainKey
  status: DomainStatus
  /** 관찰이 일어난 날(YYYY-MM-DD) */
  observedOn: string
  source?: EvidenceSource
}

export interface ObserverQuestion {
  key: string
  eventId: string
  domain: DomainKey
  text: string
  /** 참고로 보여줄 과거 기록의 날짜·출처 */
  refDate: string
  refSource?: EvidenceSource
}

const PRIORITY: Partial<Record<DomainStatus, number>> = { changed: 0, uncertain: 1, not_observed: 2 }

/**
 * 이전 방문에서 아직 오늘 답이 없는 항목을 골라 중립 질문 1~3개를 만든다.
 * - 오늘 이미 같은 영역을 다룬 경우(언급 없음 제외)는 묻지 않는다.
 * - 이미 물어본 질문(askedKeys)은 반복하지 않는다.
 */
export function buildObserverQuestions(input: {
  today: string
  prior: DomainObservation[]
  todayEntries: DomainObservation[]
  askedKeys?: string[]
  max?: number
}): ObserverQuestion[] {
  const max = Math.min(3, Math.max(1, input.max ?? 3))
  const asked = new Set(input.askedKeys ?? [])
  const coveredToday = new Set(
    input.todayEntries.filter((e) => e.status !== 'not_mentioned').map((e) => e.domain),
  )
  // 영역마다 가장 최근의 과거 기록만 본다. 오늘 날짜 기록은 과거가 아니다.
  const latest = new Map<DomainKey, DomainObservation>()
  for (const p of input.prior) {
    if (p.observedOn >= input.today) continue
    const cur = latest.get(p.domain)
    if (!cur || p.observedOn > cur.observedOn) latest.set(p.domain, p)
  }
  return [...latest.values()]
    .filter((p) => PRIORITY[p.status] !== undefined && !coveredToday.has(p.domain))
    .map((p) => ({ p, key: `${p.eventId}:${p.domain}` }))
    .filter(({ key }) => !asked.has(key))
    .sort((a, b) => PRIORITY[a.p.status]! - PRIORITY[b.p.status]! || b.p.observedOn.localeCompare(a.p.observedOn))
    .slice(0, max)
    .map(({ p, key }) => ({
      key,
      eventId: p.eventId,
      domain: p.domain,
      text: `${p.observedOn}에 ${DOMAIN_LABELS[p.domain]} 관련 기록이 있었어요. 오늘은 ${DOMAIN_LABELS[p.domain]}을(를) 직접 보셨나요? 못 보셨으면 그대로 알려 주세요.`,
      refDate: p.observedOn,
      refSource: p.source,
    }))
}

/** 질문 하나에 대한 답을 오늘 기록으로 바꾼다. 건너뜀·무응답은 관찰 상태를 만들지 않는다. */
export function applyAnswer(
  q: ObserverQuestion,
  answer: { state: AnswerState; status?: DomainStatus; source?: EvidenceSource },
  today: string,
): { observation: DomainObservation | null; answerState: AnswerState } {
  if (answer.state !== 'answered' || !answer.status) {
    return { observation: null, answerState: answer.state === 'answered' ? 'no_response' : answer.state }
  }
  return {
    observation: {
      eventId: q.eventId,
      domain: q.domain,
      status: answer.status,
      observedOn: today,
      source: answer.source,
    },
    answerState: 'answered',
  }
}

export type DraftStatus = 'draft' | 'edited' | 'confirmed'

export interface CareDraft {
  /** 오늘 관찰한 사실만 */
  today: DomainObservation[]
  /** 날짜가 다른 과거 참고자료. 오늘 사실로 옮기지 않는다. */
  pastReference: DomainObservation[]
  status: DraftStatus
  updatedAt: string
  /** 사람이 확정한 뒤에만 true */
  sharedWithAdmin: boolean
}

export function composeDraft(input: {
  today: string
  todayEntries: DomainObservation[]
  prior: DomainObservation[]
  now: string
}): CareDraft {
  return {
    today: input.todayEntries.filter((e) => e.observedOn === input.today),
    pastReference: input.prior.filter((p) => p.observedOn < input.today),
    status: 'draft',
    updatedAt: input.now,
    sharedWithAdmin: false,
  }
}

/** 요양보호사가 오늘 항목을 고친다. 과거 참고자료는 고칠 수 없고, 수정 시각이 남는다. */
export function editDraft(d: CareDraft, today: DomainObservation[], now: string): CareDraft {
  if (d.status === 'confirmed') return d
  return { ...d, today, status: 'edited', updatedAt: now, sharedWithAdmin: false }
}

export function confirmDraft(d: CareDraft, now: string): CareDraft {
  return { ...d, status: 'confirmed', updatedAt: now, sharedWithAdmin: true }
}

export type EventStepType =
  | 'reported'
  | 'confirmed'
  | 'admin_viewed'
  | 'admin_requested_followup'
  | 'followup_observed'
  | 'followup_unverifiable'

export interface EventStep {
  type: EventStepType
  at: string
  /** followup_unverifiable 일 때 확인하지 못한 사유 */
  reason?: string
}

export type EventState = 'unconfirmed' | 'confirmed' | 'awaiting_followup' | 'closed_observed' | 'closed_unverifiable'

/**
 * 사건 하나의 진행 상태. 관리자의 열람(admin_viewed)은 상태를 바꾸지 않는다.
 * 다음 방문의 실제 관찰 또는 확인 불가 사유가 있어야 닫힌다.
 */
export function eventState(steps: EventStep[]): EventState {
  let state: EventState = 'unconfirmed'
  for (const s of steps) {
    if (s.type === 'confirmed' && state === 'unconfirmed') state = 'confirmed'
    else if (s.type === 'admin_requested_followup' && (state === 'confirmed' || state === 'awaiting_followup')) state = 'awaiting_followup'
    else if (s.type === 'followup_observed' && state === 'awaiting_followup') state = 'closed_observed'
    else if (s.type === 'followup_unverifiable' && state === 'awaiting_followup' && s.reason?.trim()) state = 'closed_unverifiable'
  }
  return state
}

/** 방문 기록에서 서로 다른 참여자 수. 같은 사람이 여러 번 방문해도 늘지 않는다. */
export function countParticipants(visits: Array<{ pseudonymId: string }>): number {
  return new Set(visits.map((v) => v.pseudonymId)).size
}
