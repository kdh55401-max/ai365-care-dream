import { parseStateChange, stateChangeProblems } from './centerStateChange.js'
export type CenterSubjectKind = 'agency' | 'worker' | 'patient'
export interface CenterDocumentTemplate {
  id: string
  label: string
  subjectKinds: CenterSubjectKind[]
  cadence: 'monthly' | 'quarterly' | 'half-yearly' | 'occasional'
  requiresResultEvaluation: boolean
}
export const CENTER_DOCUMENT_TEMPLATES: CenterDocumentTemplate[] = [
  { id: 'case-management', label: '사례관리 + 평가기록지', subjectKinds: ['agency'], cadence: 'half-yearly', requiresResultEvaluation: true },
  { id: 'staff-meeting', label: '직원회의록', subjectKinds: ['agency'], cadence: 'monthly', requiresResultEvaluation: false },
  { id: 'training-record', label: '교육일지', subjectKinds: ['agency'], cadence: 'occasional', requiresResultEvaluation: false },
  { id: 'service-record', label: '급여제공기록지', subjectKinds: ['patient'], cadence: 'monthly', requiresResultEvaluation: false },
  { id: 'state-change-record', label: '상태변화기록지', subjectKinds: ['patient'], cadence: 'monthly', requiresResultEvaluation: false },
  { id: 'service-result-evaluation', label: '급여제공 결과평가', subjectKinds: ['patient'], cadence: 'monthly', requiresResultEvaluation: false },
]
export interface CenterDocumentFields {
  templateId: string
  title: string
  subjectKind: CenterSubjectKind
  subjectId: string | null
  period: string
  content: string
  resultEvaluationCompleted: boolean
}
export interface CenterDocument extends CenterDocumentFields {
  id: string
  organizationCode: string
  status: 'draft' | 'confirmed'
  version: number
  createdAt: string
  updatedAt: string
  confirmedAt: string | null
}
export type CenterDocumentMutation =
  | ({ action: 'create'; requestId: string } & CenterDocumentFields)
  | ({ action: 'revise'; requestId: string; id: string; expectedVersion: number } & CenterDocumentFields)
  | { action: 'confirm'; requestId: string; id: string; expectedVersion: number }
export class CenterDocumentError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function identifier(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new CenterDocumentError(400, '문서와 요청 식별자를 확인하세요.')
  return value.toLowerCase()
}
export function parseCenterDocumentMutation(input: Record<string, unknown>): CenterDocumentMutation {
  const action = input.action
  if (action !== 'create' && action !== 'revise' && action !== 'confirm') throw new CenterDocumentError(400, '지원하지 않는 문서 동작입니다.')
  const baseKeys = ['action', 'requestId', ...(action === 'create' ? [] : ['id', 'expectedVersion'])]
  const fieldKeys = ['templateId','title','subjectKind','subjectId','period','content','resultEvaluationCompleted']
  const allowed = [...baseKeys, ...(action === 'confirm' ? [] : fieldKeys)]
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new CenterDocumentError(400, '지원하지 않는 문서 입력 항목입니다.')
  const requestId = identifier(input.requestId)
  let current: { id: string; expectedVersion: number } | undefined
  if (action !== 'create') {
    if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) throw new CenterDocumentError(400, '조회한 문서 버전이 필요합니다.')
    current = { id: identifier(input.id), expectedVersion: Number(input.expectedVersion) }
  }
  if (action === 'confirm') return { action, requestId, ...current! }
  const template = CENTER_DOCUMENT_TEMPLATES.find(item => item.id === input.templateId)
  if (!template || !template.subjectKinds.includes(input.subjectKind as CenterSubjectKind)) throw new CenterDocumentError(400, '양식과 대상 종류를 확인하세요.')
  const subjectKind = input.subjectKind as CenterSubjectKind
  const subjectId = input.subjectId === undefined ? null : input.subjectId
  if (subjectKind === 'agency' ? subjectId !== null : typeof subjectId !== 'string' || !subjectId.trim() || subjectId.length > 100) throw new CenterDocumentError(400, '문서 대상 식별자를 확인하세요.')
  if (subjectKind === 'patient') identifier(subjectId)
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) throw new CenterDocumentError(400, '문서 제목은 1~200자로 입력하세요.')
  if (typeof input.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period) || Number(input.period.slice(0,4)) < 1900) throw new CenterDocumentError(400, '문서 기준월을 YYYY-MM으로 입력하세요.')
  if (typeof input.content !== 'string' || input.content.length > 80_000 || input.content.includes('\0')) throw new CenterDocumentError(400, '문서 본문은 80,000자 이내 일반 텍스트로 입력하세요.')
  if (template.id === 'state-change-record') {
    const record = parseStateChange(input.content)
    if (record) {
      const problems = stateChangeProblems(record, input.period)
      if (problems.length) throw new CenterDocumentError(400, problems.join(' '))
    }
  }
  if (typeof input.resultEvaluationCompleted !== 'boolean' || (!template.requiresResultEvaluation && input.resultEvaluationCompleted)) throw new CenterDocumentError(400, '결과평가 작성 여부를 확인하세요.')
  const fields: CenterDocumentFields = { templateId: template.id, title: input.title.trim(), subjectKind, subjectId: subjectId as string | null, period: input.period, content: input.content, resultEvaluationCompleted: input.resultEvaluationCompleted }
  return action === 'create' ? { action, requestId, ...fields } : { action, requestId, ...current!, ...fields }
}

/** Shared state transition for isolated demos and unit checks. Real writes use one DB transaction. */
export function applyCenterDocumentMutation(current: CenterDocument | null, mutation: CenterDocumentMutation, context: { organizationCode: string; documentId: string; now: string }): CenterDocument {
  const normalized = parseCenterDocumentMutation(mutation as unknown as Record<string, unknown>)
  if (normalized.action === 'create') {
    const { action: _action, requestId: _requestId, ...fields } = normalized
    return { ...fields, id: context.documentId, organizationCode: context.organizationCode, status: 'draft', version: 1, createdAt: context.now, updatedAt: context.now, confirmedAt: null }
  }
  if (!current || current.id !== normalized.id || current.organizationCode !== context.organizationCode) throw new CenterDocumentError(404, '이 기관의 문서를 찾지 못했습니다.')
  if (current.version !== normalized.expectedVersion || current.status !== 'draft') throw new CenterDocumentError(409, '문서가 변경되었거나 확정되었습니다. 최신 문서를 다시 열어주세요.')
  if (normalized.action === 'revise' && (current.templateId !== normalized.templateId || current.subjectKind !== normalized.subjectKind || current.subjectId !== normalized.subjectId)) throw new CenterDocumentError(409, '수급자 문서의 대상과 양식은 바꿀 수 없습니다. 새 문서를 작성하세요.')
  if (normalized.action === 'confirm') {
    if (!current.content.trim()) throw new CenterDocumentError(400, '본문을 작성하고 확인한 뒤 확정하세요.')
    return { ...current, status: 'confirmed', version: current.version + 1, updatedAt: context.now, confirmedAt: context.now }
  }
  const { action: _action, requestId: _requestId, id: _id, expectedVersion: _version, ...fields } = normalized
  return { ...current, ...fields, version: current.version + 1, updatedAt: context.now }
}

export interface CenterEvaluationPeriod { key: string; label: string; count: number; documentIds: string[] }
export interface CenterEvaluationSummary { templateId: string; periods: CenterEvaluationPeriod[] }
/** Caller must supply documents from a single authorized organization; no clinical/compliance scoring. */
export function summarizeCenterDocuments(documents: CenterDocument[], year: number): CenterEvaluationSummary[] {
  return CENTER_DOCUMENT_TEMPLATES.map(template => {
    const size = template.cadence === 'monthly' ? 12 : template.cadence === 'quarterly' ? 4 : template.cadence === 'half-yearly' ? 2 : 1
    const periods: CenterEvaluationPeriod[] = Array.from({length: size}, (_, i) => ({ key: template.cadence === 'monthly' ? `${year}-${String(i+1).padStart(2,'0')}` : `${year}-${template.cadence === 'quarterly' ? 'Q' : template.cadence === 'half-yearly' ? 'H' : 'Y'}${i+1}`, label: template.cadence === 'monthly' ? `${i+1}월` : template.cadence === 'quarterly' ? `${i+1}분기` : template.cadence === 'half-yearly' ? `${i+1}반기` : '연간', count: 0, documentIds: [] }))
    const seen = new Set<string>()
    for (const document of documents) {
      if (seen.has(document.id) || document.templateId !== template.id || !/^\d{4}-(0[1-9]|1[0-2])$/.test(document.period) || Number(document.period.slice(0,4)) !== year || (template.requiresResultEvaluation && document.resultEvaluationCompleted !== true)) continue
      seen.add(document.id)
      const month = Number(document.period.slice(5))
      const index = template.cadence === 'monthly' ? month-1 : template.cadence === 'quarterly' ? Math.ceil(month/3)-1 : template.cadence === 'half-yearly' ? (month <= 6 ? 0 : 1) : 0
      periods[index].documentIds.push(document.id)
      periods[index].count++
    }
    return { templateId: template.id, periods }
  })
}
