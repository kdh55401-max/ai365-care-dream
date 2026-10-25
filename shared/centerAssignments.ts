export interface CenterAssignment { patientId: string; workerIds: string[]; version: number }
export interface CenterAssignmentMutation { patientId: string; workerIds: string[]; expectedVersion: number; requestId: string }
export class CenterAssignmentError extends Error { statusCode: number; constructor(status: number, message: string) { super(message); this.statusCode = status } }
function fail(): never { throw new CenterAssignmentError(400, '수급자와 담당 직원 선택을 확인하세요.') }
export function assignmentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) fail()
  return value.toLowerCase()
}
function workers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) fail()
  const ids = value.map(assignmentId)
  if (new Set(ids).size !== ids.length) fail()
  return ids
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown> }
export function parseCenterAssignmentMutation(value: unknown): CenterAssignmentMutation {
  const v = object(value)
  if (Object.keys(v).some(key => !['patientId', 'workerIds', 'requestId', 'expectedVersion'].includes(key)) || !Number.isSafeInteger(v.expectedVersion) || Number(v.expectedVersion) < 0) fail()
  return { patientId: assignmentId(v.patientId), workerIds: workers(v.workerIds), requestId: assignmentId(v.requestId), expectedVersion: Number(v.expectedVersion) }
}
export function parseCenterAssignment(value: unknown): CenterAssignment {
  const v = object(value)
  if (!Number.isSafeInteger(v.version) || Number(v.version) < 0) fail()
  const workerIds = workers(v.workerIds)
  if (v.version === 0 && workerIds.length) fail()
  return { patientId: assignmentId(v.patientId), workerIds, version: Number(v.version) }
}
