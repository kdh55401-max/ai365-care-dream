import { describe, expect, it, vi } from 'vitest'
import { createDocumentController } from './documentController'
import type { DocumentRepository } from './documentRepo'
import type { CenterDocument } from '../../shared/centerDocuments'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function doc(id: string, title: string, version = 1): CenterDocument {
  return {
    id, organizationCode: 'DEMO', status: 'draft', version, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', confirmedAt: null,
    templateId: 'staff-meeting', title, subjectKind: 'agency', subjectId: null, period: '2026-07', content: '가상 입력', resultEvaluationCompleted: false,
  }
}
/** list() 호출마다 제어 가능한 deferred를 하나씩 쌓는다. */
function controlledRepo() {
  const lists: ReturnType<typeof deferred<CenterDocument[]>>[] = []
  const repository: DocumentRepository = {
    list: vi.fn(() => { const d = deferred<CenterDocument[]>(); lists.push(d); return d.promise }),
    mutate: vi.fn(async () => { throw new Error('mutate는 이 시험에서 호출하지 않는다') }),
  }
  return { repository, lists }
}

describe('센터 문서 컨트롤러 비동기 순서', () => {
  it('저장 직후 늦게 도착한 이전 목록 응답은 저장한 문서를 지우지 못한다', async () => {
    const { repository, lists } = controlledRepo()
    const controller = createDocumentController(repository)
    const pending = controller.reload()
    expect(controller.snapshot().loading).toBe(true)

    const saved = doc('saved', '방금 저장한 문서')
    controller.saved(saved)
    expect(controller.snapshot()).toEqual({ documents: [saved], loading: false, error: '' })

    lists[0].resolve([doc('old', '저장 전 목록')])
    await pending
    expect(controller.snapshot()).toEqual({ documents: [saved], loading: false, error: '' })
  })

  it('저장 직후 늦게 도착한 이전 목록 오류도 저장된 화면을 오류로 바꾸지 않는다', async () => {
    const { repository, lists } = controlledRepo()
    const controller = createDocumentController(repository)
    const pending = controller.reload()
    const saved = doc('saved', '방금 저장한 문서')
    controller.saved(saved)

    lists[0].reject(new Error('늦은 실패'))
    await pending
    expect(controller.snapshot()).toEqual({ documents: [saved], loading: false, error: '' })
  })

  it('저장은 같은 id의 이전 문서를 대체하고 맨 앞에 둔다', async () => {
    const { repository, lists } = controlledRepo()
    const controller = createDocumentController(repository)
    const pending = controller.reload()
    lists[0].resolve([doc('a', 'A v1'), doc('b', 'B v1')])
    await pending

    const revised = doc('b', 'B v2', 2)
    controller.saved(revised)
    expect(controller.snapshot().documents.map(d => `${d.id}:${d.version}`)).toEqual(['b:2', 'a:1'])
  })

  it('연속 새로고침에서 응답 순서가 뒤바뀌어도 최신 요청의 결과를 유지한다', async () => {
    const { repository, lists } = controlledRepo()
    const controller = createDocumentController(repository)
    const first = controller.reload()
    const second = controller.reload()
    expect(lists).toHaveLength(2)

    const latest = [doc('new', '최신 목록')]
    lists[1].resolve(latest)
    await second
    expect(controller.snapshot()).toEqual({ documents: latest, loading: false, error: '' })

    lists[0].resolve([doc('stale', '먼저 보낸 낡은 목록')])
    await first
    expect(controller.snapshot()).toEqual({ documents: latest, loading: false, error: '' })
  })

  it('먼저 보낸 요청이 늦게 실패해도 최신 성공 결과를 오류로 덮지 않는다', async () => {
    const { repository, lists } = controlledRepo()
    const controller = createDocumentController(repository)
    const first = controller.reload()
    const second = controller.reload()

    const latest = [doc('new', '최신 목록')]
    lists[1].resolve(latest)
    await second
    lists[0].reject(new Error('먼저 보낸 요청의 늦은 실패'))
    await first
    expect(controller.snapshot()).toEqual({ documents: latest, loading: false, error: '' })
  })

  it('최신 요청이 실패하면 오류를 보이고, 그 뒤 도착한 낡은 성공은 오류를 지우지 못한다', async () => {
    const { repository, lists } = controlledRepo()
    const controller = createDocumentController(repository)
    const first = controller.reload()
    const second = controller.reload()

    lists[1].reject(new Error('최신 요청 실패'))
    await second
    expect(controller.snapshot()).toEqual({ documents: [], loading: false, error: '최신 요청 실패' })

    lists[0].resolve([doc('stale', '낡은 목록')])
    await first
    expect(controller.snapshot()).toEqual({ documents: [], loading: false, error: '최신 요청 실패' })
  })

  it('cancel 이후 도착한 성공·실패 응답은 모두 무시한다', async () => {
    const { repository, lists } = controlledRepo()
    const controller = createDocumentController(repository)
    const listener = vi.fn()
    const successRequest = controller.reload()
    controller.subscribe(listener)
    const beforeCancel = controller.snapshot()
    controller.cancel()

    lists[0].resolve([doc('late', '취소 뒤 도착')])
    await successRequest
    expect(controller.snapshot()).toBe(beforeCancel)
    expect(listener).not.toHaveBeenCalled()

    const failureRequest = controller.reload()
    listener.mockClear()
    controller.cancel()
    lists[1].reject(new Error('취소 뒤 실패'))
    await failureRequest
    expect(controller.snapshot().error).toBe('')
    expect(controller.snapshot().documents).toEqual([])
    expect(listener).not.toHaveBeenCalled()
  })

  it('구독 해제 뒤에는 알림을 보내지 않고 남은 구독자에게만 알린다', async () => {
    const { repository, lists } = controlledRepo()
    const controller = createDocumentController(repository)
    const removed = vi.fn()
    const kept = vi.fn()
    const unsubscribe = controller.subscribe(removed)
    controller.subscribe(kept)

    const pending = controller.reload()
    expect(removed).toHaveBeenCalledTimes(1)
    unsubscribe()
    removed.mockClear()
    kept.mockClear()

    lists[0].resolve([doc('a', '해제 뒤 도착')])
    await pending
    controller.saved(doc('b', '해제 뒤 저장'))
    expect(removed).not.toHaveBeenCalled()
    expect(kept).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().documents.map(d => d.id)).toEqual(['b', 'a'])
  })

  it('목록 오류에 메시지가 없으면 기본 안내를 보이고 이후 재시도 성공은 오류를 지운다', async () => {
    const { repository, lists } = controlledRepo()
    const controller = createDocumentController(repository)
    const failed = controller.reload()
    lists[0].reject('문자열 실패')
    await failed
    expect(controller.snapshot()).toEqual({ documents: [], loading: false, error: '문서 저장소에 연결하지 못했습니다.' })

    const retry = controller.reload()
    expect(controller.snapshot().error).toBe('')
    expect(controller.snapshot().loading).toBe(true)
    const listed = [doc('a', '재시도 성공')]
    lists[1].resolve(listed)
    await retry
    expect(controller.snapshot()).toEqual({ documents: listed, loading: false, error: '' })
  })
})

it('로그아웃 초기화는 문서와 늦은 조회 결과를 비운다',async()=>{const {repository,lists}=controlledRepo();const c=createDocumentController(repository);c.saved(doc('a','가상 이전문서'));const pending=c.reload();c.reset();lists[0].resolve([doc('late','늦은 문서')]);await pending;expect(c.snapshot().documents).toEqual([]);expect(c.snapshot().error).toBe('')})
