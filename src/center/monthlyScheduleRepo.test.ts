import { expect, it } from 'vitest'
import { createDemoOperationsRepository } from './operationsRepo'
import { createDemoMonthlyScheduleRepository } from './monthlyScheduleRepo'
async function fixture() {
  const map = new Map<string, string>(), storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }, ops = createDemoOperationsRepository(storage), repo = createDemoMonthlyScheduleRepository(storage)
  const workerId = crypto.randomUUID(), patientId = crypto.randomUUID()
  for (const [id, kind] of [[workerId, 'worker'], [patientId, 'patient']] as const) await ops.mutate({ action: 'upsertPerson', expectedVersion: 0, requestId: crypto.randomUUID(), person: { id, kind, name: '가상 인물', status: '', category: '', start: '', end: '', examination: '', notes: {} } })
  const visit = { id: crypto.randomUUID(), date: '2026-10-22', time: '09:00', minutes: 60, service: '요양', workerId, workerIds: [workerId], patientId }
  return { storage, ops, repo, visit }
}
it('빈 월과 조회 이후 추가·수정은 검토 잠금을 거절한다', async () => {
  const { ops, repo, visit } = await fixture(), empty = await repo.inspect('2026-10')
  await expect(repo.save({ month: empty.month, snapshot: empty.snapshot, expectedVersion: 0, locked: true, requestId: crypto.randomUUID() })).rejects.toThrow('빈 월')
  await ops.mutate({ action: 'upsertVisit', visit, expectedVersion: 0, requestId: crypto.randomUUID() })
  await expect(repo.save({ month: empty.month, snapshot: empty.snapshot, expectedVersion: 0, locked: true, requestId: crypto.randomUUID() })).rejects.toThrow('바뀌었습니다')
  const current = await repo.inspect('2026-10')
  await ops.mutate({ action: 'upsertVisit', visit: { ...visit, time: '10:00' }, expectedVersion: 1, requestId: crypto.randomUUID() })
  await expect(repo.save({ month: current.month, snapshot: current.snapshot, expectedVersion: 0, locked: true, requestId: crypto.randomUUID() })).rejects.toThrow('바뀌었습니다')
})
it('잠금 후 추가·수정·보관을 차단하고 해제·재조회·같은 요청을 보존한다', async () => {
  const { storage, ops, repo, visit } = await fixture()
  await ops.mutate({ action: 'upsertVisit', visit, expectedVersion: 0, requestId: crypto.randomUUID() })
  const state = await repo.inspect('2026-10'), input = { month: state.month, snapshot: state.snapshot, expectedVersion: 0, locked: true, requestId: crypto.randomUUID() }, saved = await repo.save(input)
  expect(await repo.save(input)).toEqual(saved)
  await expect(ops.mutate({ action: 'upsertVisit', visit: { ...visit, id: crypto.randomUUID() }, expectedVersion: 0, requestId: crypto.randomUUID() })).rejects.toThrow('잠긴 월')
  await expect(ops.mutate({ action: 'upsertVisit', visit: { ...visit, date: '2026-11-01' }, expectedVersion: 1, requestId: crypto.randomUUID() })).rejects.toThrow('잠긴 월')
  await expect(ops.mutate({ action: 'archiveVisit', id: visit.id, expectedVersion: 1, requestId: crypto.randomUUID() })).rejects.toThrow('잠긴 월')
  expect(await createDemoMonthlyScheduleRepository(storage).inspect('2026-10')).toMatchObject({ version: 1, locked: true })
  await repo.save({ month: saved.month, snapshot: saved.snapshot, expectedVersion: 1, locked: false, requestId: crypto.randomUUID() })
  await ops.mutate({ action: 'upsertVisit', visit: { ...visit, time: '10:00' }, expectedVersion: 1, requestId: crypto.randomUUID() })
  expect(await repo.inspect('2026-10')).toMatchObject({ version: 2, locked: false, snapshot: [{ id: visit.id, version: 2 }] })
})
it('전월 야간은 포함하고 월 시작에 끝난 일정은 제외한다', async () => {
  const { ops, repo, visit } = await fixture()
  await ops.mutate({ action: 'upsertVisit', visit: { ...visit, date: '2026-09-30', time: '23:00', minutes: 60 }, expectedVersion: 0, requestId: crypto.randomUUID() })
  expect((await repo.inspect('2026-10')).snapshot).toEqual([])
  await ops.mutate({ action: 'upsertVisit', visit: { ...visit, date: '2026-09-30', time: '23:30', minutes: 60 }, expectedVersion: 1, requestId: crypto.randomUUID() })
  const state = await repo.inspect('2026-10'); expect(state.snapshot).toHaveLength(1)
  await repo.save({ month: state.month, snapshot: state.snapshot, expectedVersion: 0, locked: true, requestId: crypto.randomUUID() })
  await expect(ops.mutate({ action: 'archiveVisit', id: visit.id, expectedVersion: 2, requestId: crypto.randomUUID() })).rejects.toThrow('잠긴 월')
})
