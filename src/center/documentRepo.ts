import {
  parseCenterDocumentMutation,
  applyCenterDocumentMutation,
  type CenterDocument,
  type CenterDocumentMutation,
} from '../../shared/centerDocuments'

export interface DocumentRepository {
  list(): Promise<CenterDocument[]>
  mutate(input: CenterDocumentMutation): Promise<CenterDocument>
}

export class DocumentRepositoryError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown>
  try { body = await response.json() as Record<string, unknown> }
  catch { throw new DocumentRepositoryError('서버 응답을 읽지 못했습니다. 입력 내용을 보존했습니다.', response.status) }
  if (!response.ok) throw new DocumentRepositoryError(typeof body.error === 'string' ? body.error : '문서 요청을 처리하지 못했습니다.', response.status)
  return body
}

export const serverDocumentRepository: DocumentRepository = {
  async list() {
    const body = await responseBody(await fetch('/api/center/documents', { credentials: 'same-origin' }))
    if (!Array.isArray(body.documents)) throw new DocumentRepositoryError('문서 목록 응답 형식이 올바르지 않습니다.', 502)
    return body.documents as CenterDocument[]
  },
  async mutate(input) {
    const body = await responseBody(await fetch('/api/center/documents', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }))
    if (!body.document || typeof body.document !== 'object') throw new DocumentRepositoryError('저장 결과를 확인하지 못했습니다. 문서 목록을 다시 조회하세요.', 502)
    return body.document as CenterDocument
  },
}

export const DEMO_DOCUMENT_STORAGE_KEY = 'gadream365:center-documents:demo:v1'
type DemoLedger = { documents: CenterDocument[]; requests: Record<string, { payload: string; document: CenterDocument }> }

/** Fictitious demonstration only. Never used as a server-error fallback. */
export function createDemoDocumentRepository(storage: Pick<Storage, 'getItem' | 'setItem'>): DocumentRepository {
  function read(): DemoLedger {
    const raw = storage.getItem(DEMO_DOCUMENT_STORAGE_KEY)
    if (!raw) return { documents: [], requests: {} }
    let value: DemoLedger
    try { value = JSON.parse(raw) as DemoLedger }
    catch { throw new DocumentRepositoryError('시연 문서 저장소를 읽지 못했습니다. 기존 자료를 지우지 않았습니다.', 500) }
    if (!Array.isArray(value.documents) || !value.requests || typeof value.requests !== 'object'
      || value.documents.some(d => !d || d.organizationCode !== 'DEMO' || !Number.isInteger(d.version) || !['draft', 'confirmed'].includes(d.status))) {
      throw new DocumentRepositoryError('시연 문서 저장소 형식이 다릅니다. 기존 자료를 보존했습니다.', 500)
    }
    return value
  }
  return {
    async list() { return read().documents },
    async mutate(input) {
      const mutation = parseCenterDocumentMutation(input as unknown as Record<string, unknown>)
      const state = read()
      const payload = JSON.stringify(mutation)
      const previous = state.requests[mutation.requestId]
      if (previous) {
        if (previous.payload !== payload) throw new DocumentRepositoryError('같은 요청 번호의 내용이 달라졌습니다. 문서를 다시 조회하세요.', 409)
        return previous.document
      }
      const now = new Date().toISOString()
      const existing = mutation.action === 'create' ? null : state.documents.find(d => d.id === mutation.id) ?? null
      const document = applyCenterDocumentMutation(existing, mutation, {
        organizationCode: 'DEMO', documentId: mutation.action === 'create' ? crypto.randomUUID() : mutation.id, now,
      })
      state.documents = [document, ...state.documents.filter(d => d.id !== document.id)]
      state.requests[mutation.requestId] = { payload, document }
      // Persist first: quota/storage failure must not be reported as a successful save.
      storage.setItem(DEMO_DOCUMENT_STORAGE_KEY, JSON.stringify(state))
      return document
    },
  }
}
