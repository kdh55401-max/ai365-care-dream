import type { AdminRepo, ReportDetail, ReportListItem, StatsResponse } from '../shared/adminRepo'
import { triggerDownload } from '../shared/adminRepo'
import {
  buildCumulativeSeries,
  buildParticipationGrid,
  computeScenarioStats,
  computeStats,
  pilotDateRange,
} from '../../../shared/statsCalc'
import { toCsv } from '../../../shared/csv'
import {
  DEMO_PIN,
  demoAdminLogin,
  demoAdminLogout,
  demoAdminSession,
  demoAllReports,
  demoDeleteReport,
  demoGetReport,
  demoListParticipants,
  demoResetParticipantPin,
  demoUpdateReport,
} from './demoStore'

const PILOT_START = '2026-09-07'
const PILOT_END = '2026-09-18'

function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function randomPin(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}

export const demoAdminRepo: AdminRepo = {
  async login(password) {
    if (!demoAdminLogin(password)) throw Object.assign(new Error('비밀번호가 올바르지 않습니다.'), { status: 401 })
  },
  async logout() {
    demoAdminLogout()
  },
  async getSession() {
    return { authenticated: demoAdminSession() }
  },
  async getStats(): Promise<StatsResponse> {
    const rows = demoAllReports()
    const today = todayKst()
    const dates = pilotDateRange(PILOT_START, PILOT_END)
    return {
      pilotPeriod: { start: PILOT_START, end: PILOT_END },
      today,
      generatedAt: new Date().toISOString(),
      stats: computeStats(rows, today),
      scenarioStats: computeScenarioStats(rows),
      participationGrid: buildParticipationGrid(rows, dates),
      cumulativeSeries: buildCumulativeSeries(rows, dates, today),
    }
  },
  async listReports(source = 'live') {
    const rows = demoAllReports()
    const filtered = source === 'all' ? rows : rows.filter((r) => r.report_source === source)
    return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at)) as ReportListItem[]
  },
  async getReport(id) {
    const report = demoGetReport(id)
    if (!report) throw Object.assign(new Error('보고를 찾을 수 없습니다.'), { status: 404 })
    return report as ReportDetail
  },
  async evaluateRaw(id, payload) {
    const existing = demoGetReport(id)
    if (!existing) throw new Error('보고를 찾을 수 없습니다.')
    const updated = demoUpdateReport(id, {
      raw_immediately_actionable: payload.rawImmediatelyActionable as boolean,
      raw_followup_needed: payload.rawFollowupNeeded as boolean,
      raw_completeness_score: payload.rawCompletenessScore as number,
      raw_eval_note: (payload.rawEvalNote as string) ?? null,
      raw_evaluated_at: new Date().toISOString(),
    })
    return updated as ReportDetail
  },
  async evaluateAi(id, payload) {
    const existing = demoGetReport(id)
    if (!existing) throw new Error('보고를 찾을 수 없습니다.')
    if (!existing.raw_evaluated_at) throw new Error('먼저 원문 평가를 완료해야 합니다.')
    const updated = demoUpdateReport(id, {
      ai_immediately_actionable: payload.aiImmediatelyActionable as boolean,
      ai_followup_needed: payload.aiFollowupNeeded as boolean,
      ai_completeness_score: payload.aiCompletenessScore as number,
      actual_followup_type: payload.actualFollowupType as 'none' | 'sms' | 'call',
      ai_usefulness_score: payload.aiUsefulnessScore as number,
      ai_inaccuracy_detected: payload.aiInaccuracyDetected as boolean,
      ai_eval_note: (payload.aiEvalNote as string) ?? null,
      manager_status: (payload.managerStatus as 'confirmed' | 'needs_followup' | 'called' | 'closed') ?? null,
      ai_evaluated_at: new Date().toISOString(),
    })
    return updated as ReportDetail
  },
  async deleteReport(id, reason) {
    demoDeleteReport(id, reason)
  },
  async listParticipants() {
    return demoListParticipants().map((p) => ({ code: p.code, active: p.active, pinSet: true, updatedAt: '' }))
  },
  async resetPin(code) {
    const pin = randomPin()
    demoResetParticipantPin(code, pin)
    return { code, pin }
  },
  async exportCsv(type) {
    const rows = demoAllReports().filter((r) => r.status === 'submitted')
    const headers =
      type === 'full'
        ? ['보고ID', '참여자코드', '수급자코드', '보고유형', '보고일자', '최초원문', '최종보고_관찰변화']
        : ['보고ID', '참여자코드', '수급자코드', '보고유형', '보고일자']
    const body = rows.map((r) =>
      type === 'full'
        ? [r.id, r.participant_code, r.recipient_code, r.report_type, r.report_date, r.raw_input, r.caregiver_final_report?.change ?? '']
        : [r.id, r.participant_code, r.recipient_code, r.report_type, r.report_date],
    )
    triggerDownload(`care-report-demo-${type}-${todayKst()}.csv`, toCsv(headers, body), 'text/csv;charset=utf-8')
  },
}

export const DEMO_PIN_HINT = DEMO_PIN
