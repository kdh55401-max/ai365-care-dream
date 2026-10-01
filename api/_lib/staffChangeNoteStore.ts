import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import { isMissingSchema } from './workflowStore.js'
import {
  CONSENT_CHOICES,
  COUNSEL_METHODS,
  kstDateOf,
  validateStaffNote,
  sortStaffNotes,
  type ConsentChoice,
  type CounselMethod,
  type SaveStaffNoteResult,
  type StaffNoteItem,
  type StaffNoteView,
} from '../../shared/staffChangeNote.js'

/** 직원(담당 요양보호사) 변경 상담일지의 서버 저장소. 일지 대상 = recipient_admin_log 중 담당이 해제된 'updated' 이벤트.
 * 저장의 원자성·잠금·충돌 검사는 db/migrations/2026-10-03-staff-change-notes.sql 의 함수가 맡고, 여기서는 요청 본문을 검사해 호출한다. */

interface LogRow {
  id: number
  recipient_code: string
  detail: { caregivers_added?: string[]; caregivers_removed?: string[] } | null
  created_at: string
}

interface NoteRow {
  change_log_id: number
  changed_on: string
  reason: string
  counsel_method: CounselMethod | null
  consent: ConsentChoice | null
  counselee_relation: string
  content: string
  status: 'draft' | 'confirmed'
  confirmed_at: string | null
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

const asIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const asDate = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

/** 일지가 필요한(담당이 해제된) 변경 목록 + 이미 쓴 일지. 마이그레이션 전이면 ready:false(가짜 빈 목록이 아니다). */
export async function loadStaffNoteView(supabase: SupabaseClient, today: string): Promise<StaffNoteView> {
  try {
    const [logs, notes, recipients] = await Promise.all([
      readAll<LogRow>(() => supabase.from('recipient_admin_log').select('id, recipient_code, detail, created_at').eq('event_type', 'updated').order('id', { ascending: true })),
      readAll<NoteRow>(() =>
        supabase
          .from('staff_change_notes')
          .select('change_log_id, changed_on, reason, counsel_method, consent, counselee_relation, content, status, confirmed_at, updated_at')
          .order('change_log_id', { ascending: true }),
      ),
      readAll<{ code: string; display_name: string | null }>(() => supabase.from('recipients').select('code, display_name').order('code', { ascending: true })),
    ])
    const noteById = new Map(notes.map((n) => [Number(n.change_log_id), n]))
    const nameByCode = new Map(recipients.map((r) => [r.code, r.display_name]))
    const items: StaffNoteItem[] = []
    for (const log of logs) {
      const from = log.detail?.caregivers_removed ?? []
      if (from.length === 0) continue
      const n = noteById.get(Number(log.id))
      const changedAt = asIso(log.created_at)
      items.push({
        changeLogId: Number(log.id),
        recipientCode: log.recipient_code,
        displayName: nameByCode.get(log.recipient_code) ?? null,
        fromCaregivers: from,
        toCaregivers: log.detail?.caregivers_added ?? [],
        changedAt,
        defaultChangedOn: kstDateOf(changedAt),
        note: n
          ? {
              changedOn: asDate(n.changed_on),
              reason: n.reason,
              counselMethod: n.counsel_method,
              consent: n.consent ?? null,
              counseleeRelation: n.counselee_relation,
              content: n.content,
              status: n.status,
              confirmedAt: n.confirmed_at ? asIso(n.confirmed_at) : null,
              updatedAt: asIso(n.updated_at),
            }
          : null,
      })
    }
    return { ready: true, items: sortStaffNotes(items, today) }
  } catch (e) {
    if (isMissingSchema(e as { code?: string; message?: string })) return { ready: false, items: [] }
    if (e instanceof ApiError) throw e
    console.error('직원변경 상담일지 조회 실패:', (e as { message?: string })?.message)
    throw new ApiError(500, '상담일지를 불러오지 못했습니다.')
  }
}

interface RpcOutput {
  status: 'ok' | 'invalid' | 'not_found' | 'conflict' | 'locked'
  message?: string
  change_log_id?: number
  note_status?: 'draft' | 'confirmed'
  updated_at?: string
}

const str = (v: unknown, max: number): string => {
  const s = String(v ?? '').trim()
  if (s.length > max + 50) throw new ApiError(400, '입력한 글이 너무 깁니다.')
  return s
}

export async function saveStaffNote(supabase: SupabaseClient, body: Record<string, unknown>, today: string): Promise<SaveStaffNoteResult> {
  const changeLogId = Number(body.changeLogId)
  if (!Number.isInteger(changeLogId) || changeLogId <= 0) throw new ApiError(400, '담당 변경 번호가 올바르지 않습니다.')
  const methodRaw = String(body.counselMethod ?? '').trim()
  if (methodRaw && !COUNSEL_METHODS.includes(methodRaw as CounselMethod)) throw new ApiError(400, '상담 방법이 올바르지 않습니다.')
  const consentRaw = String(body.consent ?? '').trim()
  if (consentRaw && !CONSENT_CHOICES.includes(consentRaw as ConsentChoice)) throw new ApiError(400, '의견·동의 여부 값이 올바르지 않습니다.')
  const fields = {
    changedOn: String(body.changedOn ?? '').trim(),
    reason: str(body.reason, 500),
    counselMethod: (methodRaw || null) as CounselMethod | null,
    consent: (consentRaw || null) as ConsentChoice | null,
    counseleeRelation: str(body.counseleeRelation, 30),
    content: str(body.content, 2000),
    confirm: body.confirm === true,
  }
  const problem = validateStaffNote(fields, today)
  if (problem) throw new ApiError(400, problem)
  const { data, error } = await supabase.rpc('staff_change_note_save', {
    p: {
      change_log_id: changeLogId,
      changed_on: fields.changedOn,
      reason: fields.reason,
      counsel_method: fields.counselMethod,
      consent: fields.consent,
      counselee_relation: fields.counseleeRelation,
      content: fields.content,
      confirm: fields.confirm,
      expected_updated_at: typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null,
    },
  })
  if (error) {
    if (isMissingSchema(error)) throw new ApiError(503, '상담일지 저장소가 아직 준비되지 않았습니다(DB 마이그레이션 적용 필요).')
    console.error('staff_change_note_save 실패:', error.message)
    throw new ApiError(500, '저장하지 못했습니다. 입력한 내용은 그대로 두었으니 잠시 후 다시 시도해 주세요.')
  }
  const out = data as RpcOutput
  switch (out.status) {
    case 'ok':
      return { changeLogId, status: out.note_status ?? 'draft', updatedAt: String(out.updated_at) }
    case 'conflict':
    case 'locked':
      throw new ApiError(409, out.message ?? '다른 곳에서 먼저 변경되었습니다. 최신 내용을 확인해 주세요.')
    case 'not_found':
      throw new ApiError(404, out.message ?? '담당 변경 기록을 찾을 수 없습니다.')
    default:
      throw new ApiError(400, out.message ?? '요청을 처리할 수 없습니다.')
  }
}
