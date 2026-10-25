import { expect, it } from 'vitest'
import { createDemoOperationsRepository } from './operationsRepo'
import { createDemoWeeklyPlansRepository } from './weeklyPlansRepo'
import { createDemoPlanApplicationRepository } from './planApplicationRepo'
async function fixture() {
  const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }
  const ops = createDemoOperationsRepository(storage), plans = createDemoWeeklyPlansRepository(storage), repo = createDemoPlanApplicationRepository(storage)
  const patientId = crypto.randomUUID(), workerId = crypto.randomUUID()
  for (const [id, kind] of [[patientId, 'patient'], [workerId, 'worker']] as const) await ops.mutate({ action: 'upsertPerson', requestId: crypto.randomUUID(), expectedVersion: 0, person: { id, kind, name: '가상 인물', status: '', category: '', start: '', end: '', examination: '', notes: {} } })
  const fields = { id: crypto.randomUUID(), patientId, month: '2026-10', note: '', entries: [] }
  await plans.mutate({ action: 'save', plan: fields, expectedVersion: 0, requestId: crypto.randomUUID() })
  const plan = await plans.mutate({ action: 'save', expectedVersion: 1, requestId: crypto.randomUUID(), plan: { ...fields, entries: [{ id: crypto.randomUUID(), service: '요양', weekdays: [1], start: '09:00', end: '10:00', workerIds: [workerId], nursingDual: false }] } })
  const input = { planId: plan.id, expectedVersion: plan.version, requestId: crypto.randomUUID() }
  return { storage, ops, plans, repo, plan, input, patientId, workerId }
}
it('월 반영·동일요청·재반영과 편집/보관 후 재생성 방지를 보존한다', async () => {
  const { storage, ops, repo, plan, input } = await fixture()
  expect((await repo.review(plan)).every(r => r.disposition === 'create')).toBe(true)
  const result = await repo.apply(input); expect(result.createdCount).toBe(4); expect(await repo.apply(input)).toEqual(result)
  let visits = (await ops.list()).visits
  const first = visits[0]; await ops.mutate({ action: 'upsertVisit', requestId: crypto.randomUUID(), expectedVersion: 1, visit: { ...first, time: '11:00' } })
  await ops.mutate({ action: 'archiveVisit', id: visits[1].id, requestId: crypto.randomUUID(), expectedVersion: 1 })
  const reopened = createDemoPlanApplicationRepository(storage)
  expect((await reopened.review(plan)).every(r => r.disposition === 'linked')).toBe(true)
  expect(await reopened.apply({ ...input, requestId: crypto.randomUUID() })).toMatchObject({ createdCount: 0, skippedCount: 4 })
  visits = (await ops.list()).visits; expect(visits).toHaveLength(3); expect(visits.find(v => v.id === first.id)?.time).toBe('11:00')
})
it('나중 날짜 충돌시 전체 반영을 막고 exact 중복은 유지한다', async () => {
  const { ops, repo, plan, input, patientId, workerId } = await fixture(), id = crypto.randomUUID()
  await ops.mutate({ action: 'upsertVisit', requestId: crypto.randomUUID(), expectedVersion: 0, visit: { id, patientId, workerId, workerIds: [workerId], date: '2026-10-26', time: '09:30', service: '요양', minutes: 60 } })
  expect((await repo.review(plan)).some(r => r.disposition === 'conflict')).toBe(true)
  await expect(repo.apply(input)).rejects.toThrow('겹칩니다'); expect((await ops.list()).visits).toHaveLength(1)
  await ops.mutate({ action: 'upsertVisit', requestId: crypto.randomUUID(), expectedVersion: 1, visit: { id, patientId, workerId, workerIds: [workerId], date: '2026-10-26', time: '09:00', service: '방문요양', minutes: 60 } })
  expect(await repo.apply(input)).toMatchObject({ createdCount: 3, skippedCount: 1 }); expect((await ops.list()).visits).toHaveLength(4)
})
it('오래된 계획과 저장 실패는 성공으로 바꾸지 않는다', async () => {
  const { repo, plans, plan, input, storage } = await fixture()
  await plans.mutate({ action: 'save', expectedVersion: 2, requestId: crypto.randomUUID(), plan: { id: plan.id, patientId: plan.patientId, month: plan.month, entries: plan.entries, note: '개정' } })
  await expect(repo.apply(input)).rejects.toThrow('변경')
  const fresh = (await plans.list(plan.patientId))[0]
  const fail = createDemoPlanApplicationRepository({ getItem: storage.getItem, setItem: () => { throw new Error('저장 실패') } })
  await expect(fail.apply({ ...input, expectedVersion: 3 })).rejects.toThrow('저장 실패')
  expect((await repo.review(fresh)).every(r => r.disposition === 'create')).toBe(true)
})
