/** 직원(담당 요양보호사) 변경 상담일지 — 공통 규칙. 서버(api/admin/participants.ts)·데모 저장소·화면이 같은 함수를 쓴다.
 * 실제 저장의 원자성·잠금은 DB 함수(db/migrations/2026-10-03-staff-change-notes.sql)가 맡고, 여기 검증은 같은 규칙을 입력 단계에서
 * 먼저 알려 주는 용도다.
 *
 * 초안에 채우는 것은 시스템이 아는 사실(변경일·전/후 담당·기한)뿐이다. 변경 사유·안내 내용·수급자(보호자)의 동의 여부는
 * 사람이 확인한 내용만 들어가야 하므로 비워 둔다 — 동의를 받지 않았는데 받은 것처럼 적힌 일지를 만들지 않는다. */

/** 이지케어 도움말 "직원변경 상담일지 작성 방법"의 기준(변경 사실과 사유를 14일 이내에 기록). 공식 고시 문구는 확인하지 못했다. */
export const STAFF_NOTE_DEADLINE_DAYS = 14
/** 기한이 이 일수 이하로 남으면 "곧 기한"으로 표시한다. */
export const STAFF_NOTE_DUE_SOON_DAYS = 3
export const REASON_MAX = 500
export const CONTENT_MAX = 2000
export const RELATION_MAX = 30

export type CounselMethod = 'visit' | 'phone' | 'other'
export const COUNSEL_METHOD_LABEL: Record<CounselMethod, string> = { visit: '방문', phone: '전화', other: '기타' }
export const COUNSEL_METHODS = Object.keys(COUNSEL_METHOD_LABEL) as CounselMethod[]

/** 수급자(보호자)의 동의 여부. 글이 아니라 선택으로만 받는다 — AI가 동의했는지를 추측하지 않게 하는 핵심 장치다. */
export type ConsentChoice = 'agreed' | 'agreed_with_opinion' | 'not_agreed' | 'not_reached'
export const CONSENT_LABEL: Record<ConsentChoice, string> = {
  agreed: '동의함',
  agreed_with_opinion: '동의함(의견 있음)',
  not_agreed: '동의하지 않음',
  not_reached: '아직 안내하지 못함',
}
export const CONSENT_CHOICES = Object.keys(CONSENT_LABEL) as ConsentChoice[]

export const REASON_CHOICES = [
  { id: 'schedule', label: '근무시간 조정' },
  { id: 'caregiver_personal', label: '요양보호사 개인 사정' },
  { id: 'recipient_request', label: '수급자(보호자) 요청' },
  { id: 'agency', label: '기관 사정' },
  { id: 'other', label: '기타(직접 입력)' },
] as const
export type ReasonChoiceId = (typeof REASON_CHOICES)[number]['id']

/** 상담 대상자(관계) 빠른 선택. 목록에 없으면 직접 입력한다. */
export const RELATION_CHOICES = ['본인', '보호자(자녀)', '보호자(배우자)', '보호자(기타)'] as const

export const MEMO_MAX = 200

export type StaffNoteStatus = 'draft' | 'confirmed'
/** missing = 아직 일지를 시작하지 않음 · draft = 작성 중 · confirmed = 관리자 확정(이후 수정 불가) */
export type StaffNoteState = 'missing' | 'draft' | 'confirmed'
export type StaffNoteDue = 'done' | 'overdue' | 'due_soon' | 'ok'

export interface StaffNoteFields {
  changedOn: string
  reason: string
  counselMethod: CounselMethod | null
  /** 의견·동의 여부(선택). 확정하려면 반드시 골라야 한다. */
  consent: ConsentChoice | null
  /** 상담 대상자와 수급자의 관계(예: 보호자·자녀, 본인). 실명은 적지 않는다. */
  counseleeRelation: string
  /** 안내한 내용과 수급자(보호자)의 의견·동의 여부. */
  content: string
}

export interface StaffNoteRecord extends StaffNoteFields {
  status: StaffNoteStatus
  confirmedAt: string | null
  /** 수정 충돌 검사용(서버 값 그대로 되돌려 보낸다). */
  updatedAt: string
}

export interface StaffNoteItem {
  /** 담당 변경 이력(recipient_admin_log)의 번호. 일지는 이 변경 하나에 하나만 붙는다. */
  changeLogId: number
  recipientCode: string
  displayName: string | null
  /** 변경 전 담당(해제된 사람) / 변경 후 담당(새로 맡은 사람). 후임이 없으면 비어 있다. */
  fromCaregivers: string[]
  toCaregivers: string[]
  /** 변경 이력이 저장된 시각(ISO). */
  changedAt: string
  /** 일지 기본 변경일(한국시간 날짜). 일지가 있으면 그 값이 실제 변경일이다. */
  defaultChangedOn: string
  note: StaffNoteRecord | null
}

export interface StaffNoteView {
  /** false면 DB 마이그레이션이 아직 적용되지 않았다 — 목록 대신 안내만 보인다. */
  ready: boolean
  items: StaffNoteItem[]
}

export interface SaveStaffNoteInput extends StaffNoteFields {
  changeLogId: number
  /** true면 확정(이후 수정 불가), false면 초안 저장. */
  confirm: boolean
  /** 일지가 이미 있을 때 읽은 시점의 서버 값(충돌 검사). 처음 저장이면 비운다. */
  expectedUpdatedAt?: string
}

export interface SaveStaffNoteResult {
  changeLogId: number
  status: StaffNoteStatus
  updatedAt: string
}

/** ISO 시각 → 한국시간 날짜(YYYY-MM-DD). */
export function kstDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function dayDiff(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000)
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export function noteState(item: Pick<StaffNoteItem, 'note'>): StaffNoteState {
  return item.note ? item.note.status : 'missing'
}

/** 기한(변경일 + 14일)과 오늘 기준 상태. 확정된 일지는 기한과 무관하게 done. 기한 당일은 아직 기한 내다. */
export function dueOf(item: Pick<StaffNoteItem, 'note' | 'defaultChangedOn'>, today: string): { deadline: string; daysLeft: number; due: StaffNoteDue } {
  const changedOn = item.note?.changedOn ?? item.defaultChangedOn
  const deadline = addDays(changedOn, STAFF_NOTE_DEADLINE_DAYS)
  const daysLeft = dayDiff(today, deadline)
  if (item.note?.status === 'confirmed') return { deadline, daysLeft, due: 'done' }
  if (daysLeft < 0) return { deadline, daysLeft, due: 'overdue' }
  return { deadline, daysLeft, due: daysLeft <= STAFF_NOTE_DUE_SOON_DAYS ? 'due_soon' : 'ok' }
}

/** 시스템이 아는 사실만으로 만든 한 문장. 일지 맨 위에 보여 주며, 사유·동의는 포함하지 않는다. */
export function changeFactSentence(item: Pick<StaffNoteItem, 'recipientCode' | 'fromCaregivers' | 'toCaregivers'>, changedOn: string): string {
  const from = item.fromCaregivers.join(', ')
  const to = item.toCaregivers.join(', ')
  const base = `${changedOn} ${item.recipientCode} 어르신의 담당 요양보호사가 `
  if (!to) return `${base}${from}에서 해제되었습니다(새 담당자는 아직 배정되지 않았습니다).`
  return `${base}${from}에서 ${to}(으)로 변경되었습니다.`
}

/** 일지 입력 검사. 문제가 없으면 null, 있으면 사용자에게 보일 문장. 확정(confirm)은 필수 항목을 모두 요구한다. */
export function validateStaffNote(input: StaffNoteFields & { confirm: boolean }, today: string): string | null {
  if (!isValidDate(input.changedOn)) return '변경일자를 날짜로 입력해 주세요.'
  if (input.changedOn > today) return '변경일자는 오늘보다 뒤일 수 없습니다.'
  if (input.reason.length > REASON_MAX) return `변경 사유는 ${REASON_MAX}자 이내로 입력해 주세요.`
  if (input.content.length > CONTENT_MAX) return `상담 내용은 ${CONTENT_MAX}자 이내로 입력해 주세요.`
  if (input.counseleeRelation.length > RELATION_MAX) return `상담 대상자(관계)는 ${RELATION_MAX}자 이내로 입력해 주세요.`
  if (/\d{6}-?[1-4]\d{6}/.test(input.counseleeRelation) || (input.counseleeRelation.match(/\d/g) ?? []).length >= 7) {
    return '상담 대상자에는 실명·전화번호 대신 관계(예: 보호자·자녀)만 적어 주세요.'
  }
  if (!input.confirm) return null
  if (!input.reason.trim()) return '확정하려면 변경 사유를 입력해 주세요.'
  if (!input.counselMethod) return '확정하려면 상담 방법을 선택해 주세요.'
  if (!input.counseleeRelation.trim()) return '확정하려면 상담 대상자(관계)를 입력해 주세요.'
  if (!input.consent) return '확정하려면 수급자(보호자)의 의견·동의 여부를 선택해 주세요.'
  if (!input.content.trim()) return '확정하려면 안내한 내용과 수급자(보호자)의 의견·동의 여부를 입력해 주세요.'
  return null
}

/** 정렬: 기한 지남 → 곧 기한 → 작성 중·미작성 → 확정(최근 순). 같은 상태에서는 기한이 가까운 것이 먼저. */
export function sortStaffNotes<T extends StaffNoteItem>(items: T[], today: string): T[] {
  const rank: Record<StaffNoteDue, number> = { overdue: 0, due_soon: 1, ok: 2, done: 3 }
  return [...items].sort((a, b) => {
    const da = dueOf(a, today)
    const db = dueOf(b, today)
    if (rank[da.due] !== rank[db.due]) return rank[da.due] - rank[db.due]
    if (da.due === 'done') return b.changeLogId - a.changeLogId
    return da.deadline.localeCompare(db.deadline) || a.changeLogId - b.changeLogId
  })
}

/** 아직 확정되지 않은 일지 수(관리자에게 "할 일"로 보이는 숫자). */
export function pendingCount(items: StaffNoteItem[]): number {
  return items.filter((i) => i.note?.status !== 'confirmed').length
}

// ── 초안 만들기(선택지 → 기록 문장) ───────────────────────────────────────────────

/** 초안 만들기 입력. 모두 사람이 고른 값이다. 수급자 코드·이름·담당자 코드는 포함하지 않는다(AI에도 전달하지 않는다). */
export interface StaffNoteDraftInput {
  reasonLabel: string
  /** 사유 추가 설명. reasonLabel이 '기타(직접 입력)'이면 필수. */
  reasonMemo: string
  counselMethod: CounselMethod
  relation: string
  consent: ConsentChoice
  /** 수급자(보호자)의 의견. '동의함(의견 있음)'이면 필수, '동의하지 않음'이면 선택. */
  opinionMemo: string
}

export interface StaffNoteDraftResult {
  reason: string
  content: string
  /** ai = AI가 다듬음 · template = 기본 문장(AI 미사용). */
  source: 'ai' | 'template'
  /** template인 이유. demo = 데모 모드 · not_configured = AI 미설정 · failed = AI 호출 실패 · rejected = AI 결과가 검증을 통과하지 못함. */
  fallbackReason?: 'demo' | 'not_configured' | 'failed' | 'rejected'
}

export const OTHER_REASON_LABEL = REASON_CHOICES[REASON_CHOICES.length - 1].label

const digitRuns = (text: string): string[] => text.match(/\d+/g) ?? []

/** 초안 입력 검사. 문제가 없으면 null, 있으면 사용자에게 보일 문장. */
export function validateDraftInput(input: StaffNoteDraftInput): string | null {
  const reasonLabel = input.reasonLabel.trim()
  if (!reasonLabel) return '변경 사유를 선택해 주세요.'
  if (reasonLabel === OTHER_REASON_LABEL && !input.reasonMemo.trim()) return '기타 사유는 내용을 직접 적어 주세요.'
  if (!COUNSEL_METHODS.includes(input.counselMethod)) return '상담 방법을 선택해 주세요.'
  if (!input.relation.trim()) return '상담 대상자(관계)를 선택하거나 입력해 주세요.'
  if (!CONSENT_CHOICES.includes(input.consent)) return '수급자(보호자)의 의견·동의 여부를 선택해 주세요.'
  if (input.consent === 'agreed_with_opinion' && !input.opinionMemo.trim()) return '의견이 있다면 어떤 의견인지 적어 주세요.'
  if (input.reasonLabel.length > 40 || input.reasonMemo.length > MEMO_MAX || input.opinionMemo.length > MEMO_MAX) {
    return `추가 설명은 ${MEMO_MAX}자 이내로 적어 주세요.`
  }
  if (input.relation.length > RELATION_MAX) return `상담 대상자(관계)는 ${RELATION_MAX}자 이내로 입력해 주세요.`
  for (const text of [input.reasonMemo, input.opinionMemo, input.relation]) {
    if (/\d{6}-?[1-4]\d{6}/.test(text) || (text.match(/\d/g) ?? []).length >= 7) {
      return '실명·전화번호·주민등록번호처럼 보이는 숫자는 넣을 수 없습니다. 관계나 상황만 적어 주세요.'
    }
  }
  return null
}

const METHOD_DID: Record<CounselMethod, string> = { visit: '방문하여', phone: '전화로', other: '기타 방법으로' }
const METHOD_TRIED: Record<CounselMethod, string> = {
  visit: '방문했으나 만나지 못해',
  phone: '전화로 연락을 시도했으나 연결되지 않아',
  other: '연락을 시도했으나 닿지 않아',
}

function reasonShort(input: StaffNoteDraftInput): string {
  const memo = input.reasonMemo.trim()
  return input.reasonLabel.trim() === OTHER_REASON_LABEL ? memo : memo ? `${input.reasonLabel.trim()}, ${memo}` : input.reasonLabel.trim()
}

/** 선택한 내용만으로 만든 기본 문장 초안. AI를 쓰지 않으므로 선택에 없는 내용은 한 글자도 더하지 않는다.
 * AI 호출이 꺼져 있거나 실패하거나 검증을 통과하지 못했을 때, 그리고 데모에서 이 문장이 그대로 쓰인다. */
export function buildTemplateDraft(input: StaffNoteDraftInput): { reason: string; content: string } {
  const relation = input.relation.trim()
  const opinion = input.opinionMemo.trim()
  const short = reasonShort(input)
  const reason = input.reasonLabel.trim() === OTHER_REASON_LABEL ? short : `${short}에 따른 담당 요양보호사 변경`
  const notice =
    input.consent === 'not_reached'
      ? `[안내] ${METHOD_TRIED[input.counselMethod]} ${relation}에게 담당 요양보호사 변경 사실을 아직 안내하지 못함.`
      : `[안내] ${METHOD_DID[input.counselMethod]} ${relation}에게 담당 요양보호사 변경 사실과 사유(${short})를 안내함.`
  const consentLine: Record<ConsentChoice, string> = {
    agreed: '변경에 동의함.',
    agreed_with_opinion: `변경에 동의함. 의견: ${opinion}`,
    not_agreed: `변경에 동의하지 않음.${opinion ? ` 의견: ${opinion}` : ''}`,
    not_reached: '동의 여부는 안내 후 다시 확인 필요.',
  }
  return { reason, content: `${notice}\n[의견·동의] ${consentLine[input.consent]}` }
}

const AGREE_WORDS = /동의함|동의하였|동의했|동의한다|동의합니다|동의하셨/
const DISAGREE_WORDS = /동의하지|동의 못|동의를 하지|동의하지 않|거부|반대/

/** AI가 만든 문장 검증. 통과하지 못하면 호출한 쪽이 기본 문장으로 대체한다.
 * 막는 것: ① 고른 동의 여부와 어긋나는 표현 ② 입력에 없던 숫자(지어낸 날짜·전화번호·금액) ③ 필수 구조·관계 누락 ④ 길이 초과. */
export function checkAiDraft(out: { reason?: unknown; content?: unknown }, input: StaffNoteDraftInput): out is { reason: string; content: string } {
  if (typeof out.reason !== 'string' || typeof out.content !== 'string') return false
  const reason = out.reason.trim()
  const content = out.content.trim()
  if (!reason || !content || reason.length > REASON_MAX || content.length > CONTENT_MAX) return false
  if (!content.includes('[안내]') || !content.includes('[의견·동의]')) return false
  if (!content.includes(input.relation.trim())) return false
  const allowed = new Set([...digitRuns(input.reasonMemo), ...digitRuns(input.opinionMemo), ...digitRuns(input.relation)])
  if ([...digitRuns(reason), ...digitRuns(content)].some((d) => !allowed.has(d))) return false
  const consentPart = content.slice(content.indexOf('[의견·동의]'))
  switch (input.consent) {
    case 'agreed':
    case 'agreed_with_opinion':
      return AGREE_WORDS.test(consentPart) && !DISAGREE_WORDS.test(consentPart)
    case 'not_agreed':
      return DISAGREE_WORDS.test(consentPart) && !AGREE_WORDS.test(consentPart)
    case 'not_reached':
      return !AGREE_WORDS.test(content) && /못|않|확인 필요|확인이 필요/.test(content)
  }
}
