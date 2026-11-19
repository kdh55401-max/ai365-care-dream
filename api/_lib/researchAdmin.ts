/**
 * 연구용 관리자 화면(주간 상태변화) 서버 처리. /api/admin/reports(view=research_week, op=weekly_review)에서 부른다.
 * 요양보호사 원자료(하루 전사본), AI 초안, 요양보호사 수정본, 관리자 확정본을 서로 덮어쓰지 않는다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import { WEEKLY_COLUMNS, isoDay } from './researchCareStore.js'
import { inWeek, isIsoDate, weekStartOf } from '../../shared/researchCare.js'

const DAY_COLUMNS =
  'id, participant_code, recipient_code, report_date, raw_input, followup_answers, completion_seconds, submitted_at, report_source, status, deleted'

export interface ResearchDayRow {
  id: string
  participant_code: string
  recipient_code: string
  report_date: string
  raw_input: string
  followup_answers: Array<{ question: string; answer: string }>
  completion_seconds: number | null
  submitted_at: string | null
}

export function parseWeek(v: unknown): string {
  if (!isIsoDate(v) || weekStartOf(v) !== v) throw new ApiError(400, '주 시작일(월요일)을 확인해 주세요.')
  return v
}

/** 한 주(월~일)의 하루 기록과 주간 초안 전체. 화면이 요양보호사·어르신별로 묶는다. */
export async function researchWeekView(db: SupabaseClient, weekStart: string) {
  const [days, weeklies] = await Promise.all([
    db.from('reports').select(DAY_COLUMNS).eq('report_source', 'live').eq('status', 'submitted').eq('deleted', false)
      .gte('report_date', weekStart).order('report_date', { ascending: true }).limit(1000),
    db.from('weekly_drafts').select(WEEKLY_COLUMNS).eq('week_start', weekStart).limit(500),
  ])
  if (days.error) throw new ApiError(500, '하루 기록을 불러오지 못했습니다.')
  const reports = (Array.isArray(days.data) ? days.data : [])
    .map((r) => ({ ...(r as unknown as ResearchDayRow), report_date: isoDay((r as unknown as ResearchDayRow).report_date) }))
    .filter((r) => inWeek(r.report_date, weekStart))
    .map((r) => ({
      id: r.id, participant_code: r.participant_code, recipient_code: r.recipient_code, report_date: r.report_date,
      raw_input: r.raw_input, followup_answers: Array.isArray(r.followup_answers) ? r.followup_answers : [],
      completion_seconds: r.completion_seconds, submitted_at: r.submitted_at,
    }))
  // 주간 표가 아직 없으면(마이그레이션 전) 하루 기록만 보여 준다.
  const weeklyReady = !weeklies.error
  const weeklyRows = weeklyReady && Array.isArray(weeklies.data)
    ? weeklies.data.map((w) => ({ ...(w as unknown as Record<string, unknown>), week_start: isoDay((w as unknown as Record<string, unknown>).week_start) }))
    : []
  return { weekStart, reports, weeklies: weeklyRows, weeklyReady }
}

function text(v: unknown, max: number, label: string): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw new ApiError(400, `${label} 형식이 올바르지 않습니다.`)
  const t = v.trim()
  if (t.length > max) throw new ApiError(400, `${label}이 너무 깁니다.`)
  return t
}

/** 관리자 확인·수정·확정. 같은 글을 동시에 고친 경우를 막으려고 updated_at을 비교한다. */
export async function researchWeeklyReview(db: SupabaseClient, body: Record<string, unknown>) {
  const id = String(body.id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, '주간 기록 id를 확인해 주세요.')
  const finalText = text(body.adminFinalText, 6000, '확정본')
  const note = text(body.adminNote, 2000, '상담 기록')
  const followup = text(body.adminFollowup, 2000, '후속조치 기록')
  const confirm = body.confirm === true
  const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : ''

  const { data: existing, error } = await db.from('weekly_drafts').select(WEEKLY_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new ApiError(503, '주간 기록 저장소가 아직 준비되지 않았습니다.')
  if (!existing) throw new ApiError(404, '주간 기록을 찾을 수 없습니다.')
  const row = existing as unknown as Record<string, unknown>
  if (row.status === 'draft') throw new ApiError(409, '요양보호사가 아직 보내지 않은 초안입니다.')
  if (expected && String(row.updated_at) !== expected) throw new ApiError(409, '다른 관리자가 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.')
  if (row.status === 'confirmed' && finalText !== null && finalText !== row.admin_final_text) {
    throw new ApiError(409, '이미 확정된 기록입니다. 확정본은 바꿀 수 없고 상담·후속조치만 덧붙일 수 있습니다.')
  }
  if (confirm && !(finalText ?? row.admin_final_text ?? row.caregiver_text)) throw new ApiError(400, '확정할 내용이 없습니다.')

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { updated_at: now }
  if (finalText !== null && row.status !== 'confirmed') update.admin_final_text = finalText
  if (note !== null) update.admin_note = note
  if (followup !== null) update.admin_followup = followup
  if (confirm && row.status !== 'confirmed') {
    update.status = 'confirmed'
    update.admin_confirmed_at = now
    if (!(finalText ?? row.admin_final_text)) update.admin_final_text = row.caregiver_text
  }
  const { data, error: updateError } = await db.from('weekly_drafts').update(update)
    .eq('id', id).eq('updated_at', row.updated_at as string).select(WEEKLY_COLUMNS).maybeSingle()
  if (updateError) throw new ApiError(500, '주간 기록을 저장하지 못했습니다.')
  if (!data) throw new ApiError(409, '다른 관리자가 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.')
  const saved = data as unknown as Record<string, unknown>
  return { weekly: { ...saved, week_start: isoDay(saved.week_start) } }
}
