import {
  buildTemplateDraft,
  kstDateOf,
  sortStaffNotes,
  validateDraftInput,
  validateStaffNote,
  type ConsentChoice,
  type CounselMethod,
  type SaveStaffNoteInput,
  type SaveStaffNoteResult,
  type StaffNoteDraftInput,
  type StaffNoteDraftResult,
  type StaffNoteItem,
  type StaffNoteView,
} from '../../../shared/staffChangeNote'
import { demoRecipients, demoSaveStaffChangeStore, demoStaffChangeStore } from './demoStore'

/** 데모 모드의 직원변경 상담일지. 실서버(api/admin/participants.ts + DB 함수 staff_change_note_save)와 같은 규칙·같은 오류 문구를 쓰되,
 * 이 브라우저 localStorage에만 저장한다 — 운영 DB와 섞이지 않는다. */

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

function todayKst(): string {
  return kstDateOf(new Date().toISOString())
}

export function demoStaffNoteView(): StaffNoteView {
  const store = demoStaffChangeStore()
  const names = new Map(demoRecipients().map((r) => [r.code, r.displayName]))
  const items: StaffNoteItem[] = store.events.map((e) => ({
    changeLogId: e.id,
    recipientCode: e.recipientCode,
    displayName: names.get(e.recipientCode) ?? null,
    fromCaregivers: e.from,
    toCaregivers: e.to,
    changedAt: e.at,
    defaultChangedOn: kstDateOf(e.at),
    note: store.notes[String(e.id)] ?? null,
  }))
  return { ready: true, items: sortStaffNotes(items, todayKst()) }
}

export function demoSaveStaffNote(input: SaveStaffNoteInput): SaveStaffNoteResult {
  const store = demoStaffChangeStore()
  const event = store.events.find((e) => e.id === input.changeLogId)
  if (!event) fail(404, '담당 변경 기록을 찾을 수 없습니다.')
  const fields = {
    changedOn: input.changedOn.trim(),
    reason: input.reason.trim(),
    counselMethod: (input.counselMethod || null) as CounselMethod | null,
    consent: (input.consent || null) as ConsentChoice | null,
    counseleeRelation: input.counseleeRelation.trim(),
    content: input.content.trim(),
    confirm: input.confirm,
  }
  const problem = validateStaffNote(fields, todayKst())
  if (problem) fail(400, problem)
  const existing = store.notes[String(input.changeLogId)]
  if (existing?.status === 'confirmed') fail(409, '이미 확정된 상담일지는 수정할 수 없습니다.')
  if (existing ? existing.updatedAt !== input.expectedUpdatedAt : Boolean(input.expectedUpdatedAt)) {
    fail(409, existing ? '다른 곳에서 먼저 수정되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.' : '다른 곳에서 먼저 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.')
  }
  const now = new Date().toISOString()
  const status = input.confirm ? 'confirmed' : 'draft'
  store.notes[String(input.changeLogId)] = {
    changedOn: fields.changedOn,
    reason: fields.reason,
    counselMethod: fields.counselMethod,
    consent: fields.consent,
    counseleeRelation: fields.counseleeRelation,
    content: fields.content,
    status,
    confirmedAt: input.confirm ? now : null,
    updatedAt: now,
  }
  demoSaveStaffChangeStore(store)
  return { changeLogId: input.changeLogId, status, updatedAt: now }
}

/** 데모에서는 AI를 호출하지 않는다(자격증명·외부 호출 없음) — 기본 문장 초안만 만든다. */
export function demoDraftStaffNoteText(input: StaffNoteDraftInput): StaffNoteDraftResult {
  const problem = validateDraftInput(input)
  if (problem) fail(400, problem)
  return { ...buildTemplateDraft(input), source: 'template', fallbackReason: 'demo' }
}
