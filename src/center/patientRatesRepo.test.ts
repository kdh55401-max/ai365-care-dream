import { expect, it } from 'vitest'
import { createDemoOperationsRepository } from './operationsRepo'
import { createDemoPatientRatesRepository } from './patientRatesRepo'
import { patientRateAt, parsePatientRate, parsePatientRatesState, parsePatientRateMutation } from '../../shared/centerPatientRates'
async function fixture() {
 const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }, ops = createDemoOperationsRepository(storage), repo = createDemoPatientRatesRepository(storage), patientId = crypto.randomUUID()
 await ops.mutate({ action: 'upsertPerson', requestId: crypto.randomUUID(), expectedVersion: 0, person: { id: patientId, kind: 'patient', name: '가상 수급자', status: '수급중', category: '3등급', start: '2026-01-02', end: '2026-12-31', examination: '', notes: {} } })
 const rate = { id: crypto.randomUUID(), effectiveDate: '2026-10-01', rateCode: '01' as const, note: '확인자료' }, input = { action: 'save' as const, requestId: crypto.randomUUID(), patientId, expectedVersion: 0, rate }
 return { storage, ops, repo, patientId, rate, input }
}
it('미래 이력을 조기 선택하지 않고 기본정보를 보존하며 재시도·재진입·일반저장 뒤 이력을 유지한다', async () => {
 const { storage, ops, repo, patientId, input, rate } = await fixture(), before = await ops.list()
 const first = await repo.save(input); expect(await repo.save(input)).toEqual(first); expect(await ops.list()).toEqual(before)
 const second = await repo.save({ ...input, requestId: crypto.randomUUID(), expectedVersion: 1, rate: { ...rate, id: crypto.randomUUID(), rateCode: '06', effectiveDate: '2027-01-01' } })
 expect(patientRateAt(second.state, '2026-09-30')).toBeNull(); expect(patientRateAt(second.state, '2026-12-31')?.rateCode).toBe('01'); expect(patientRateAt(second.state, '2027-01-01')?.rateCode).toBe('06')
 const person = before.people[0]; await ops.mutate({ action: 'upsertPerson', requestId: crypto.randomUUID(), expectedVersion: 1, person: { ...person, name: '수정된 가상 이름' } })
 expect(await createDemoPatientRatesRepository(storage).inspect(patientId)).toEqual(second.state)
})
it('동일 적용일·버전 충돌·요청번호 재사용을 거절하고 보관본을 보존한다', async () => {
 const { repo, input, rate, patientId } = await fixture(); await repo.save(input)
 await expect(repo.save({ ...input, requestId: crypto.randomUUID(), expectedVersion: 1, rate: { ...rate, id: crypto.randomUUID() } })).rejects.toThrow('같은 적용일')
 await expect(repo.save({ ...input, requestId: crypto.randomUUID() })).rejects.toThrow('변경')
 await expect(repo.save({ ...input, rate: { ...rate, note: '다른 값' } })).rejects.toThrow('요청 번호')
 const result = await repo.save({ action: 'archive', patientId, requestId: crypto.randomUUID(), expectedVersion: 1, id: rate.id }); expect(result.state.entries[0].archived).toBe(true); expect(patientRateAt(result.state, '2026-10-02')).toBeNull()
 await expect(repo.save({ ...input, requestId: crypto.randomUUID(), expectedVersion: 2 })).rejects.toThrow('보관')
 const next = await repo.save({ ...input, requestId: crypto.randomUUID(), expectedVersion: 2, rate: { ...rate, id: crypto.randomUUID() } }); expect(next.state.entries).toHaveLength(2)
})
it('쓰기실패·잘못된 코드·달력일·중복 응답은 성공으로 바꾸지 않는다', async () => {
 const { storage, repo, input, patientId, rate } = await fixture()
 for (const fields of [{ effectiveDate: '2026-02-30' }, { rateCode: '15' }, { note: 'a'.repeat(2001) }]) expect(() => parsePatientRate({ ...rate, ...fields })).toThrow()
 expect(() => parsePatientRateMutation({ ...input, action: 'apply' })).toThrow()
 expect(() => parsePatientRateMutation({ ...input, organizationCode: 'OTHER' })).toThrow()
 expect(() => parsePatientRatesState({ patientId, version: 1, entries: [{ ...rate, archived: false }, { ...rate, id: crypto.randomUUID(), archived: false }] })).toThrow()
 const failing = createDemoPatientRatesRepository({ getItem: storage.getItem, setItem: () => { throw new Error('쓰기 실패') } }); await expect(failing.save(input)).rejects.toThrow('쓰기 실패'); expect((await repo.inspect(patientId)).version).toBe(0)
})
