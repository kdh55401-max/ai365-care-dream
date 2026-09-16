import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import { fetchAll, isMissingSchema } from './workflowStore.js'
import { toCenterRequestView, type CenterRequestView, type CenterResponseResult } from '../../shared/fieldRequests.js'
import { isRequestVisibleTo, RESPONSE_STATUSES, type ActionObligation, type ActionVerification, type FieldRequest, type FieldResponse, type ResponseStatus } from '../../shared/workflow.js'

/** 3단계(현장 요청·응답·결과 확인) 저장소 접근. db/migrations/2026-09-16-field-requests.sql 필요. */

const TABLES = ['field_requests', 'field_responses', 'action_verifications'] as const
let readyConfirmed = false

/** 3단계 테이블이 모두 있는지. 없으면 게시·응답·결과 확인을 "준비 중"으로 둔다(가짜 0 없음). */
export async function fieldRequestsReady(supabase: SupabaseClient): Promise<boolean> {
  if (readyConfirmed) return true
  const results = await Promise.all(TABLES.map((t) => supabase.from(t).select('id', { head: true }).limit(1)))
  for (const r of results) {
    if (r.error) {
      if (isMissingSchema(r.error)) return false
      throw new ApiError(500, '현장 요청 저장소 상태를 확인하지 못했습니다.')
    }
  }
  readyConfirmed = true
  return true
}

export interface FieldRows {
  requests: FieldRequest[]
  responses: FieldResponse[]
  verifications: ActionVerification[]
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** 조치들에 딸린 요청·응답·결과 확인. actionIds를 주지 않으면 기관 전체. */
export async function loadFieldRows(supabase: SupabaseClient, organizationId: string, actionIds?: string[]): Promise<FieldRows> {
  if (actionIds && actionIds.length === 0) return { requests: [], responses: [], verifications: [] }
  const byActions = async <T>(table: string, orderBy: string, byOrg: boolean): Promise<T[]> => {
    const build = (ids?: string[]) => () => {
      let q = supabase.from(table).select('*')
      if (byOrg) q = q.eq('organization_id', organizationId)
      if (ids) q = q.in('action_id', ids)
      return q.order(orderBy, { ascending: true }).order('id', { ascending: true })
    }
    if (!actionIds) return fetchAll<T>(build(), table)
    return (await Promise.all(chunk(actionIds, 200).map((ids) => fetchAll<T>(build(ids), table)))).flat()
  }
  const [requests, responses, verifications] = await Promise.all([
    byActions<FieldRequest>('field_requests', 'published_at', true),
    // 응답·결과 확인은 요청/조치에 딸린 기록이라 기관 컬럼이 없다(조치 id로 범위를 좁힌다).
    byActions<FieldResponse>('field_responses', 'submitted_at', false),
    byActions<ActionVerification>('action_verifications', 'verified_at', false),
  ])
  if (!actionIds) {
    // 기관 전체 조회일 때도 응답·결과 확인은 이 기관 조치에 딸린 것만 남긴다.
    const own = new Set(requests.map((r) => r.action_id))
    // (결과 확인은 요청 없는 관리자 직접 조치에도 달리므로 여기서 걸러 내지 않는다 — 기관 범위가
    //  꼭 필요한 호출부는 actionIds를 넘긴다. 6단계 운영 지표가 그렇게 쓴다.)
    return { requests, responses: responses.filter((r) => own.has(r.action_id)), verifications }
  }
  return { requests, responses, verifications }
}

/** 수급자별 현재 활성 배정 요양보호사. */
export async function loadAssigneesByRecipient(supabase: SupabaseClient, recipientCode?: string): Promise<Record<string, string[]>> {
  const rows = await fetchAll<{ caregiver_code: string; recipient_code: string }>(() => {
    let q = supabase.from('caregiver_assignments').select('caregiver_code, recipient_code').eq('active', true)
    if (recipientCode) q = q.eq('recipient_code', recipientCode)
    return q.order('recipient_code', { ascending: true }).order('caregiver_code', { ascending: true })
  }, '배정')
  const out: Record<string, string[]> = {}
  for (const r of rows) (out[r.recipient_code] ??= []).push(r.caregiver_code)
  return out
}

async function assignedRecipients(supabase: SupabaseClient, caregiverCode: string): Promise<string[]> {
  const { data, error } = await supabase.from('caregiver_assignments').select('recipient_code').eq('caregiver_code', caregiverCode).eq('active', true)
  if (error) throw new ApiError(500, '배정 정보를 불러오지 못했습니다.')
  return (data ?? []).map((r: { recipient_code: string }) => r.recipient_code)
}

/** 요양보호사에게 보일 게시 요청(공개 문구·기한만). 배정·지정 대상을 서버가 확인한다. */
export async function listCenterRequestsFor(supabase: SupabaseClient, caregiverCode: string, recipientCode: string): Promise<{ ready: boolean; requests: CenterRequestView[] }> {
  if (!(await fieldRequestsReady(supabase))) return { ready: false, requests: [] }
  const mine = await assignedRecipients(supabase, caregiverCode)
  if (!mine.includes(recipientCode)) throw new ApiError(403, '배정되지 않은 수급자입니다.')
  const { data, error } = await supabase
    .from('field_requests')
    .select('id, recipient_code, message, published_at, target_mode, target_caregiver_code, status, obligation_id')
    .eq('recipient_code', recipientCode)
    .eq('status', 'published')
    .order('published_at', { ascending: true })
  if (error) throw new ApiError(500, '센터 요청을 불러오지 못했습니다.')
  const visible = ((data ?? []) as FieldRequest[]).filter((r) => isRequestVisibleTo(r, caregiverCode, mine))
  if (visible.length === 0) return { ready: true, requests: [] }
  const { data: obs } = await supabase.from('action_obligations').select('id, current_due_kind, current_due_at').in('id', visible.map((r) => r.obligation_id))
  const byId = new Map(((obs ?? []) as ActionObligation[]).map((o) => [o.id, o]))
  return { ready: true, requests: visible.map((r) => toCenterRequestView(r, byId.get(r.obligation_id) ?? null)) }
}

/** 요양보호사 화면에 실제로 표시된 요청의 첫 표시 시각을 한 번만 남긴다(보이는 요청만). */
export async function markRequestsShown(supabase: SupabaseClient, caregiverCode: string, requestIds: string[]): Promise<void> {
  if (requestIds.length === 0 || !(await fieldRequestsReady(supabase))) return
  const { data, error } = await supabase
    .from('field_requests')
    .select('id, recipient_code, target_mode, target_caregiver_code, status')
    .in('id', requestIds.slice(0, 20))
  if (error) throw new ApiError(500, '센터 요청 표시 기록을 남기지 못했습니다.')
  const mine = await assignedRecipients(supabase, caregiverCode)
  const ids = ((data ?? []) as FieldRequest[]).filter((r) => isRequestVisibleTo(r, caregiverCode, mine)).map((r) => r.id)
  if (ids.length === 0) return
  const { error: updateError } = await supabase
    .from('field_requests')
    .update({ first_shown_at: new Date().toISOString(), first_shown_to: caregiverCode })
    .in('id', ids)
    .is('first_shown_at', null)
  if (updateError) throw new ApiError(500, '센터 요청 표시 기록을 남기지 못했습니다.')
}

export interface CenterResponseInput {
  fieldRequestId: string
  status: ResponseStatus
  text?: string | null
  evidenceExcerpt?: string | null
  requestId: string
}

export function parseCenterResponses(v: unknown): CenterResponseInput[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 10).flatMap((x) => {
    if (!x || typeof x !== 'object') return []
    const r = x as Record<string, unknown>
    const status = String(r.status ?? '')
    if (!(RESPONSE_STATUSES as readonly string[]).includes(status)) return []
    if (typeof r.fieldRequestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(r.fieldRequestId) || typeof r.requestId !== 'string') return []
    const clip = (s: unknown) => (typeof s === 'string' ? s.slice(0, 1000) : null)
    return [{ fieldRequestId: r.fieldRequestId, status: status as ResponseStatus, text: clip(r.text), evidenceExcerpt: clip(r.evidenceExcerpt), requestId: r.requestId.slice(0, 200) }]
  })
}


/** 제출된 보고에 현장 응답을 붙인다 — 권한·상태 판단은 DB 함수가 잠근 뒤 최신 상태로 다시 한다. */
export async function recordCenterResponses(supabase: SupabaseClient, caregiverCode: string, reportId: string, inputs: CenterResponseInput[]): Promise<CenterResponseResult[]> {
  if (inputs.length === 0) return []
  if (!(await fieldRequestsReady(supabase))) return inputs.map((i) => ({ fieldRequestId: i.fieldRequestId, status: 'not_ready' as const }))
  const results: CenterResponseResult[] = []
  for (const input of inputs) {
    const { data, error } = await supabase.rpc('workflow_record_field_response', {
      p: {
        response_id: crypto.randomUUID(),
        event_id: crypto.randomUUID(),
        field_request_id: input.fieldRequestId,
        report_id: reportId,
        responder_code: caregiverCode,
        response_status: input.status,
        response_text: input.text ?? null,
        evidence_excerpt: input.evidenceExcerpt ?? null,
        evidence_source: input.evidenceExcerpt ? 'report_text' : input.text ? 'typed' : null,
        request_id: input.requestId,
      },
    })
    if (error) {
      if (isMissingSchema(error)) {
        results.push({ fieldRequestId: input.fieldRequestId, status: 'not_ready' })
        continue
      }
      console.error('workflow_record_field_response 실패:', error.code)
      throw new ApiError(502, '보고는 저장됐지만 센터 요청 답변을 저장하지 못했어요. 다시 시도해 주세요(보고가 두 번 저장되지 않아요).')
    }
    const r = data as { status: CenterResponseResult['status']; message?: string; fulfilled_obligation?: boolean }
    results.push({ fieldRequestId: input.fieldRequestId, status: r.status, message: r.message, fulfilledObligation: r.fulfilled_obligation })
  }
  return results
}
