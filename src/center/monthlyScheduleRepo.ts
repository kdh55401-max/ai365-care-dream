import { monthScheduleSnapshot, parseMonthMutation, parseMonthState, scheduleMonth, type MonthScheduleInput, type MonthScheduleState } from '../../shared/centerMonthSchedule'
import type { CenterVisit } from '../../shared/centerOperations'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
import { readMonthLedger } from './monthlyScheduleStorage'
export interface MonthScheduleRepository { inspect(month: string): Promise<MonthScheduleState>; save(input: MonthScheduleInput): Promise<MonthScheduleState> }
async function response(r: Response): Promise<unknown> { const data = await r.json(); if (!r.ok) throw new Error(data?.error || '월 일정 저장소 오류'); return data }
function checked(value: unknown, input: MonthScheduleInput) { const state = parseMonthState(value); if (state.month !== input.month || state.version !== input.expectedVersion + 1 || state.locked !== input.locked || JSON.stringify(state.snapshot) !== JSON.stringify(input.snapshot)) throw new Error('잠금 저장 응답 불일치 · 같은 요청으로 다시 시도하세요.'); return state }
export const serverMonthlyScheduleRepository: MonthScheduleRepository = {
  async inspect(month) { const result = parseMonthState(await response(await fetch(`/api/center/month-schedule?month=${scheduleMonth(month)}`, { credentials: 'same-origin' }))); if (result.month !== month) throw new Error('일정 조회월 불일치'); return result },
  async save(value) { const input = parseMonthMutation(value); return checked(await response(await fetch('/api/center/month-schedule', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })), input) },
}
export function createDemoMonthlyScheduleRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): MonthScheduleRepository {
  function read() {
    const data = JSON.parse(storage.getItem(DEMO_OPERATIONS_STORAGE_KEY) || '{"people":[],"visits":[],"requests":{}}') as { visits: CenterVisit[]; monthScheduleState?: unknown }
    if (!Array.isArray(data.visits)) throw new Error('시연 일정 조회 실패')
    return { data, ledger: readMonthLedger(data.monthScheduleState) }
  }
  return {
    async inspect(value) { const month = scheduleMonth(value), { data, ledger } = read(); return { ...(ledger.months[month] ?? { month, version: 0, locked: false }), snapshot: monthScheduleSnapshot(data.visits, month) } },
    async save(value) {
      const input = parseMonthMutation(value), { data, ledger } = read(), payload = JSON.stringify(input), prior = ledger.requests[input.requestId]
      if (prior) { if (prior.payload !== payload) throw new Error('같은 요청 번호의 내용이 다릅니다.'); return structuredClone(checked(prior.result, input)) }
      const old = ledger.months[input.month], snapshot = monthScheduleSnapshot(data.visits, input.month)
      if ((old?.version ?? 0) !== input.expectedVersion || JSON.stringify(snapshot) !== JSON.stringify(input.snapshot)) throw new Error('일정 또는 검토 상태가 바뀌었습니다. 다시 조회하세요.')
      if ((old?.locked ?? false) === input.locked) throw new Error('이미 같은 잠금 상태입니다. 다시 조회하세요.')
      if (input.locked && !snapshot.length) throw new Error('빈 월 일정은 잠글 수 없습니다.')
      const state = { month: input.month, version: input.expectedVersion + 1, locked: input.locked, snapshot }
      ledger.months[input.month] = state; ledger.requests[input.requestId] = { payload, result: state }; data.monthScheduleState = ledger
      storage.setItem(DEMO_OPERATIONS_STORAGE_KEY, JSON.stringify(data)); return structuredClone(state)
    },
  }
}
