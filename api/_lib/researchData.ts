/**
 * 연구 설정(사전·사후 기준일), 연구 동의·고수준 태그, 도입 전(사전) 기록, 연구용 CSV 내보내기.
 * /api/admin/participants(view=research, op=research_*)와 /api/admin/export(type=research_*)에서 부른다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import { WEEKLY_COLUMNS, isoDay } from './researchCareStore.js'
import { isIsoDate } from '../../shared/researchCare.js'
import {
  CUTOFF_KEY, DAILY_HEADERS, PRE_HEADERS, WEEKLY_HEADERS, consentedMap, dailyRows, preRows, weeklyRows,
  type DailyExportSource, type PreRecord, type ResearchExportType, type ResearchParticipant, type WeeklyExportSource,
} from '../../shared/researchExport.js'

const NOT_READY = '연구 자료 저장소(DB)가 아직 준비되지 않았습니다. 2026-11-19 마이그레이션을 적용해 주세요.'
const CODE = /^[A-Z0-9]{1,10}$/
const PRE_COLUMNS = 'id, caregiver_code, recipient_code, record_date, record_text, writing_seconds, source, deleted, created_at'
const PARTICIPANT_COLUMNS = 'caregiver_code, consented, consent_date, high_baseline, note, updated_at'

export async function loadCutoff(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db.from('research_settings').select('key, value').eq('key', CUTOFF_KEY).maybeSingle()
  if (error) throw new ApiError(503, NOT_READY)
  const v = (data as { value?: string } | null)?.value ?? ''
  return isIsoDate(v) ? v : null
}

async function loadParticipants(db: SupabaseClient): Promise<ResearchParticipant[]> {
  const { data, error } = await db.from('research_participants').select(PARTICIPANT_COLUMNS).limit(500)
  if (error) throw new ApiError(503, NOT_READY)
  return ((data ?? []) as unknown as ResearchParticipant[]).map((p) => ({ ...p, consent_date: p.consent_date ? isoDay(p.consent_date) : null }))
}

async function loadPreRecords(db: SupabaseClient): Promise<PreRecord[]> {
  const { data, error } = await db.from('research_pre_records').select(PRE_COLUMNS).eq('deleted', false)
    .order('record_date', { ascending: false }).limit(2000)
  if (error) throw new ApiError(503, NOT_READY)
  return ((data ?? []) as unknown as PreRecord[]).map((r) => ({ ...r, record_date: isoDay(r.record_date) }))
}

/** 관리자 "연구 자료" 화면: 기준일, 요양보호사별 동의·태그(참여자 전체 기준), 사전 기록 목록. */
export async function researchDataView(db: SupabaseClient) {
  const [{ data: people, error }, cutoffDate, research, preRecords] = await Promise.all([
    db.from('participants').select('code, active').order('code', { ascending: true }),
    loadCutoff(db), loadParticipants(db), loadPreRecords(db),
  ])
  if (error) throw new ApiError(500, '참여자 목록을 불러오지 못했습니다.')
  const map = new Map(research.map((p) => [p.caregiver_code, p]))
  const participants = ((people ?? []) as Array<{ code: string; active: boolean }>).map((p) => map.get(p.code)
    ?? { caregiver_code: p.code, consented: false, consent_date: null, high_baseline: false, note: null })
  return { cutoffDate, participants, preRecords }
}

export async function setCutoff(db: SupabaseClient, value: unknown) {
  const v = value === null || value === '' ? '' : String(value)
  if (v && !isIsoDate(v)) throw new ApiError(400, '기준일 형식(YYYY-MM-DD)을 확인해 주세요.')
  const now = new Date().toISOString()
  const { data, error } = await db.from('research_settings').select('key').eq('key', CUTOFF_KEY).maybeSingle()
  if (error) throw new ApiError(503, NOT_READY)
  const result = data
    ? await db.from('research_settings').update({ value: v, updated_at: now }).eq('key', CUTOFF_KEY).select('key').single()
    : await db.from('research_settings').insert({ key: CUTOFF_KEY, value: v, updated_at: now }).select('key').single()
  if (result.error) throw new ApiError(500, '기준일을 저장하지 못했습니다.')
  return { cutoffDate: v || null }
}

export async function saveResearchParticipant(db: SupabaseClient, body: Record<string, unknown>) {
  const code = String(body.code ?? '').trim().toUpperCase()
  if (!CODE.test(code)) throw new ApiError(400, '요양보호사 코드를 확인해 주세요.')
  const { data: exists } = await db.from('participants').select('code').eq('code', code).maybeSingle()
  if (!exists) throw new ApiError(404, '없는 요양보호사 코드입니다.')
  const consented = body.consented === true
  const consentDate = body.consentDate === null || body.consentDate === '' || body.consentDate === undefined ? null : String(body.consentDate)
  if (consentDate && !isIsoDate(consentDate)) throw new ApiError(400, '동의일 형식(YYYY-MM-DD)을 확인해 주세요.')
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null
  const row = { consented, consent_date: consented ? consentDate : null, high_baseline: body.highBaseline === true, note, updated_at: new Date().toISOString() }
  const { data: current, error } = await db.from('research_participants').select('caregiver_code').eq('caregiver_code', code).maybeSingle()
  if (error) throw new ApiError(503, NOT_READY)
  const result = current
    ? await db.from('research_participants').update(row).eq('caregiver_code', code).select(PARTICIPANT_COLUMNS).single()
    : await db.from('research_participants').insert({ caregiver_code: code, ...row }).select(PARTICIPANT_COLUMNS).single()
  if (result.error || !result.data) throw new ApiError(500, '연구 참여 정보를 저장하지 못했습니다.')
  return { participant: result.data }
}

export async function addPreRecord(db: SupabaseClient, body: Record<string, unknown>) {
  const caregiver = String(body.caregiverCode ?? '').trim().toUpperCase()
  const recipient = String(body.recipientCode ?? '').trim().toUpperCase()
  if (!CODE.test(caregiver) || !CODE.test(recipient)) throw new ApiError(400, '요양보호사·어르신 코드를 확인해 주세요.')
  const date = String(body.recordDate ?? '')
  if (!isIsoDate(date)) throw new ApiError(400, '작성일 형식(YYYY-MM-DD)을 확인해 주세요.')
  const text = String(body.recordText ?? '').trim()
  if (!text) throw new ApiError(400, '기록 내용을 입력해 주세요.')
  if (text.length > 6000) throw new ApiError(400, '기록 내용이 너무 깁니다.')
  const seconds = body.writingSeconds === null || body.writingSeconds === '' || body.writingSeconds === undefined ? null : Number(body.writingSeconds)
  if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0)) throw new ApiError(400, '작성 시간(초)을 확인해 주세요.')
  const source = body.source === 'easycare' || body.source === 'other' ? body.source : 'paper'
  const [{ data: c }, { data: r }] = await Promise.all([
    db.from('participants').select('code').eq('code', caregiver).maybeSingle(),
    db.from('recipients').select('code').eq('code', recipient).maybeSingle(),
  ])
  if (!c || !r) throw new ApiError(404, '등록되지 않은 요양보호사 또는 어르신 코드입니다.')
  const { data, error } = await db.from('research_pre_records').insert({
    caregiver_code: caregiver, recipient_code: recipient, record_date: date, record_text: text,
    writing_seconds: seconds === null ? null : Math.round(seconds), source,
  }).select(PRE_COLUMNS).single()
  if (error || !data) throw new ApiError(error ? 503 : 500, error ? NOT_READY : '사전 기록을 저장하지 못했습니다.')
  const row = data as unknown as PreRecord
  return { preRecord: { ...row, record_date: isoDay(row.record_date) } }
}

/** 지우지 않고 숨긴다(연구 자료 추적성). */
export async function hidePreRecord(db: SupabaseClient, id: unknown) {
  const v = String(id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new ApiError(400, '기록 id를 확인해 주세요.')
  const { data, error } = await db.from('research_pre_records').update({ deleted: true }).eq('id', v).select('id').maybeSingle()
  if (error) throw new ApiError(503, NOT_READY)
  if (!data) throw new ApiError(404, '기록을 찾을 수 없습니다.')
  return { ok: true }
}

export function parseExportType(v: string | null): ResearchExportType | null {
  return v === 'research_daily' || v === 'research_weekly' || v === 'research_pre' ? v : null
}

/** 연구 동의한 요양보호사 기록만 CSV 행으로 만든다. */
export async function researchExport(db: SupabaseClient, type: ResearchExportType) {
  const [cutoff, list] = await Promise.all([loadCutoff(db), loadParticipants(db)])
  const people = consentedMap(list)
  if (type === 'research_pre') {
    const rows = preRows((await loadPreRecords(db)).slice().reverse(), people, cutoff)
    return { headers: PRE_HEADERS, rows }
  }
  if (type === 'research_weekly') {
    const { data, error } = await db.from('weekly_drafts').select(WEEKLY_COLUMNS).order('week_start', { ascending: true }).limit(5000)
    if (error) throw new ApiError(503, NOT_READY)
    const list = ((data ?? []) as unknown as WeeklyExportSource[]).map((w) => ({ ...w, week_start: isoDay(w.week_start) }))
    return { headers: WEEKLY_HEADERS, rows: weeklyRows(list, people, cutoff) }
  }
  const { data, error } = await db.from('reports')
    .select('id, participant_code, recipient_code, report_date, completion_seconds, input_method, ai_questions_source, raw_input, followup_answers')
    .eq('report_source', 'live').eq('status', 'submitted').eq('deleted', false).eq('transcript_only', true)
    .order('report_date', { ascending: true }).limit(20000)
  if (error) throw new ApiError(503, NOT_READY)
  const rows = ((data ?? []) as unknown as DailyExportSource[]).map((r) => ({ ...r, report_date: isoDay(r.report_date) }))
  return { headers: DAILY_HEADERS, rows: dailyRows(rows, people, cutoff) }
}
