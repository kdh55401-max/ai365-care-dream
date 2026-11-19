/**
 * 시연 모드(?demo=1)의 연구용 흐름 저장소. 이 브라우저(localStorage)에만 저장하고
 * 외부 AI를 부르지 않는다 — 되묻기·주간 초안은 규칙 기반 결과(source='rule')로 만든다.
 */
import type { CareReportRecord } from '../../../shared/careTypes'
import {
  fallbackQuestions, fallbackWeeklyDraft, inWeek, isNoChangeDay, weekStartOf,
  type DailyContext, type DailyTranscript,
} from '../../../shared/researchCare'
import type { ResearchRepo, WeeklyDraft } from '../shared/researchRepo'
import { demoAllReports, demoAssignedRecipients, demoCareSession, newDemoId } from './demoStore'

export const DEMO_WEEKLY_KEY = 'ai365_research_weekly_demo_v1'

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

function requireCaregiver(recipientCode?: string): string {
  const code = demoCareSession()
  if (!code) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 })
  if (recipientCode && !demoAssignedRecipients(code).includes(recipientCode)) {
    throw Object.assign(new Error('배정되지 않은 수급자입니다.'), { status: 403 })
  }
  return code
}

export function readWeekly(): WeeklyDraft[] {
  try { return JSON.parse(localStorage.getItem(DEMO_WEEKLY_KEY) || '[]') as WeeklyDraft[] } catch { return [] }
}
export function writeWeekly(list: WeeklyDraft[]) {
  try { localStorage.setItem(DEMO_WEEKLY_KEY, JSON.stringify(list)) } catch { /* 저장소 없음 */ }
}

function toTranscript(r: CareReportRecord): DailyTranscript {
  const turns = (r.followup_answers ?? []).map((t) => ({ question: t.question, answer: t.answer })).filter((t) => t.question)
  return { date: r.report_date, rawInput: r.raw_input, turns, noChange: isNoChangeDay(r.raw_input) }
}

function submittedLive(): CareReportRecord[] {
  return demoAllReports().filter((r) => r.status === 'submitted' && r.report_source === 'live')
}

function weekReports(code: string, recipientCode: string, weekStart: string) {
  return submittedLive()
    .filter((r) => r.participant_code === code && r.recipient_code === recipientCode && inWeek(r.report_date, weekStart))
    .sort((a, b) => a.report_date.localeCompare(b.report_date))
}

export const demoResearchRepo: ResearchRepo = {
  async ask(recipientCode, rawInput) {
    requireCaregiver(recipientCode)
    const today = todayKst()
    const prev = submittedLive()
      .filter((r) => r.recipient_code === recipientCode && r.report_date < today)
      .sort((a, b) => b.report_date.localeCompare(a.report_date))[0]
    const ctx: DailyContext = { usual: [], previous: prev ? { date: prev.report_date, text: prev.raw_input } : null }
    return { questions: fallbackQuestions(rawInput, ctx), source: 'rule', previous: ctx.previous ? { date: ctx.previous.date } : null }
  },
  async getWeekly(recipientCode, weekStart) {
    const code = requireCaregiver(recipientCode)
    const weekly = readWeekly().find((w) => w.participant_code === code && w.recipient_code === recipientCode && w.week_start === weekStart) ?? null
    return { weekly, dayCount: weekReports(code, recipientCode, weekStart).length }
  },
  async prepareWeekly(recipientCode, weekStart) {
    const code = requireCaregiver(recipientCode)
    if (weekStartOf(weekStart) !== weekStart) throw Object.assign(new Error('주 시작일(월요일)을 확인해 주세요.'), { status: 400 })
    const list = readWeekly()
    const existing = list.find((w) => w.participant_code === code && w.recipient_code === recipientCode && w.week_start === weekStart)
    if (existing) return { weekly: existing, reused: true }
    const reports = weekReports(code, recipientCode, weekStart)
    if (reports.length === 0) throw Object.assign(new Error('이번 주에 저장된 하루 기록이 없습니다.'), { status: 400 })
    const now = new Date().toISOString()
    const weekly: WeeklyDraft = {
      id: newDemoId(), participant_code: code, recipient_code: recipientCode, week_start: weekStart,
      source_report_ids: reports.map((r) => r.id), ai_draft: fallbackWeeklyDraft(reports.map(toTranscript), []),
      ai_model: 'rule', ai_created_at: now, caregiver_text: null, caregiver_edit_seconds: null, status: 'draft',
      sent_at: null, admin_final_text: null, admin_note: null, admin_followup: null, admin_confirmed_at: null, created_at: now, updated_at: now,
    }
    writeWeekly([...list, weekly])
    return { weekly, reused: false }
  },
  async sendWeekly(id, caregiverText, editSeconds) {
    const code = requireCaregiver()
    const list = readWeekly()
    const idx = list.findIndex((w) => w.id === id && w.participant_code === code)
    if (idx < 0) throw Object.assign(new Error('주간 초안을 찾을 수 없습니다.'), { status: 404 })
    const row = list[idx]
    if (row.status !== 'draft') {
      if (row.caregiver_text === caregiverText) return { weekly: row }
      throw Object.assign(new Error('이미 관리자에게 보낸 주간 기록입니다.'), { status: 409 })
    }
    const now = new Date().toISOString()
    list[idx] = { ...row, caregiver_text: caregiverText, caregiver_edit_seconds: Math.round(editSeconds), status: 'sent', sent_at: now, updated_at: now }
    writeWeekly(list)
    return { weekly: list[idx] }
  },
}
