import { assignmentId } from './centerAssignments.js'

export type WeeklyService = '요양' | '간호' | '목욕'
export interface WeeklyPlanEntry {
  id: string; service: WeeklyService; weekdays: number[]; start: string; end: string; workerIds: string[]
  /** Only the nursing-specific branch observed in inline-25.js. Not billing eligibility. */
  nursingDual: boolean
}
export interface WeeklyPlanDraft { patientId: string; month: string; entries: WeeklyPlanEntry[] }
export interface WeeklyPlanPreview {
  sourceEntryId: string; patientId: string; date: string; time: string; endDate: string; endTime: string
  minutes: number; service: WeeklyService; workerIds: string[]; state: 'unsaved_preview'
}
export interface WeeklyPlanConflict { otherEntryId: string; weekdays: number[]; type: 'overlap' | 'short_gap'; blocksSave: boolean }
const dayMs = 86400000
function fail(message = '주간 계획의 서비스·요일·시간·제공자를 확인하세요.'): never { throw new Error(message) }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown> }
function clock(value: unknown): string { if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('시간은 00:00부터 23:59까지 입력하세요.'); return value }
function minute(value: string): number { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) }
export function weeklyPlanMinutes(entry: Pick<WeeklyPlanEntry, 'start' | 'end'>): number {
  const start = minute(clock(entry.start)), end = minute(clock(entry.end))
  if (start === end) fail('시작과 종료가 같은 계획은 저장할 수 없습니다.')
  return end > start ? end - start : end + 1440 - start
}
export function parseWeeklyPlanEntry(value: unknown): WeeklyPlanEntry {
  const v = object(value)
  if (Object.keys(v).some(key => !['id', 'service', 'weekdays', 'start', 'end', 'workerIds', 'nursingDual'].includes(key))) fail()
  if (typeof v.service !== 'string' || !['요양', '간호', '목욕'].includes(v.service)) fail()
  if (!Array.isArray(v.weekdays) || !v.weekdays.length || v.weekdays.length > 7 || v.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(v.weekdays).size !== v.weekdays.length) fail('방문요일을 중복 없이 선택하세요.')
  if (!Array.isArray(v.workerIds)) fail()
  const workerIds = v.workerIds.map(assignmentId), count = v.service === '목욕' ? 2 : 1
  if (workerIds.length !== count || new Set(workerIds).size !== count) fail(v.service === '목욕' ? '목욕 제공자 2명을 중복 없이 선택하세요.' : '요양·간호 제공자 1명을 선택하세요.')
  if (v.nursingDual !== undefined && typeof v.nursingDual !== 'boolean') fail()
  if (v.nursingDual === true && v.service !== '간호') fail('간호의 예외 선택을 다른 서비스에 적용할 수 없습니다.')
  const entry: WeeklyPlanEntry = { id: assignmentId(v.id), service: v.service as WeeklyService, weekdays: [...v.weekdays].sort((a, b) => a - b), start: clock(v.start), end: clock(v.end), workerIds, nursingDual: v.nursingDual === true }
  weeklyPlanMinutes(entry)
  return entry
}
export function parseWeeklyPlanDraft(value: unknown): WeeklyPlanDraft {
  const v = object(value)
  if (Object.keys(v).some(key => !['patientId', 'month', 'entries'].includes(key)) || typeof v.month !== 'string' || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(v.month) || !Array.isArray(v.entries) || v.entries.length > 100) fail()
  const entries = v.entries.map(parseWeeklyPlanEntry)
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) fail('같은 계획 항목이 중복되었습니다.')
  return { patientId: assignmentId(v.patientId), month: v.month, entries }
}
/** Observed per-change validation inside ONE selected patient plan. Never a center-wide staff clash check.
 * Overnight duration normalization and strict clocks are explicit improvements, not exact legacy behavior.
 * Next-weekday overnight clashes are intentionally not represented by this common-weekday-only contract.
 */
export function checkWeeklyPlanChange(value: unknown, existing: unknown[]): WeeklyPlanConflict[] {
  const entry = parseWeeklyPlanEntry(value), others = existing.map(parseWeeklyPlanEntry)
  if (entry.nursingDual) return []
  const start = minute(entry.start), end = start + weeklyPlanMinutes(entry), conflicts: WeeklyPlanConflict[] = []
  for (const other of others) {
    if (other.id === entry.id || other.service !== entry.service) continue
    const weekdays = entry.weekdays.filter(day => other.weekdays.includes(day))
    if (!weekdays.length) continue
    const otherStart = minute(other.start), otherEnd = otherStart + weeklyPlanMinutes(other)
    if (start < otherEnd && otherStart < end) conflicts.push({ otherEntryId: other.id, weekdays, type: 'overlap', blocksSave: true })
    else if (entry.service === '요양' && Math.max(start, otherStart) - Math.min(end, otherEnd) < 120) conflicts.push({ otherEntryId: other.id, weekdays, type: 'short_gap', blocksSave: false })
  }
  return conflicts
}
/** Produces no persisted visit IDs, signatures, approvals, charges or external requests. */
export function buildWeeklyPlanPreview(value: unknown): WeeklyPlanPreview[] {
  const plan = parseWeeklyPlanDraft(value), [year, month] = plan.month.split('-').map(Number), first = Date.UTC(year, month - 1, 1), next = Date.UTC(year, month, 1), rows: WeeklyPlanPreview[] = []
  for (let timestamp = first; timestamp < next; timestamp += dayMs) {
    const day = new Date(timestamp), date = day.toISOString().slice(0, 10)
    for (const entry of plan.entries) {
      if (!entry.weekdays.includes(day.getUTCDay())) continue
      const minutes = weeklyPlanMinutes(entry), end = new Date(timestamp + (minute(entry.start) + minutes) * 60000)
      rows.push({ sourceEntryId: entry.id, patientId: plan.patientId, date, time: entry.start, endDate: end.toISOString().slice(0, 10), endTime: entry.end, minutes, service: entry.service, workerIds: [...entry.workerIds], state: 'unsaved_preview' })
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.sourceEntryId.localeCompare(b.sourceEntryId))
}
