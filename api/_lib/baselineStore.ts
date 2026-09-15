import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import { fetchAll, isMissingSchema, type RpcResult } from './workflowStore.js'
import {
  DOCUMENT_BUCKET,
  DOCUMENT_FORMAT_HINT,
  MAX_DOCUMENT_BYTES,
  type ActionBaselineLink,
  type BaselineEntry,
  type ReferenceChoice,
  type SourceDocument,
} from '../../shared/baseline.js'

/** 4단계(기준문서·기준정보) 저장소 접근. db/migrations/2026-09-17-source-documents.sql 필요.
 * 원본 파일은 비공개 버킷에 서버(Service Role)만 읽고 쓴다 — 브라우저는 Supabase에 직접 접근하지 않는다. */

const TABLES = ['source_documents', 'baseline_entries', 'baseline_reference_choices', 'action_baseline_links'] as const
let tablesConfirmed = false
let storageConfirmed = false

export async function baselineReady(supabase: SupabaseClient): Promise<boolean> {
  if (tablesConfirmed) return true
  const results = await Promise.all(TABLES.map((t) => supabase.from(t).select('id', { head: true }).limit(1)))
  for (const r of results) {
    if (r.error) {
      if (isMissingSchema(r.error)) return false
      throw new ApiError(500, '기준정보 저장소 상태를 확인하지 못했습니다.')
    }
  }
  tablesConfirmed = true
  return true
}

/** 비공개 버킷이 있는지(공개 버킷이면 쓰지 않는다 — 원본이 주소만으로 열리면 안 됨). */
export async function storageReady(supabase: SupabaseClient): Promise<boolean> {
  if (storageConfirmed) return true
  const { data, error } = await supabase.storage.getBucket(DOCUMENT_BUCKET)
  if (error || !data) return false
  if (data.public) {
    console.error('care-source-documents 버킷이 공개로 설정돼 있어 사용하지 않습니다.')
    return false
  }
  storageConfirmed = true
  return true
}

export interface RecipientBaselineRows {
  documents: SourceDocument[]
  entries: BaselineEntry[]
  choices: ReferenceChoice[]
}

export async function loadRecipientBaselineRows(supabase: SupabaseClient, organizationId: string, recipientCode: string): Promise<RecipientBaselineRows> {
  const [documents, entries, choices] = await Promise.all([
    fetchAll<SourceDocument>(() => supabase.from('source_documents').select('*').eq('organization_id', organizationId).eq('recipient_code', recipientCode).order('uploaded_at', { ascending: true }).order('id', { ascending: true }), '기준문서'),
    fetchAll<BaselineEntry>(() => supabase.from('baseline_entries').select('*').eq('organization_id', organizationId).eq('recipient_code', recipientCode).order('created_at', { ascending: true }).order('id', { ascending: true }), '기준정보'),
    fetchAll<ReferenceChoice>(() => supabase.from('baseline_reference_choices').select('*').eq('organization_id', organizationId).eq('recipient_code', recipientCode).order('chosen_at', { ascending: true }).order('id', { ascending: true }), '참고값 선택'),
  ])
  return { documents, entries, choices }
}

export async function loadActionLinks(supabase: SupabaseClient, actionId: string): Promise<ActionBaselineLink[]> {
  return fetchAll<ActionBaselineLink>(() => supabase.from('action_baseline_links').select('*').eq('action_id', actionId).order('linked_at', { ascending: true }).order('id', { ascending: true }), '근거 연결')
}

export async function loadDocument(supabase: SupabaseClient, organizationId: string, id: string): Promise<SourceDocument> {
  const { data, error } = await supabase.from('source_documents').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle()
  if (error) throw new ApiError(500, '문서를 불러오지 못했습니다.')
  if (!data) throw new ApiError(404, '이 기관에서 해당 문서를 찾을 수 없습니다.')
  return data as SourceDocument
}

export async function findDocumentByRequest(supabase: SupabaseClient, organizationId: string, requestId: string): Promise<SourceDocument | null> {
  const { data, error } = await supabase.from('source_documents').select('*').eq('request_id', requestId).eq('organization_id', organizationId).maybeSingle()
  if (error) throw new ApiError(500, '문서 저장 상태를 확인하지 못했습니다.')
  return (data as SourceDocument | null) ?? null
}

export async function loadEntry(supabase: SupabaseClient, organizationId: string, id: string): Promise<BaselineEntry> {
  const { data, error } = await supabase.from('baseline_entries').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle()
  if (error) throw new ApiError(500, '기준정보를 불러오지 못했습니다.')
  if (!data) throw new ApiError(404, '이 기관에서 해당 기준정보를 찾을 수 없습니다.')
  return data as BaselineEntry
}

export async function loadLineage(supabase: SupabaseClient, organizationId: string, lineageId: string): Promise<BaselineEntry[]> {
  const { data, error } = await supabase.from('baseline_entries').select('*').eq('lineage_id', lineageId).eq('organization_id', organizationId).order('version', { ascending: true })
  if (error) throw new ApiError(500, '기준정보 이력을 불러오지 못했습니다.')
  return (data ?? []) as BaselineEntry[]
}

/** 원본 파일 본문을 읽는다(한도 초과는 413 — 일부만 저장되지 않게 받기 전에 끊는다). */
export async function readRawBody(req: IncomingMessage, limit = MAX_DOCUMENT_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new ApiError(413, `파일이 너무 큽니다(${DOCUMENT_FORMAT_HINT}).`)
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function putOriginal(supabase: SupabaseClient, path: string, bytes: Buffer, mime: string): Promise<void> {
  // 같은 요청의 재시도는 같은 경로에 덮어쓴다(파일만 남고 기록이 없던 실패를 한 벌로 정리).
  const { error } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, bytes, { contentType: mime, upsert: true })
  if (error) {
    console.error('원본 저장 실패:', error.message)
    throw new ApiError(502, '원본 파일을 저장하지 못했습니다. 기록은 만들지 않았습니다 — 다시 시도해 주세요.')
  }
}

export async function removeOriginal(supabase: SupabaseClient, path: string): Promise<void> {
  const { error } = await supabase.storage.from(DOCUMENT_BUCKET).remove([path])
  if (error) console.error('기록 없이 남은 원본 정리 실패(다음 같은 요청 재시도 때 덮어씀):', error.message)
}

export async function getOriginal(supabase: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(path)
  if (error || !data) {
    console.error('원본 읽기 실패:', error?.message)
    throw new ApiError(502, '원본 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return Buffer.from(await data.arrayBuffer())
}

export async function callBaselineRpc(supabase: SupabaseClient, payload: Record<string, unknown>): Promise<RpcResult & { id?: string }> {
  const { data, error } = await supabase.rpc('baseline_apply', { p: payload })
  if (error) {
    if (isMissingSchema(error)) throw new ApiError(503, '기준정보 저장소가 아직 준비되지 않았습니다(4단계 DB 마이그레이션 적용 필요).')
    console.error('baseline_apply 실패:', error.message)
    throw new ApiError(500, '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return data as RpcResult & { id?: string }
}
