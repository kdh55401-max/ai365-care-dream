import { afterEach, expect, it, vi } from 'vitest'
import { parseCenterAssignmentMutation } from '../../shared/centerAssignments'
import { createDemoAssignmentsRepository, serverAssignmentsRepository } from './assignmentsRepo'
import { createDemoOperationsRepository } from './operationsRepo'
afterEach(() => vi.unstubAllGlobals())
async function fixture() {
  const map = new Map<string, string>(), storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }, operations = createDemoOperationsRepository(storage)
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  for (const [index, id] of ids.entries()) await operations.mutate({ action: 'upsertPerson', expectedVersion: 0, requestId: crypto.randomUUID(), person: { id, kind: index === 0 ? 'patient' : 'worker', name: `가상 ${index}`, status: '', category: '', start: '', end: '', examination: '', notes: {} } })
  return { storage, operations, input: { patientId: ids[0], workerIds: ids.slice(1), expectedVersion: 0, requestId: crypto.randomUUID() } }
}
it('배정 재조회·재시도·충돌·참조 보관을 서버와 같이 처리한다', async () => {
  const { storage, operations, input } = await fixture(), repo = createDemoAssignmentsRepository(storage)
  expect(await repo.load(input.patientId)).toMatchObject({ workerIds: [], version: 0 })
  const saved = await repo.save(input); expect(await repo.save(input)).toEqual(saved)
  expect(await createDemoAssignmentsRepository(storage).load(input.patientId)).toEqual(saved)
  await expect(repo.save({ ...input, requestId: crypto.randomUUID() })).rejects.toThrow('변경')
  await expect(operations.mutate({ action: 'archivePerson', id: input.workerIds[1], expectedVersion: 1, requestId: crypto.randomUUID() })).rejects.toThrow('담당')
  await repo.save({ ...input, expectedVersion: 1, workerIds: [], requestId: crypto.randomUUID() })
  await operations.mutate({ action: 'archivePerson', id: input.workerIds[1], expectedVersion: 1, requestId: crypto.randomUUID() })
})
it('없는 대상·잘못된 직원·UUID 중복·기관 주입을 거절한다', async () => {
  const { storage, input } = await fixture(), repo = createDemoAssignmentsRepository(storage)
  await expect(repo.load(crypto.randomUUID())).rejects.toThrow('수급자')
  for (const workerIds of [[input.patientId], [crypto.randomUUID()]]) await expect(repo.save({ ...input, workerIds })).rejects.toThrow('직원')
  expect(() => parseCenterAssignmentMutation({ ...input, workerIds: [input.workerIds[0], input.workerIds[0]] })).toThrow()
  expect(() => parseCenterAssignmentMutation({ ...input, organizationCode: 'OTHER' })).toThrow()
})
it('서버 조회 실패를 미배정/시연 성공으로 바꾸지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '저장소 미준비' }), { status: 503 })))
  await expect(serverAssignmentsRepository.load(crypto.randomUUID())).rejects.toThrow('미준비')
})
