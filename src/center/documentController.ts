import type { CenterDocument } from '../../shared/centerDocuments'
import type { DocumentRepository } from './documentRepo'

export function createDocumentController(repository: DocumentRepository) {
  let state = { documents: [] as CenterDocument[], loading: true, error: '' }
  let generation = 0
  const listeners = new Set<() => void>()
  function publish(next: typeof state) { state = next; for (const listener of listeners) listener() }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    cancel() { generation++ },
    reset() { generation++; publish({ documents: [], loading: true, error: '' }) },
    async reload() {
      const token = ++generation
      publish({ ...state, loading: true, error: '' })
      try {
        const documents = await repository.list()
        if (generation === token) publish({ documents, loading: false, error: '' })
      } catch (failure) {
        if (generation === token) publish({ documents: [], loading: false, error: failure instanceof Error ? failure.message : '문서 저장소에 연결하지 못했습니다.' })
      }
    },
    saved(document: CenterDocument) {
      generation++
      publish({ documents: [document, ...state.documents.filter(d => d.id !== document.id)], loading: false, error: '' })
    },
  }
}
