import { expect, it } from 'vitest'
import { createDemoOperationsRepository } from './operationsRepo'
import { createDemoPatientContractsRepository } from './patientContractsRepo'
async function fixture() {
  const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }, ops = createDemoOperationsRepository(storage), repo = createDemoPatientContractsRepository(storage), patientId = crypto.randomUUID()
  await ops.mutate({ action: 'upsertPerson', expectedVersion: 0, requestId: crypto.randomUUID(), person: { id: patientId, kind: 'patient', name: '가상 수급자', status: '수급중', category: '가상 등급', start: '', end: '', examination: '', notes: { 기타: '보존' } } })
  const contract = { id: crypto.randomUUID(), contractDate: '2026-10-01', periodStart: '2026-10-03', periodEnd: '2027-10-02', services: ['요양' as const, '목욕' as const], note: '가상 계약' }
  const input = { action: 'save' as const, patientId, expectedVersion: 0, requestId: crypto.randomUUID(), contract }
  return { storage, ops, repo, patientId, contract, input }
}
it('이력만 저장→명시 적용·재조회·재시도를 분리하고 다른 인물 정보를 보존한다', async () => {
  const { storage, ops, repo, patientId, contract, input } = await fixture(), saved = await repo.save(input)
  expect(saved.state.activeId).toBeNull(); expect((await ops.list()).people[0].start).toBe('')
  const apply = { action: 'apply' as const, patientId, expectedVersion: 1, expectedPersonVersion: 1, id: contract.id, requestId: crypto.randomUUID() }, result = await repo.save(apply)
  expect(result.person).toMatchObject({ start: contract.contractDate, end: contract.periodEnd, version: 2, name: '가상 수급자', category: '가상 등급', notes: { 기타: '보존' } })
  expect(await repo.save(apply)).toEqual(result)
  expect(await createDemoPatientContractsRepository(storage).inspect(patientId)).toEqual(result.state)
  await expect(repo.save({ ...input, expectedVersion: 2, requestId: crypto.randomUUID() })).rejects.toThrow('적용중')
  await expect(repo.save({ action: 'archive', patientId, expectedVersion: 2, id: contract.id, requestId: crypto.randomUUID() })).rejects.toThrow('적용중')
  const person = (await ops.list()).people[0]; await ops.mutate({ action: 'upsertPerson', person: { ...person, name: '가상 변경' }, expectedVersion: 2, requestId: crypto.randomUUID() })
  expect((await repo.inspect(patientId)).activeId).toBe(contract.id)
})
it('기본정보/이력 버전 충돌은 적용을 거절하고 계약 교체 후 이전 이력을 보관한다', async () => {
  const { ops, repo, input, contract, patientId } = await fixture(); await repo.save(input)
  const person = (await ops.list()).people[0]; await ops.mutate({ action: 'upsertPerson', person: { ...person, name: '다른 편집' }, expectedVersion: 1, requestId: crypto.randomUUID() })
  await expect(repo.save({ action: 'apply', patientId, expectedVersion: 1, id: contract.id, expectedPersonVersion: 1, requestId: crypto.randomUUID() })).rejects.toThrow('기본정보')
  expect(await repo.inspect(patientId)).toMatchObject({ version: 1, activeId: null })
  const second = { ...contract, id: crypto.randomUUID(), periodEnd: '2028-10-02' }
  await repo.save({ ...input, contract: second, expectedVersion: 1, requestId: crypto.randomUUID() })
  await repo.save({ action: 'apply', patientId, expectedVersion: 2, id: second.id, expectedPersonVersion: 2, requestId: crypto.randomUUID() })
  const archived = await repo.save({ action: 'archive', patientId, expectedVersion: 3, id: contract.id, requestId: crypto.randomUUID() })
  expect(archived.state.entries.find(e => e.id === contract.id)?.archived).toBe(true)
  expect(archived.state.activeId).toBe(second.id)
  await expect(repo.save({ ...input, requestId: crypto.randomUUID() })).rejects.toThrow('변경')
})
it('잘못된 날짜·급여구분과 저장 실패는 기존 이력을 변경하지 않는다', async () => {
  const { storage, repo, input, contract, patientId } = await fixture()
  for (const changed of [{ ...contract, periodEnd: '2026-02-30' }, { ...contract, periodEnd: '2025-01-01' }, { ...contract, services: [] }, { ...contract, services: ['요양', '요양'] }]) await expect(repo.save({ ...input, contract: changed } as typeof input)).rejects.toThrow()
  const failing = createDemoPatientContractsRepository({ getItem: storage.getItem, setItem: () => { throw new Error('쓰기 실패') } })
  await expect(failing.save(input)).rejects.toThrow('쓰기 실패')
  expect(await repo.inspect(patientId)).toMatchObject({ version: 0, entries: [] })
})
it('보관 표식이 없는 기존 시연 인물도 정상 적용 후 명시적 활성 상태로 보존한다', async () => {
  const { storage, repo, input, patientId, contract } = await fixture(), key = 'gadream365:center-operations:demo:v1', data = JSON.parse(storage.getItem(key)!)
  delete data.people[0].archived; storage.setItem(key, JSON.stringify(data))
  await repo.save(input)
  const result = await repo.save({ action: 'apply', patientId, expectedVersion: 1, expectedPersonVersion: 1, id: contract.id, requestId: crypto.randomUUID() })
  expect(result.person).toMatchObject({ archived: false, version: 2, start: contract.contractDate })
})
