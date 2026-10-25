import { expect, it } from 'vitest'
import { createDemoOperationsRepository } from './operationsRepo'
import { createDemoPatientRecognitionsRepository } from './patientRecognitionsRepo'
async function fixture() {
  const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }, ops = createDemoOperationsRepository(storage), repo = createDemoPatientRecognitionsRepository(storage), patientId = crypto.randomUUID()
  await ops.mutate({ action: 'upsertPerson', requestId: crypto.randomUUID(), expectedVersion: 0, person: { id: patientId, kind: 'patient', name: '가상 수급자', status: '수급중', category: '종전 등급', start: '2026-01-02', end: '2026-12-31', examination: '', notes: { 기타: '보존' } } })
  const recognition = { id: crypto.randomUUID(), grade: ' 3등급 ', number: 'L000123', sequence: '001', periodStart: '2026-10-01', periodEnd: '2027-09-30', note: '가상 인정서' }, input = { action: 'save' as const, patientId, requestId: crypto.randomUUID(), expectedVersion: 0, recognition }
  return { storage, ops, repo, recognition, input, patientId }
}
it('저장과 적용을 분리하고 등급만 바꾸며 번호/확장의 앞자리0·이전정보를 보존한다', async () => {
  const { storage, ops, repo, recognition, input, patientId } = await fixture(), before = (await ops.list()).people[0]
  const saved = await repo.save(input); expect((await ops.list()).people[0]).toEqual(before)
  expect(saved.state.entries[0]).toMatchObject({ grade: '3등급', number: 'L000123', sequence: '001' })
  const apply = { action: 'apply' as const, patientId, requestId: crypto.randomUUID(), expectedVersion: 1, expectedPersonVersion: 1, id: recognition.id }, result = await repo.save(apply)
  expect(result.person).toEqual({ ...before, category: '3등급', version: 2, archived: false }); expect(await repo.save(apply)).toEqual(result)
  expect(await createDemoPatientRecognitionsRepository(storage).inspect(patientId)).toEqual(result.state)
  await expect(repo.save({ ...input, expectedVersion: 2, requestId: crypto.randomUUID() })).rejects.toThrow('적용중')
  await expect(repo.save({ action: 'archive', patientId, expectedVersion: 2, requestId: crypto.randomUUID(), id: recognition.id })).rejects.toThrow('적용중')
  const person = (await ops.list()).people[0]; await ops.mutate({ action: 'upsertPerson', expectedVersion: 2, requestId: crypto.randomUUID(), person: { ...person, name: '다른 이름' } })
  expect((await repo.inspect(patientId)).activeId).toBe(recognition.id)
})
it('기본정보 버전 충돌은 적용 전체를 막고 갱신 후 구이력을 보관한다', async () => {
  const { repo, ops, input, recognition, patientId } = await fixture(); await repo.save(input)
  const person = (await ops.list()).people[0]; await ops.mutate({ action: 'upsertPerson', expectedVersion: 1, requestId: crypto.randomUUID(), person: { ...person, name: '동시 편집' } })
  await expect(repo.save({ action: 'apply', patientId, expectedVersion: 1, expectedPersonVersion: 1, requestId: crypto.randomUUID(), id: recognition.id })).rejects.toThrow('기본정보')
  expect(await repo.inspect(patientId)).toMatchObject({ version: 1, activeId: null })
  const next = { ...recognition, id: crypto.randomUUID(), grade: '2등급', sequence: '002' }
  await repo.save({ ...input, expectedVersion: 1, requestId: crypto.randomUUID(), recognition: next })
  await repo.save({ action: 'apply', patientId, expectedVersion: 2, expectedPersonVersion: 2, requestId: crypto.randomUUID(), id: next.id })
  const result = await repo.save({ action: 'archive', patientId, expectedVersion: 3, requestId: crypto.randomUUID(), id: recognition.id })
  expect(result.state.entries.find(e => e.id === recognition.id)?.archived).toBe(true)
  expect(result.state.activeId).toBe(next.id)
})
it('잘못된 기간·번호·확장과 쓰기 실패는 저장하지 않는다', async () => {
  const { storage, repo, input, recognition, patientId } = await fixture()
  for (const changed of [{ ...recognition, periodEnd: '2026-02-30' }, { ...recognition, periodEnd: '2025-01-01' }, { ...recognition, grade: ' ' }, { ...recognition, number: 'invalid' }, { ...recognition, sequence: 1 }]) await expect(repo.save({ ...input, recognition: changed } as typeof input)).rejects.toThrow()
  const failing = createDemoPatientRecognitionsRepository({ getItem: storage.getItem, setItem: () => { throw new Error('쓰기 실패') } })
  await expect(failing.save(input)).rejects.toThrow('쓰기 실패'); expect(await repo.inspect(patientId)).toMatchObject({ version: 0, entries: [] })
})
