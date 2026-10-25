import type { SupabaseClient } from '@supabase/supabase-js'
import type { CenterDocument, CenterDocumentMutation } from '../../shared/centerDocuments.js'
import { ApiError } from './http.js'

interface DocumentRow {
  id: string; organization_code: string; template_id: string; title: string
  subject_kind: CenterDocument['subjectKind']; subject_id: string | null; period: string; content: string
  result_evaluation_completed: boolean; status: CenterDocument['status']; version: number
  created_at: string; updated_at: string; confirmed_at: string | null
}
function documentFromRow(row: DocumentRow): CenterDocument {
  return { id: row.id, organizationCode: row.organization_code, templateId: row.template_id, title: row.title,
    subjectKind: row.subject_kind, subjectId: row.subject_id, period: row.period, content: row.content,
    resultEvaluationCompleted: row.result_evaluation_completed, status: row.status, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at }
}
function storeError(error: { code?: string; message?: string }): never {
  const code = error.message?.match(/^CENTER_DOC_(400|403|404|409|503)\b/)?.[1]
  if (code) throw new ApiError(Number(code), ({ '400': '문서 입력과 본문을 확인하세요.', '403': '현재 기관에서 문서 업무를 사용할 수 없습니다.', '404': '이 기관의 문서를 찾지 못했습니다.', '409': '문서가 변경·확정되었거나 같은 요청번호가 다른 내용에 사용됐습니다. 최신 문서를 다시 열어주세요.', '503': '센터 문서 저장소가 아직 준비되지 않았습니다.' } as Record<string, string>)[code])
  if (error.code === '23505') throw new ApiError(409, '중복 문서 요청입니다. 최신 문서를 다시 열어주세요.')
  throw new ApiError(503, '센터 문서 저장소가 아직 준비되지 않았거나 응답하지 않습니다.')
}
export async function assertCenterOrganizationReady(db: SupabaseClient, organizationCode: string) {
  const { data, error } = await db.from('center_organizations').select('code').eq('code', organizationCode).eq('active', true).maybeSingle()
  if (error) storeError(error)
  if (!data) throw new ApiError(403, '현재 기관에서 문서 업무를 사용할 수 없습니다.')
}
export async function loadCenterDocuments(db: SupabaseClient, organizationCode: string): Promise<CenterDocument[]> {
  const documents: CenterDocument[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('center_documents').select('*').eq('organization_code', organizationCode).order('created_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + 499)
    if (error) storeError(error)
    const rows = (data || []) as DocumentRow[]
    documents.push(...rows.map(documentFromRow))
    if (rows.length < 500) return documents
    if (documents.length >= 10_000) throw new ApiError(503, '센터 문서 목록이 조회 한도를 넘었습니다. 기간별 조회 기능이 필요합니다.')
  }
}
export async function mutateCenterDocument(db: SupabaseClient, organizationCode: string, actorId: string, mutation: CenterDocumentMutation): Promise<CenterDocument> {
  const { data, error } = await db.rpc('mutate_center_document', { p_organization_code: organizationCode, p_actor_id: actorId, p_mutation: mutation })
  if (error) storeError(error)
  if (!data || typeof data !== 'object' || !data.id || data.organization_code !== organizationCode) throw new ApiError(503, '저장 결과를 확인하지 못했습니다. 같은 요청번호로 다시 시도하세요.')
  return documentFromRow(data as DocumentRow)
}
