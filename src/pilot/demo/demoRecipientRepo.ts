import {
  nextRecipientCode,
  normalizeCaregiverCodes,
  validateDisplayName,
  validateRecipientCode,
  type RecipientAdminView,
  type RecipientSaveResult,
  type RegisterRecipientInput,
  type UpdateRecipientInput,
} from '../../../shared/recipientAdmin'
import { demoAssignmentMap, demoListParticipants, demoRecipients, demoSaveRecipients, type DemoRecipient } from './demoStore'

/** 데모 모드의 수급자 등록·배정. 실서버(api/admin/participants.ts + DB 함수)와 같은 규칙·같은 오류 문구를 쓰되,
 * 이 브라우저 localStorage에만 저장한다 — 운영 DB·운영 집계와 섞이지 않는다. */

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

const seenRequests = new Map<string, string>()

function validCaregivers(codes: string[]) {
  const active = new Set(demoListParticipants().filter((p) => p.active).map((p) => p.code))
  if (codes.some((c) => !active.has(c))) fail(400, '등록되지 않았거나 사용 중지된 요양보호사는 배정할 수 없습니다.')
}

export function demoRecipientAdminView(): RecipientAdminView {
  const map = demoAssignmentMap()
  return {
    ready: true,
    recipients: demoRecipients().map((r) => ({
      code: r.code,
      displayName: r.displayName,
      active: r.active,
      caregivers: Object.entries(map).filter(([, list]) => list.includes(r.code)).map(([c]) => c).sort(),
      updatedAt: r.updatedAt,
    })),
    caregivers: demoListParticipants().map((p) => ({ code: p.code, active: p.active })),
  }
}

export function demoRegisterRecipient(input: RegisterRecipientInput): RecipientSaveResult {
  const prior = seenRequests.get(input.requestId)
  if (prior) return { code: prior, duplicate: true }
  const nameError = validateDisplayName(input.displayName)
  if (nameError) fail(400, nameError)
  const codeError = validateRecipientCode(input.code)
  if (codeError) fail(400, codeError)
  const caregivers = normalizeCaregiverCodes(input.caregiverCodes)
  validCaregivers(caregivers)
  const recipients = demoRecipients()
  const manual = (input.code ?? '').trim().toUpperCase()
  if (manual && recipients.some((r) => r.code === manual)) fail(409, '이미 사용 중인 수급자 코드입니다.')
  const code = manual || nextRecipientCode(recipients.map((r) => r.code))
  const map = { ...demoAssignmentMap() }
  for (const c of caregivers) map[c] = [...(map[c] ?? []), code]
  const created: DemoRecipient = { code, displayName: input.displayName.trim(), active: input.active, updatedAt: new Date().toISOString() }
  demoSaveRecipients([...recipients, created].sort((a, b) => a.code.localeCompare(b.code)), map)
  seenRequests.set(input.requestId, code)
  return { code, duplicate: false }
}

export function demoUpdateRecipient(input: UpdateRecipientInput): RecipientSaveResult {
  const prior = seenRequests.get(input.requestId)
  if (prior) return { code: prior, duplicate: true }
  const recipients = demoRecipients()
  const current = recipients.find((r) => r.code === input.code)
  if (!current) fail(404, '수급자를 찾을 수 없습니다.')
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== current.updatedAt) {
    fail(409, '다른 곳에서 먼저 수정되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.')
  }
  if (input.displayName !== undefined) {
    const nameError = validateDisplayName(input.displayName)
    if (nameError) fail(400, nameError)
  }
  const map = { ...demoAssignmentMap() }
  let change: { recipientCode: string; from: string[]; to: string[] } | undefined
  if (input.caregiverCodes !== undefined) {
    const next = normalizeCaregiverCodes(input.caregiverCodes)
    const already = Object.entries(map).filter(([, list]) => list.includes(input.code)).map(([c]) => c)
    validCaregivers(next.filter((c) => !already.includes(c)))
    // 서버(DB 함수)와 같은 기준: 담당에서 빠진 사람이 있으면 직원 변경 상담일지 대상이 되는 변경 이력을 남긴다.
    const removed = already.filter((c) => !next.includes(c)).sort()
    if (removed.length > 0) change = { recipientCode: input.code, from: removed, to: next.filter((c) => !already.includes(c)).sort() }
    for (const caregiver of Object.keys(map)) map[caregiver] = map[caregiver].filter((c) => c !== input.code)
    for (const c of next) map[c] = [...(map[c] ?? []), input.code]
  }
  const updated = recipients.map((r) =>
    r.code === input.code
      ? { ...r, displayName: input.displayName !== undefined ? input.displayName.trim() : r.displayName, active: input.active ?? r.active, updatedAt: new Date().toISOString() }
      : r,
  )
  demoSaveRecipients(updated, map, change)
  seenRequests.set(input.requestId, input.code)
  return { code: input.code, duplicate: false }
}
