import { parseMonthState, visitOverlapsMonth, type MonthScheduleState } from '../../shared/centerMonthSchedule'
import type { CenterVisit } from '../../shared/centerOperations'
export interface MonthLedger { months: Record<string, MonthScheduleState>; requests: Record<string, { payload: string; result: MonthScheduleState }> }
export function readMonthLedger(value: unknown): MonthLedger {
  if (value === undefined) return { months: {}, requests: {} }
  if (!value || typeof value !== 'object' || !('months' in value) || !('requests' in value) || !value.months || typeof value.months !== 'object' || Array.isArray(value.months) || !value.requests || typeof value.requests !== 'object' || Array.isArray(value.requests)) throw new Error('월 일정 저장소 손상 · 기존 자료를 유지합니다.')
  const months: Record<string, MonthScheduleState> = {}
  for (const [key, raw] of Object.entries(value.months)) { const state = parseMonthState(raw); if (state.month !== key) throw new Error('월 일정 대상 불일치'); months[key] = state }
  return { months, requests: value.requests as MonthLedger['requests'] }
}
export function assertMonthlyScheduleEditable(value: unknown, old?: CenterVisit, next?: CenterVisit) {
  const ledger = readMonthLedger(value)
  if (Object.values(ledger.months).some(s => s.locked && ((old && visitOverlapsMonth(old, s.month)) || (next && visitOverlapsMonth(next, s.month))))) throw new Error('센터 검토로 잠긴 월의 일정입니다. 해당 월의 잠금을 해제한 뒤 수정하세요.')
}
