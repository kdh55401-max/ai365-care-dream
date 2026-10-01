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

export type StaffNoteStatus = 'draft' | 'confirmed'
/** missing = 아직 일지를 시작하지 않음 · draft = 작성 중 · confirmed = 관리자 확정(이후 수정 불가) */
export type StaffNoteState = 'missing' | 'draft' | 'confirmed'
export type StaffNoteDue = 'done' | 'overdue' | 'due_soon' | 'ok'

export interface StaffNoteFields {
  changedOn: string
  reason: string
  counselMethod: CounselMethod | null
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
