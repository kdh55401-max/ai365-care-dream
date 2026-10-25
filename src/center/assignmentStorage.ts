import { parseCenterAssignment, type CenterAssignment } from '../../shared/centerAssignments'
export const DEMO_ASSIGNMENTS_KEY = 'gadream365:center-assignments:demo:v1'
export interface DemoAssignmentLedger { assignments: CenterAssignment[]; receipts: Record<string, { input: string; result: CenterAssignment }> }
export function readDemoAssignments(storage: Pick<Storage, 'getItem'>): DemoAssignmentLedger {
  const raw = storage.getItem(DEMO_ASSIGNMENTS_KEY)
  if (!raw) return { assignments: [], receipts: {} }
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value.assignments) || !value.receipts || typeof value.receipts !== 'object' || Array.isArray(value.receipts)) throw new Error()
    return { assignments: value.assignments.map(parseCenterAssignment), receipts: value.receipts }
  } catch { throw new Error('시연 담당 배정 자료를 읽지 못했습니다. 기존 자료는 지우지 않았습니다.') }
}
export function hasDemoAssignmentReference(storage: Pick<Storage, 'getItem'>, id: string): boolean {
  return readDemoAssignments(storage).assignments.some(a => a.workerIds.length > 0 && (a.patientId === id || a.workerIds.includes(id)))
}
