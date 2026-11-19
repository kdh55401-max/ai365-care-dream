/**
 * 연구용 요양보호사 흐름의 저장소 읽기·쓰기. 모든 함수는 요양보호사 세션 코드와
 * 배정 확인을 거친 뒤에만 부른다(assertAssigned).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import { DEPLOYMENT_ORGANIZATION } from '../../shared/organization.js'
import {
  inWeek, isNoChangeDay,
  type DailyContext, type DailyTranscript, type NameCode,
} from '../../shared/researchCare.js'

export const RECIPIENT_CODE = /^[A-Z0-9]{1,10}$/

export function parseRecipientCode(v: unknown): string {
  const code = String(v ?? '').trim().toUpperCase()
  if (!RECIPIENT_CODE.test(code)) throw new ApiError(400, '수급자 코드를 확인해 주세요.')
  return code
}

export async function assertAssigned(db: SupabaseClient, caregiver: string, recipient: string): Promise<void> {
  const { data } = await db.from('caregiver_assignments').select('recipient_code')
    .eq('caregiver_code', caregiver).eq('recipient_code', recipient).eq('active', true).maybeSingle()
  if (!data) throw new ApiError(403, '배정되지 않은 수급자입니다.')
}

/** AI로 보내기 전에 가릴 이름 목록(관리자가 등록한 별칭 → 코드). 컬럼이 없으면 빈 목록. */
export async function loadNames(db: SupabaseClient, recipient: string): Promise<NameCode[]> {
  const { data, error } = await db.from('recipients').select('code, display_name').eq('code', recipient).maybeSingle()
  if (error || !data) return []
  const name = (data as { display_name?: string | null }).display_name
  return name ? [{ name, code: recipient }] : []
}

/** 관리자가 확정한 평소 상태(기준 정보). 표가 아직 없으면 빈 목록. */
export async function loadUsual(db: SupabaseClient, recipient: string): Promise<string[]> {
  const { data, error } = await db.from('baseline_entries').select('domain, statement, value_text, status')
    .eq('organization_id', DEPLOYMENT_ORGANIZATION.id).eq('recipient_code', recipient).eq('status', 'confirmed').limit(8)
  if (error || !Array.isArray(data)) return []
  return data.map((r) => {
    const row = r as { domain?: string | null; statement?: string | null; value_text?: string | null }
    const text = (row.statement || row.value_text || '').trim()
    return text ? (row.domain ? `${row.domain}: ${text}` : text) : ''
  }).filter(Boolean).slice(0, 5)
}

interface ReportRow {
  id: string
  report_date: string
  raw_input: string
  followup_answers: Array<{ question?: string; answer?: string }> | null
  status: string
  report_source: string
  deleted: boolean
}

export function rowToTranscript(row: Pick<ReportRow, 'report_date' | 'raw_input' | 'followup_answers'>): DailyTranscript {
  const turns = (Array.isArray(row.followup_answers) ? row.followup_answers : [])
    .map((t) => ({ question: String(t?.question ?? ''), answer: String(t?.answer ?? '') }))
    .filter((t) => t.question)
  return { date: row.report_date, rawInput: row.raw_input ?? '', turns, noChange: isNoChangeDay(row.raw_input ?? '') }
}

/** date 컬럼을 'YYYY-MM-DD' 문자열로 맞춘다(드라이버에 따라 Date로 올 수 있다). */
export function isoDay(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10)
}
function normalizeRows(data: unknown): ReportRow[] {
  return (Array.isArray(data) ? data : []).map((r) => ({ ...(r as ReportRow), report_date: isoDay((r as ReportRow).report_date) }))
}
function normalizeWeekly(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>
  return { ...r, week_start: isoDay(r.week_start) }
}

const ROW_COLUMNS = 'id, report_date, raw_input, followup_answers, status, report_source, deleted, participant_code'

/** 이 어르신의 가장 최근 제출 기록(오늘 이전). 담당 요양보호사가 바뀌어도 이어지도록 어르신 기준. */
export async function loadDailyContext(db: SupabaseClient, recipient: string, today: string): Promise<DailyContext> {
  const [usual, rows] = await Promise.all([
    loadUsual(db, recipient),
    db.from('reports').select(ROW_COLUMNS).eq('recipient_code', recipient).eq('report_source', 'live')
      .eq('status', 'submitted').eq('deleted', false).order('report_date', { ascending: false }).limit(5),
  ])
  const list = normalizeRows(rows.data)
  const prev = list.find((r) => r.report_date < today)
  if (!prev) return { usual, previous: null }
  const t = rowToTranscript(prev)
  const answers = t.turns.map((x) => x.answer).filter(Boolean).join(' / ')
  return { usual, previous: { date: prev.report_date, text: answers ? `${t.rawInput} (추가: ${answers})` : t.rawInput } }
}

/** 그 주(월~일)에 이 요양보호사가 이 어르신에게 제출한 하루 기록. */
export async function loadWeekTranscripts(db: SupabaseClient, caregiver: string, recipient: string, weekStart: string) {
  const { data, error } = await db.from('reports').select(ROW_COLUMNS)
    .eq('participant_code', caregiver).eq('recipient_code', recipient).eq('report_source', 'live')
    .eq('status', 'submitted').eq('deleted', false).gte('report_date', weekStart)
    .order('report_date', { ascending: true }).limit(40)
  if (error) throw new ApiError(500, '이번 주 기록을 불러오지 못했습니다.')
  const rows = normalizeRows(data).filter((r) => inWeek(r.report_date, weekStart))
  return { ids: rows.map((r) => r.id), days: rows.map(rowToTranscript) }
}

export const WEEKLY_COLUMNS =
  'id, participant_code, recipient_code, week_start, source_report_ids, ai_draft, ai_model, ai_created_at, ' +
  'caregiver_text, caregiver_edit_seconds, status, sent_at, admin_final_text, admin_note, admin_followup, admin_confirmed_at, created_at, updated_at'

export async function getWeekly(db: SupabaseClient, caregiver: string, recipient: string, weekStart: string) {
  const { data, error } = await db.from('weekly_drafts').select(WEEKLY_COLUMNS)
    .eq('participant_code', caregiver).eq('recipient_code', recipient).eq('week_start', weekStart).maybeSingle()
  if (error) throw new ApiError(503, '주간 기록 저장소가 아직 준비되지 않았습니다. 관리자에게 DB 적용을 요청해 주세요.')
  return data ? normalizeWeekly(data) : null
}

export async function insertWeekly(db: SupabaseClient, row: Record<string, unknown>) {
  const { data, error } = await db.from('weekly_drafts').insert(row).select(WEEKLY_COLUMNS).single()
  if (error || !data) throw new ApiError(500, '주간 초안을 저장하지 못했습니다.')
  return normalizeWeekly(data)
}

export async function sendWeekly(db: SupabaseClient, caregiver: string, id: string, text: string, editSeconds: number | null) {
  const { data: existing, error } = await db.from('weekly_drafts').select(WEEKLY_COLUMNS)
    .eq('id', id).eq('participant_code', caregiver).maybeSingle()
  if (error) throw new ApiError(500, '주간 초안을 불러오지 못했습니다.')
  if (!existing) throw new ApiError(404, '주간 초안을 찾을 수 없습니다.')
  const row = normalizeWeekly(existing)
  if (row.status !== 'draft') {
    if (row.caregiver_text === text) return row // 같은 내용 재전송(응답 유실 후 재시도)
    throw new ApiError(409, '이미 관리자에게 보낸 주간 기록입니다.')
  }
  const now = new Date().toISOString()
  const { data, error: updateError } = await db.from('weekly_drafts')
    .update({ caregiver_text: text, caregiver_edit_seconds: editSeconds, status: 'sent', sent_at: now, updated_at: now })
    .eq('id', id).eq('status', 'draft').select(WEEKLY_COLUMNS).single()
  if (updateError || !data) throw new ApiError(500, '주간 기록을 보내지 못했습니다.')
  return normalizeWeekly(data)
}
