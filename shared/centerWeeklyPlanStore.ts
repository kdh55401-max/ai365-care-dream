import { assignmentId } from './centerAssignments.js'
import { checkWeeklyPlanChange, parseWeeklyPlanDraft, type WeeklyPlanDraft, type WeeklyPlanConflict } from './centerWeeklyPlan.js'
export interface WeeklyPlanFields extends WeeklyPlanDraft { id: string; note: string }
export interface StoredWeeklyPlan extends WeeklyPlanFields { version: number; archived: boolean }
export type WeeklyPlanMutation = { action: 'save'; requestId: string; expectedVersion: number; plan: WeeklyPlanFields } | { action: 'archive'; requestId: string; expectedVersion: number; id: string }
export class WeeklyPlanError extends Error { statusCode: number; constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode } }
function fail(message = '주간 계획 입력을 확인하세요.'): never { throw new WeeklyPlanError(400, message) }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown> }
export function parseWeeklyPlanFields(value: unknown): WeeklyPlanFields {
  try {
    const v = object(value)
    if (Object.keys(v).some(key => !['id', 'patientId', 'month', 'note', 'entries'].includes(key)) || typeof v.note !== 'string' || v.note.length > 2000 || v.note.includes('\0')) fail()
    return { id: assignmentId(v.id), note: v.note, ...parseWeeklyPlanDraft({ patientId: v.patientId, month: v.month, entries: v.entries }) }
  } catch (error) { if (error instanceof WeeklyPlanError) throw error; throw new WeeklyPlanError(400, error instanceof Error ? error.message : '주간 계획 입력을 확인하세요.') }
}
export function weeklyPlanFields(plan: WeeklyPlanFields): WeeklyPlanFields { return { id: plan.id, patientId: plan.patientId, month: plan.month, note: plan.note, entries: plan.entries } }
export function parseStoredWeeklyPlan(value: unknown): StoredWeeklyPlan {
  const v = object(value)
  if (!Number.isSafeInteger(v.version) || Number(v.version) < 1 || typeof v.archived !== 'boolean') fail('계획 버전과 상태를 확인하세요.')
  return { ...parseWeeklyPlanFields({ id: v.id, patientId: v.patientId, month: v.month, note: v.note, entries: v.entries }), version: Number(v.version), archived: v.archived }
}
export function parseWeeklyPlanMutation(value: unknown): WeeklyPlanMutation {
  const v = object(value)
  if (!['save', 'archive'].includes(String(v.action)) || Object.keys(v).some(key => !['action', 'requestId', 'expectedVersion', v.action === 'save' ? 'plan' : 'id'].includes(key)) || !Number.isSafeInteger(v.expectedVersion) || Number(v.expectedVersion) < 0) fail()
  try {
    const requestId = assignmentId(v.requestId), expectedVersion = Number(v.expectedVersion)
    if (v.action === 'archive') { if (!expectedVersion) fail(); return { action: 'archive', requestId, expectedVersion, id: assignmentId(v.id) } }
    return { action: 'save', requestId, expectedVersion, plan: parseWeeklyPlanFields(v.plan) }
  } catch (error) { if (error instanceof WeeklyPlanError) throw error; fail(error instanceof Error ? error.message : undefined) }
}
/** Same per-entry update boundary as the observed UI; the SQL RPC rechecks under its institution lock. */
export function checkWeeklyPlanTransition(previous: StoredWeeklyPlan | undefined, next: WeeklyPlanFields): WeeklyPlanConflict[] {
  if (!previous) { if (next.entries.length) fail('먼저 적용월과 참고사항으로 빈 계획을 저장하세요.'); return [] }
  if (previous.patientId !== next.patientId || previous.id !== next.id || previous.archived) fail('계획 대상과 식별자는 바꿀 수 없습니다.')
  const old = new Map(previous.entries.map(entry => [entry.id, entry])), current = new Map(next.entries.map(entry => [entry.id, entry]))
  const changed = [...new Set([...old.keys(), ...current.keys()])].filter(id => JSON.stringify(old.get(id)) !== JSON.stringify(current.get(id)))
  if (changed.length > 1) fail('방문계획 항목은 한 번에 하나씩 저장하세요.')
  const candidate = current.get(changed[0])
  const conflicts = candidate ? checkWeeklyPlanChange(candidate, next.entries) : []
  if (conflicts.some(conflict => conflict.blocksSave)) fail('같은 서비스·요일에 겹치는 방문계획이 있습니다.')
  return conflicts
}
