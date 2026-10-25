import { describe, expect, it } from 'vitest'
import { DEMO_OPERATIONS_STORAGE_KEY } from './operationsRepo'
import { createDemoWeekReviewsRepository } from './weekReviewsRepo'

const uuid = () => crypto.randomUUID()
function storage(patientId: string) {
  const map = new Map<string, string>([[DEMO_OPERATIONS_STORAGE_KEY, JSON.stringify({ people: [{ id: patientId, kind: 'patient', name: '가상', status: '', category: '', start: '', end: '', examination: '', notes: {} }], visits: [], requests: {} })]])
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }
}
const entry = (patch = {}) => ({ id: uuid(), weekStart: '2026-10-05', value: 'same_as_usual' as const, areas: [], note: '', digest: 'c'.repeat(64), documentId: null, batch: false, ...patch })
describe('시연 주별 확인 저장소', () => {
  it('저장·월별 조회·같은 요청 재현·버전 충돌', async () => {
    const patientId = uuid(), repo = createDemoWeekReviewsRepository(storage(patientId)), input = { requestId: uuid(), patientId, expectedVersion: 0, entries: [entry(), entry({ weekStart: '2026-11-02' })] }
    const a = await repo.save(input); expect(a.version).toBe(1); expect(a.saved[0].reviewer).toBe('시연 관리자'); expect(await repo.save(input)).toEqual(a)
    expect((await repo.inspectMonth('2026-10')).patients[0].entries).toHaveLength(1); expect((await repo.inspectMonth('2026-11')).patients[0].entries).toHaveLength(1); expect((await repo.inspectMonth('2026-12')).patients[0].entries).toHaveLength(0)
    await expect(repo.save({ ...input, requestId: uuid(), entries: [entry()] })).rejects.toThrow('다시 조회')
    await expect(repo.save({ ...input, entries: [entry()] })).rejects.toThrow('다릅니다')
  })
  it('없는 수급자와 잘못된 항목을 거절하고 아무것도 저장하지 않는다', async () => {
    const patientId = uuid(), repo = createDemoWeekReviewsRepository(storage(patientId))
    await expect(repo.save({ requestId: uuid(), patientId: uuid(), expectedVersion: 0, entries: [entry()] })).rejects.toThrow('수급자')
    await expect(repo.save({ requestId: uuid(), patientId, expectedVersion: 0, entries: [entry({ digest: '' })] })).rejects.toThrow()
    expect((await repo.inspectMonth('2026-10')).patients).toEqual([])
  })
})
