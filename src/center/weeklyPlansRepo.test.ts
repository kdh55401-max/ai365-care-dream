import { afterEach, expect, it, vi } from 'vitest'
import { createDemoOperationsRepository } from './operationsRepo'
import { createDemoWeeklyPlansRepository, serverWeeklyPlansRepository } from './weeklyPlansRepo'
import { checkWeeklyPlanTransition, type WeeklyPlanFields } from '../../shared/centerWeeklyPlanStore'
afterEach(() => vi.unstubAllGlobals())
async function fixture() {
  const map = new Map<string, string>(), storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }, ops = createDemoOperationsRepository(storage)
  const patientId = crypto.randomUUID(), workerId = crypto.randomUUID()
  for (const [id, kind] of [[patientId, 'patient'], [workerId, 'worker']] as const) await ops.mutate({ action: 'upsertPerson', requestId: crypto.randomUUID(), expectedVersion: 0, person: { id, kind, name: '가상 인물', status: '', category: '', start: '', end: '', examination: '', notes: {} } })
  const plan: WeeklyPlanFields = { id: crypto.randomUUID(), patientId, month: '2026-10', note: '', entries: [] }
  const entry = { id: crypto.randomUUID(), service: '요양' as const, weekdays: [1], start: '09:00', end: '10:00', workerIds: [workerId], nursingDual: false }
  return { storage, ops, plan, entry, repo: createDemoWeeklyPlansRepository(storage) }
}
it('계획 정보→개별 항목 저장·재시도·재진입과 참조 보관 방지를 유지한다', async () => {
  const { storage, ops, plan, entry, repo } = await fixture()
  await repo.mutate({ action: 'save', requestId: crypto.randomUUID(), expectedVersion: 0, plan })
  const mutation = { action: 'save' as const, requestId: crypto.randomUUID(), expectedVersion: 1, plan: { ...plan, entries: [entry] } }, saved = await repo.mutate(mutation)
  expect(await repo.mutate(mutation)).toEqual(saved)
  expect(await createDemoWeeklyPlansRepository(storage).list(plan.patientId)).toEqual([saved])
  await expect(repo.mutate({ ...mutation, requestId: crypto.randomUUID() })).rejects.toThrow('변경')
  await expect(repo.mutate({ ...mutation, plan: { ...mutation.plan, note: '다른 요청' } })).rejects.toThrow('요청 번호')
  await expect(ops.mutate({ action: 'archivePerson', requestId: crypto.randomUUID(), expectedVersion: 1, id: entry.workerIds[0] })).rejects.toThrow('주간 계획')
  await repo.mutate({ action: 'archive', id: plan.id, expectedVersion: 2, requestId: crypto.randomUUID() })
  expect(await repo.list(plan.patientId)).toEqual([])
  await ops.mutate({ action: 'archivePerson', requestId: crypto.randomUUID(), expectedVersion: 1, id: entry.workerIds[0] })
})
it('빈 계획 선행·한 항목 경계·겹침·부적격 제공자를 거절하고 간격 경고는 저장한다', async () => {
  const { plan, entry, repo } = await fixture(), request = () => crypto.randomUUID()
  await expect(repo.mutate({ action: 'save', requestId: request(), expectedVersion: 0, plan: { ...plan, entries: [entry] } })).rejects.toThrow('빈 계획')
  const old = await repo.mutate({ action: 'save', requestId: request(), expectedVersion: 0, plan })
  expect(() => checkWeeklyPlanTransition(old, { ...plan, entries: [entry, { ...entry, id: request() }] })).toThrow('하나씩')
  await expect(repo.mutate({ action: 'save', requestId: request(), expectedVersion: 1, plan: { ...plan, entries: [{ ...entry, workerIds: [plan.patientId] }] } })).rejects.toThrow('제공자')
  const saved = await repo.mutate({ action: 'save', requestId: request(), expectedVersion: 1, plan: { ...plan, entries: [entry] } })
  expect(() => checkWeeklyPlanTransition(saved, { ...plan, entries: [entry, { ...entry, id: request() }] })).toThrow('겹치는')
  const next = { ...plan, entries: [entry, { ...entry, id: request(), start: '10:00', end: '11:00' }] }
  expect(checkWeeklyPlanTransition(saved, next)).toMatchObject([{ type: 'short_gap', blocksSave: false }])
  expect(await repo.mutate({ action: 'save', requestId: request(), expectedVersion: 2, plan: next })).toMatchObject({ version: 3 })
})
it('조회 실패를 빈 목록이나 시연 성공으로 바꾸지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '서버 미준비' }), { status: 503 })))
  await expect(serverWeeklyPlansRepository.list(crypto.randomUUID())).rejects.toThrow('미준비')
})
