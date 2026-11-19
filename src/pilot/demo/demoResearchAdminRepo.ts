/** 시연 모드 관리자 연구 화면 저장소. 이 브라우저에만 저장한다. 실서버(api/_lib/researchAdmin.ts)와 같은 규칙을 따른다. */
import { inWeek, isIsoDate } from '../../../shared/researchCare'
import { toCsv } from '../../../shared/csv'
import {
  DAILY_HEADERS, PRE_HEADERS, WEEKLY_HEADERS, consentedMap, dailyRows, preRows, weeklyRows,
  type PreRecord, type ResearchParticipant,
} from '../../../shared/researchExport'
import type { ResearchAdminRepo } from '../shared/researchAdminRepo'
import { demoAdminSession, demoAllReports, demoListParticipants, demoRecipientCodes, newDemoId } from './demoStore'
import { readWeekly, writeWeekly } from './demoResearchRepo'

export const DEMO_RESEARCH_DATA_KEY = 'ai365_research_data_demo_v1'
interface DemoResearchData { cutoffDate: string | null; participants: ResearchParticipant[]; preRecords: PreRecord[] }

function readData(): DemoResearchData {
  try {
    const v = JSON.parse(localStorage.getItem(DEMO_RESEARCH_DATA_KEY) || 'null') as DemoResearchData | null
    return v ?? { cutoffDate: null, participants: [], preRecords: [] }
  } catch { return { cutoffDate: null, participants: [], preRecords: [] } }
}
function writeData(d: DemoResearchData) {
  try { localStorage.setItem(DEMO_RESEARCH_DATA_KEY, JSON.stringify(d)) } catch { /* 저장소 없음 */ }
}
function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function requireAdmin() {
  if (!demoAdminSession()) throw Object.assign(new Error('관리자 로그인이 필요합니다.'), { status: 401 })
}
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export const demoResearchAdminRepo: ResearchAdminRepo = {
  async week(weekStart) {
    requireAdmin()
    const reports = demoAllReports()
      .filter((r) => r.report_source === 'live' && r.status === 'submitted' && inWeek(r.report_date, weekStart))
      .sort((a, b) => a.report_date.localeCompare(b.report_date))
      .map((r) => ({
        id: r.id, participant_code: r.participant_code, recipient_code: r.recipient_code, report_date: r.report_date,
        raw_input: r.raw_input, followup_answers: (r.followup_answers ?? []).map((t) => ({ question: t.question, answer: t.answer })),
        completion_seconds: r.completion_seconds, submitted_at: r.submitted_at,
      }))
    return { weekStart, reports, weeklies: readWeekly().filter((w) => w.week_start === weekStart), weeklyReady: true }
  },
  async review(input) {
    requireAdmin()
    const list = readWeekly()
    const idx = list.findIndex((w) => w.id === input.id)
    if (idx < 0) fail(404, '주간 기록을 찾을 수 없습니다.')
    const row = list[idx]
    if (row.status === 'draft') fail(409, '요양보호사가 아직 보내지 않은 초안입니다.')
    if (row.updated_at !== input.expectedUpdatedAt) fail(409, '다른 관리자가 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.')
    const finalText = input.adminFinalText?.trim()
    if (row.status === 'confirmed' && finalText !== undefined && finalText !== row.admin_final_text) {
      fail(409, '이미 확정된 기록입니다. 확정본은 바꿀 수 없고 상담·후속조치만 덧붙일 수 있습니다.')
    }
    const now = new Date().toISOString()
    const next = { ...row, updated_at: now }
    if (finalText !== undefined && row.status !== 'confirmed') next.admin_final_text = finalText
    if (input.adminNote !== undefined) next.admin_note = input.adminNote.trim()
    if (input.adminFollowup !== undefined) next.admin_followup = input.adminFollowup.trim()
    if (input.confirm && row.status !== 'confirmed') {
      if (!(next.admin_final_text || row.caregiver_text)) fail(400, '확정할 내용이 없습니다.')
      next.status = 'confirmed'
      next.admin_confirmed_at = now
      if (!next.admin_final_text) next.admin_final_text = row.caregiver_text
    }
    list[idx] = next
    writeWeekly(list)
    return { weekly: next }
  },
  async data() {
    requireAdmin()
    const d = readData()
    const map = new Map(d.participants.map((p) => [p.caregiver_code, p]))
    const participants = demoListParticipants().map((p) => map.get(p.code)
      ?? { caregiver_code: p.code, consented: false, consent_date: null, high_baseline: false, note: null })
    return { cutoffDate: d.cutoffDate, participants, preRecords: d.preRecords.slice().sort((a, b) => b.record_date.localeCompare(a.record_date)) }
  },
  async setCutoff(cutoffDate) {
    requireAdmin()
    if (cutoffDate && !isIsoDate(cutoffDate)) fail(400, '기준일 형식(YYYY-MM-DD)을 확인해 주세요.')
    writeData({ ...readData(), cutoffDate: cutoffDate || null })
  },
  async saveParticipant(input) {
    requireAdmin()
    if (!demoListParticipants().some((p) => p.code === input.code)) fail(404, '없는 요양보호사 코드입니다.')
    if (input.consentDate && !isIsoDate(input.consentDate)) fail(400, '동의일 형식(YYYY-MM-DD)을 확인해 주세요.')
    const d = readData()
    const row: ResearchParticipant = { caregiver_code: input.code, consented: input.consented, consent_date: input.consented ? input.consentDate : null, high_baseline: input.highBaseline, note: input.note.trim() || null }
    writeData({ ...d, participants: [...d.participants.filter((p) => p.caregiver_code !== input.code), row] })
  },
  async addPreRecord(input) {
    requireAdmin()
    if (!demoListParticipants().some((p) => p.code === input.caregiverCode) || !demoRecipientCodes().includes(input.recipientCode)) {
      fail(404, '등록되지 않은 요양보호사 또는 어르신 코드입니다.')
    }
    if (!isIsoDate(input.recordDate)) fail(400, '작성일 형식(YYYY-MM-DD)을 확인해 주세요.')
    if (!input.recordText.trim()) fail(400, '기록 내용을 입력해 주세요.')
    const d = readData()
    const rec: PreRecord = { id: newDemoId(), caregiver_code: input.caregiverCode, recipient_code: input.recipientCode, record_date: input.recordDate, record_text: input.recordText.trim(), writing_seconds: input.writingSeconds, source: input.source }
    writeData({ ...d, preRecords: [...d.preRecords, rec] })
  },
  async hidePreRecord(id) {
    requireAdmin()
    const d = readData()
    writeData({ ...d, preRecords: d.preRecords.filter((r) => r.id !== id) })
  },
  async exportCsv(type) {
    requireAdmin()
    const d = readData()
    const people = consentedMap(d.participants)
    const date = new Date().toISOString().slice(0, 10)
    if (type === 'research_pre') {
      download(`${type}-demo-${date}.csv`, toCsv(PRE_HEADERS, preRows(d.preRecords, people, d.cutoffDate)))
    } else if (type === 'research_weekly') {
      download(`${type}-demo-${date}.csv`, toCsv(WEEKLY_HEADERS, weeklyRows(readWeekly(), people, d.cutoffDate)))
    } else {
      const daily = demoAllReports().filter((r) => r.report_source === 'live' && r.status === 'submitted' && r.transcript_only)
      download(`${type}-demo-${date}.csv`, toCsv(DAILY_HEADERS, dailyRows(daily, people, d.cutoffDate)))
    }
  },
}
