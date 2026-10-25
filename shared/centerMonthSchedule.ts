import { assignmentId } from './centerAssignments.js'
import { parseCenterOperationMutation, type CenterVisit } from './centerOperations.js'
export interface ScheduleSnapshotRow { id: string; version: number }
export interface MonthScheduleState { month: string; version: number; locked: boolean; snapshot: ScheduleSnapshotRow[] }
export interface MonthScheduleMutation extends MonthScheduleState { requestId: string; expectedVersion: number }
export type MonthScheduleInput = Omit<MonthScheduleMutation, 'version'>
export function scheduleMonth(value: unknown): string { if (typeof value !== 'string' || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('조회할 일정 년월을 확인하세요.'); return value }
export function parseScheduleSnapshot(value: unknown): ScheduleSnapshotRow[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('일정 목록 전체를 확인하지 못했습니다.')
  const rows = value.map(v => {
    if (!v || typeof v !== 'object' || Object.keys(v).some(k => !['id', 'version'].includes(k)) || !Number.isSafeInteger(v.version) || v.version < 1) throw new Error('일정 버전 확인 실패')
    return { id: assignmentId(v.id), version: Number(v.version) }
  }).sort((a, b) => a.id.localeCompare(b.id))
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('일정 목록에 중복이 있습니다.')
  return rows
}
export function parseMonthState(value: unknown): MonthScheduleState {
  if (!value || typeof value !== 'object') throw new Error('월 일정 상태 확인 실패')
  const v = value as MonthScheduleState
  if (!Number.isSafeInteger(v.version) || v.version < 0 || typeof v.locked !== 'boolean' || (v.version === 0 && v.locked)) throw new Error('월 일정 상태 버전 확인 실패')
  return { month: scheduleMonth(v.month), version: v.version, locked: v.locked, snapshot: parseScheduleSnapshot(v.snapshot) }
}
export function parseMonthMutation(value: unknown): MonthScheduleInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('일정 잠금 요청 오류')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['month', 'expectedVersion', 'locked', 'snapshot', 'requestId'].includes(k))) throw new Error('일정 잠금 요청 필드 오류')
  const state = parseMonthState({ month: v.month, version: v.expectedVersion, locked: false, snapshot: v.snapshot })
  if (typeof v.locked !== 'boolean') throw new Error('잠금 상태를 확인하세요.')
  return { month: state.month, expectedVersion: state.version, snapshot: state.snapshot, locked: v.locked, requestId: assignmentId(v.requestId) }
}
export function visitOverlapsMonth(visit: CenterVisit, month: string): boolean {
  scheduleMonth(month)
  parseCenterOperationMutation({ action: 'upsertVisit', requestId: visit.id, expectedVersion: visit.version ?? 1, visit }, true)
  const start = Date.parse(`${visit.date}T${visit.time}:00Z`), first = Date.parse(`${month}-01T00:00:00Z`), d = new Date(first), end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
  return !visit.archived && start < end && start + visit.minutes * 60000 > first
}
export function monthScheduleSnapshot(visits: CenterVisit[], month: string): ScheduleSnapshotRow[] { return parseScheduleSnapshot(visits.filter(v => visitOverlapsMonth(v, month)).map(v => ({ id: v.id, version: v.version }))) }
