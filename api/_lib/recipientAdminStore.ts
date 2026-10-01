import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import { isMissingSchema } from './workflowStore.js'
import {
  CAREGIVER_CODE_PATTERN,
  RECIPIENT_CODE_PATTERN,
  normalizeCaregiverCodes,
  validateDisplayName,
  validateRecipientCode,
  type RecipientAdminRow,
  type RecipientAdminView,
  type RecipientSaveResult,
} from '../../shared/recipientAdmin.js'

/** 관리자 수급자 등록·배정의 서버 저장소. 원자성(등록+배정 한 트랜잭션)·코드 자동 번호·중복 방지는
 * db/migrations/2026-10-02-recipient-registration.sql 의 함수가 맡고, 여기서는 권한 있는 요청 본문을 검사해 호출한다. */

interface RecipientDbRow {
  code: string
  active: boolean
  display_name: string | null
  updated_at: string
}

const PAGE = 1000

async function readAll<T>(make: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> }): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/** 수급자 목록 + 현재 담당자 + 배정 가능한 요양보호사. 마이그레이션 전이면 ready:false(가짜 빈 목록이 아니다). */
export async function loadRecipientAdminView(supabase: SupabaseClient): Promise<RecipientAdminView> {
  try {
    const [recipients, assignments, participants] = await Promise.all([
      readAll<RecipientDbRow>(() => supabase.from('recipients').select('code, active, display_name, updated_at').order('code', { ascending: true })),
      readAll<{ caregiver_code: string; recipient_code: string }>(
        () => supabase.from('caregiver_assignments').select('caregiver_code, recipient_code').eq('active', true).order('recipient_code', { ascending: true }).order('caregiver_code', { ascending: true }),
      ),
      readAll<{ code: string; active: boolean }>(() => supabase.from('participants').select('code, active').order('code', { ascending: true })),
    ])
    const byRecipient = new Map<string, string[]>()
    for (const a of assignments) byRecipient.set(a.recipient_code, [...(byRecipient.get(a.recipient_code) ?? []), a.caregiver_code])
    const rows: RecipientAdminRow[] = recipients.map((r) => ({
      code: r.code,
      displayName: r.display_name,
      active: r.active,
      caregivers: byRecipient.get(r.code) ?? [],
      updatedAt: r.updated_at,
    }))
    return { ready: true, recipients: rows, caregivers: participants.map((p) => ({ code: p.code, active: p.active })) }
  } catch (e) {
    if (isMissingSchema(e as { code?: string; message?: string })) return { ready: false, recipients: [], caregivers: [] }
    if (e instanceof ApiError) throw e
    console.error('수급자 관리 목록 조회 실패:', (e as { message?: string })?.message)
    throw new ApiError(500, '수급자 목록을 불러오지 못했습니다.')
  }
}

interface RpcOutput {
  status: 'ok' | 'duplicate' | 'duplicate_code' | 'invalid' | 'invalid_caregiver' | 'conflict' | 'not_found'
  code?: string
  message?: string
}

async function callRpc(supabase: SupabaseClient, fn: 'recipient_register' | 'recipient_update', payload: Record<string, unknown>): Promise<RecipientSaveResult> {
  const { data, error } = await supabase.rpc(fn, { p: payload })
  if (error) {
    if (isMissingSchema(error)) throw new ApiError(503, '수급자 등록 저장소가 아직 준비되지 않았습니다(DB 마이그레이션 적용 필요).')
    console.error(`${fn} 실패:`, error.message)
    throw new ApiError(500, '저장하지 못했습니다. 입력한 내용은 그대로 두었으니 잠시 후 다시 시도해 주세요.')
  }
  const out = data as RpcOutput
  switch (out.status) {
    case 'ok':
      return { code: String(out.code), duplicate: false }
    case 'duplicate':
      return { code: String(out.code ?? payload.code ?? ''), duplicate: true }
    case 'duplicate_code':
      throw new ApiError(409, out.message ?? '이미 사용 중인 수급자 코드입니다.')
    case 'conflict':
      throw new ApiError(409, out.message ?? '다른 곳에서 먼저 수정되었습니다. 최신 내용을 확인해 주세요.')
    case 'not_found':
      throw new ApiError(404, out.message ?? '수급자를 찾을 수 없습니다.')
    default:
      throw new ApiError(400, out.message ?? '요청을 처리할 수 없습니다.')
  }
}

function requestId(body: Record<string, unknown>): string {
  const id = String(body.requestId ?? '').trim()
  if (id.length < 8 || id.length > 80) throw new ApiError(400, '요청 번호가 올바르지 않습니다.')
  return id
}

function caregiverList(raw: unknown): string[] {
  const list = normalizeCaregiverCodes(raw)
  if (list.length > 20) throw new ApiError(400, '담당 요양보호사가 너무 많습니다.')
  for (const c of list) if (!CAREGIVER_CODE_PATTERN.test(c)) throw new ApiError(400, '요양보호사 코드가 올바르지 않습니다.')
  return list
}

export async function registerRecipient(supabase: SupabaseClient, body: Record<string, unknown>): Promise<RecipientSaveResult> {
  const displayName = String(body.displayName ?? '').trim()
  const nameError = validateDisplayName(displayName)
  if (nameError) throw new ApiError(400, nameError)
  const code = String(body.code ?? '').trim().toUpperCase()
  const codeError = validateRecipientCode(code)
  if (codeError) throw new ApiError(400, codeError)
  return callRpc(supabase, 'recipient_register', {
    request_id: requestId(body),
    display_name: displayName,
    code: code || null,
    active: body.active === false ? false : true,
    caregiver_codes: caregiverList(body.caregiverCodes),
  })
}

export async function updateRecipient(supabase: SupabaseClient, body: Record<string, unknown>): Promise<RecipientSaveResult> {
  const code = String(body.code ?? '').trim().toUpperCase()
  if (!RECIPIENT_CODE_PATTERN.test(code)) throw new ApiError(400, '수급자 코드가 올바르지 않습니다.')
  const payload: Record<string, unknown> = { request_id: requestId(body), code }
  if (body.displayName !== undefined) {
    const displayName = String(body.displayName ?? '').trim()
    const nameError = validateDisplayName(displayName)
    if (nameError) throw new ApiError(400, nameError)
    payload.display_name = displayName
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw new ApiError(400, '활성 상태 값이 올바르지 않습니다.')
    payload.active = body.active
  }
  if (body.caregiverCodes !== undefined) payload.caregiver_codes = caregiverList(body.caregiverCodes)
  if (typeof body.expectedUpdatedAt === 'string' && body.expectedUpdatedAt) payload.expected_updated_at = body.expectedUpdatedAt
  return callRpc(supabase, 'recipient_update', payload)
}
