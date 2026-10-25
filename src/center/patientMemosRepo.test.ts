import { expect, it } from 'vitest'
import { createDemoOperationsRepository } from './operationsRepo'
import { createDemoPatientMemosRepository } from './patientMemosRepo'
import { parsePatientMemo, parsePatientMemoMutation } from '../../shared/centerPatientMemos'
async function fixture() {
 const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }, ops = createDemoOperationsRepository(storage), repo = createDemoPatientMemosRepository(storage), patientId = crypto.randomUUID()
 await ops.mutate({ action: 'upsertPerson', requestId: crypto.randomUUID(), expectedVersion: 0, person: { id: patientId, kind: 'patient', name: '가상 대상', status: '수급중', category: '3등급', start: '', end: '', examination: '', notes: { 관리기록: '기존 단일 메모' } } })
 const memo = { id: crypto.randomUUID(), date: '2026-10-23', text: '<script>표시용 텍스트</script>\n가상 상담' }, input = { action: 'save' as const, requestId: crypto.randomUUID(), patientId, expectedVersion: 0, memo }
 return { storage, ops, repo, patientId, input, memo }
}
it('동일 날짜 여러 기록·작성자·재시도·재진입 및 기존 메모를 보존한다', async () => {
 const f = await fixture(), before = await f.ops.list(), a = await f.repo.save(f.input)
 expect(a.state.entries[0]).toEqual({ ...f.memo, archived: false, writer: '시연 관리자' }); expect(await f.repo.save(f.input)).toEqual(a)
 const b = await f.repo.save({ ...f.input, requestId: crypto.randomUUID(), expectedVersion: 1, memo: { ...f.memo, id: crypto.randomUUID(), text: '두 번째' } }); expect(b.state.entries).toHaveLength(2); expect(await f.ops.list()).toEqual(before)
 const person = before.people[0]; await f.ops.mutate({ action: 'upsertPerson', requestId: crypto.randomUUID(), expectedVersion: 1, person: { ...person, name: '이름 변경' } }); expect(await createDemoPatientMemosRepository(f.storage).inspect(f.patientId)).toEqual(b.state)
})
it('버전충돌·작성자 위조·보관 수정·쓰기실패는 기록을 변경하지 않는다', async () => {
 const f = await fixture(); await f.repo.save(f.input)
 await expect(f.repo.save({ ...f.input, requestId: crypto.randomUUID() })).rejects.toThrow('변경')
 expect(() => parsePatientMemo({ ...f.memo, writer: '위조' })).toThrow(); expect(() => parsePatientMemo({ ...f.memo, text: ' ' })).toThrow(); expect(() => parsePatientMemo({ ...f.memo, date: '2026-02-30' })).toThrow(); expect(() => parsePatientMemoMutation({ ...f.input, organizationCode: 'OTHER' })).toThrow()
 const archive = { action: 'archive' as const, requestId: crypto.randomUUID(), patientId: f.patientId, expectedVersion: 1, id: f.memo.id }; const a = await f.repo.save(archive); expect(a.state.entries[0].archived).toBe(true)
 await expect(f.repo.save({ ...f.input, requestId: crypto.randomUUID(), expectedVersion: 2 })).rejects.toThrow('보관')
 const failing = createDemoPatientMemosRepository({ getItem: f.storage.getItem, setItem: () => { throw new Error('쓰기 실패') } }); await expect(failing.save({ ...f.input, requestId: crypto.randomUUID(), expectedVersion: 2, memo: { ...f.memo, id: crypto.randomUUID() } })).rejects.toThrow('쓰기 실패'); expect((await f.repo.inspect(f.patientId)).version).toBe(2)
})
