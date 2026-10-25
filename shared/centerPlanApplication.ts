import { assignmentId } from './centerAssignments.js'
import { parseCenterOperationMutation, visitWorkerIds, type CenterVisit } from './centerOperations.js'
import { buildWeeklyPlanPreview, type WeeklyPlanPreview } from './centerWeeklyPlan.js'
import type { StoredWeeklyPlan } from './centerWeeklyPlanStore.js'
export interface PlanApplicationInput { requestId: string; planId: string; expectedVersion: number }
export interface PlanApplicationResult { planId: string; planVersion: number; createdCount: number; skippedCount: number; visitIds: string[] }
export interface PlanVisitOrigin { entryId: string; date: string; visitId: string }
export interface PlanApplicationRow extends WeeklyPlanPreview { disposition: 'create' | 'linked' | 'exact' | 'conflict'; existingVisitId?: string }
export function parsePlanApplication(value: unknown): PlanApplicationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('계획 반영 요청을 확인하세요.')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['requestId', 'planId', 'expectedVersion'].includes(k)) || !Number.isSafeInteger(v.expectedVersion) || Number(v.expectedVersion) < 1) throw new Error('계획 반영 버전을 확인하세요.')
  return { requestId: assignmentId(v.requestId), planId: assignmentId(v.planId), expectedVersion: Number(v.expectedVersion) }
}
export function parseApplicationResult(value: unknown, input: PlanApplicationInput): PlanApplicationResult {
  if (!value || typeof value !== 'object') throw new Error('반영 응답을 확인하지 못했습니다. 같은 요청으로 재시도하세요.')
  const r = value as PlanApplicationResult
  if (r.planId !== input.planId || r.planVersion !== input.expectedVersion || !Number.isSafeInteger(r.createdCount) || r.createdCount < 0 || !Number.isSafeInteger(r.skippedCount) || r.skippedCount < 0 || r.createdCount + r.skippedCount > 3100 || !Array.isArray(r.visitIds) || r.visitIds.length !== r.createdCount || new Set(r.visitIds).size !== r.visitIds.length) throw new Error('반영 응답이 요청과 다릅니다. 같은 요청으로 재시도하세요.')
  r.visitIds.forEach(assignmentId); return r
}
export function parseOrigins(value: unknown): PlanVisitOrigin[] {
  if (!Array.isArray(value)) throw new Error('반영 이력을 조회하지 못했습니다.')
  const rows = value.map(v => {
    if (!v || typeof v !== 'object' || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new Error('반영 이력 형식 오류')
    return { entryId: assignmentId(v.entryId), date: v.date, visitId: assignmentId(v.visitId) }
  })
  if (new Set(rows.map(r => `${r.entryId}:${r.date}`)).size !== rows.length) throw new Error('중복 반영 이력')
  return rows
}
const stamp = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`)
function service(value: string) { return value.trim().replace(/^방문(요양|간호|목욕)$/, '$1') }
export function reviewPlanApplication(plan: StoredWeeklyPlan, visits: CenterVisit[], origins: PlanVisitOrigin[]): PlanApplicationRow[] {
  if (plan.archived) throw new Error('보관된 계획은 반영할 수 없습니다.')
  const existing = visits.filter(v => !v.archived)
  for (const visit of existing) parseCenterOperationMutation({ action: 'upsertVisit', requestId: plan.id, expectedVersion: visit.version ?? 1, visit }, true)
  const candidates = buildWeeklyPlanPreview({ patientId: plan.patientId, month: plan.month, entries: plan.entries }), rows: PlanApplicationRow[] = []
  for (const candidate of candidates) {
    const origin = origins.find(o => o.entryId === candidate.sourceEntryId && o.date === candidate.date)
    if (origin) { rows.push({ ...candidate, disposition: 'linked', existingVisitId: origin.visitId }); continue }
    const start = stamp(candidate.date, candidate.time), end = start + candidate.minutes * 60000
    const relevant = existing.filter(v => { const s = stamp(v.date, v.time); return start < s + v.minutes * 60000 && s < end && (v.patientId === candidate.patientId || visitWorkerIds(v).some(id => candidate.workerIds.includes(id))) })
    const exact = (v: CenterVisit) => v.patientId === candidate.patientId && stamp(v.date, v.time) === start && v.minutes === candidate.minutes && service(v.service) === candidate.service && visitWorkerIds(v).length === candidate.workerIds.length && visitWorkerIds(v).every(id => candidate.workerIds.includes(id))
    if (relevant.some(v => !exact(v))) rows.push({ ...candidate, disposition: 'conflict' })
    else if (relevant.length) rows.push({ ...candidate, disposition: 'exact', existingVisitId: relevant[0].id })
    else {
      rows.push({ ...candidate, disposition: 'create' })
      existing.push({ id: candidate.sourceEntryId, date: candidate.date, time: candidate.time, minutes: candidate.minutes, workerId: candidate.workerIds[0], workerIds: candidate.workerIds, patientId: candidate.patientId, service: candidate.service })
    }
  }
  return rows
}
