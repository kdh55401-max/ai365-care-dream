import { emptyStateChange, serializeStateChange } from '../../shared/centerStateChange'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoDocumentRepository, DEMO_DOCUMENT_STORAGE_KEY, serverDocumentRepository } from './documentRepo'
import type { CenterDocumentMutation } from '../../shared/centerDocuments'

function memory() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
}
const fields = { templateId: 'case-management', title: '가상 사례관리', subjectKind: 'agency' as const, subjectId: null, period: '2026-07', content: '가상 입력', resultEvaluationCompleted: false }
function create(): Extract<CenterDocumentMutation, { action: 'create' }> { return { action: 'create', requestId: crypto.randomUUID(), ...fields } }
afterEach(() => { vi.unstubAllGlobals() })
describe('센터 문서 저장 경계', () => {
  it('시연은 재진입 후에도 초안을 읽고 같은 요청 재전송은 중복 생성하지 않는다', async () => {
    const storage = memory()
    const first = createDemoDocumentRepository(storage)
    const request = create()
    const document = await first.mutate(request)
    expect(await first.mutate(request)).toEqual(document)
    expect(await createDemoDocumentRepository(storage).list()).toEqual([document])
    await expect(first.mutate({ ...request, title: '다른 입력' })).rejects.toThrow('같은 요청 번호')
  })
  it('두 편집자의 버전 충돌과 확정 후 수정을 거절한다', async () => {
    const storage = memory()
    const editorA = createDemoDocumentRepository(storage)
    const editorB = createDemoDocumentRepository(storage)
    const document = await editorA.mutate(create())
    const revision = await editorB.mutate({ action: 'revise', id: document.id, expectedVersion: 1, requestId: crypto.randomUUID(), ...fields, resultEvaluationCompleted: true })
    await expect(editorA.mutate({ action: 'confirm', id: document.id, expectedVersion: 1, requestId: crypto.randomUUID() })).rejects.toThrow('변경')
    const final = await editorA.mutate({ action: 'confirm', id: document.id, expectedVersion: revision.version, requestId: crypto.randomUUID() })
    expect(final.status).toBe('confirmed')
    await expect(editorB.mutate({ action: 'revise', id: document.id, expectedVersion: final.version, requestId: crypto.randomUUID(), ...fields })).rejects.toThrow('확정')
  })
  it('저장소 쓰기 실패를 성공으로 반환하지 않으며 이전 자료를 유지한다', async () => {
    const storage = memory()
    const repo = createDemoDocumentRepository(storage)
    const before = await repo.mutate(create())
    storage.setItem = () => { throw new Error('quota') }
    await expect(repo.mutate(create())).rejects.toThrow('quota')
    expect(await repo.list()).toEqual([before])
  })
  it('손상된 시연 자료를 지우지 않고 읽기 오류로 표시한다', async () => {
    const storage = memory()
    storage.setItem(DEMO_DOCUMENT_STORAGE_KEY, '{broken')
    await expect(createDemoDocumentRepository(storage).list()).rejects.toThrow('기존 자료')
    expect(storage.getItem(DEMO_DOCUMENT_STORAGE_KEY)).toBe('{broken')
  })
  it('운영 DB 미준비를 빈 목록이나 시연 성공으로 대체하지 않는다', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: '센터 문서 DB 준비 중' }), { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(serverDocumentRepository.list()).rejects.toThrow('DB 준비 중')
    await expect(serverDocumentRepository.mutate(create())).rejects.toThrow('DB 준비 중')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})


it('잘못된 주차 수정은 데모 저장본·버전·요청 장부를 바꾸지 않는다', async () => {
  const storage = memory(), repo = createDemoDocumentRepository(storage)
  const record = emptyStateChange()
  record.weeks[0] = { ...record.weeks[0], date: '2026-07-02', remarks: '가상 관찰: 이동 보조 후 휴식함.' }
  const patient = { ...fields, templateId: 'state-change-record', subjectKind: 'patient' as const, subjectId: '00000000-0000-0000-0000-000000000003' }
  const document = await repo.mutate({ action: 'create', requestId: crypto.randomUUID(), ...patient, content: serializeStateChange(record) })
  const before = storage.getItem(DEMO_DOCUMENT_STORAGE_KEY)
  const requestId = crypto.randomUUID()
  record.weeks[0].date = '2026-08-01'
  await expect(repo.mutate({ action: 'revise', id: document.id, expectedVersion: 1, requestId, ...patient, content: serializeStateChange(record) })).rejects.toThrow('기준월')
  expect(storage.getItem(DEMO_DOCUMENT_STORAGE_KEY)).toBe(before)
  expect(await createDemoDocumentRepository(storage).list()).toEqual([document])
  record.weeks[0].date = '2026-07-03'
  const revised = await repo.mutate({ action: 'revise', id: document.id, expectedVersion: 1, requestId, ...patient, content: serializeStateChange(record) })
  expect(revised.version).toBe(2)
})
