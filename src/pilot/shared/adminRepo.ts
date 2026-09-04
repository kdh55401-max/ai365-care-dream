import { api } from './api'
import type { CareReportRecord } from './types'
import type { StatsResult } from '../../../shared/statsCalc'

export interface ParticipationCell {
  date: string
  dailySubmitted: boolean
  additionalCount: number
}
export interface ParticipationRow {
  participantCode: string
  cells: ParticipationCell[]
  totalSubmitted: number
}
export interface CumulativePoint {
  date: string
  dailyCumulative: number
  additionalCumulative: number
  totalCumulative: number
  isFuture: boolean
  isToday: boolean
}
export interface ScenarioStats {
  totalCount: number
  targetCount: number
  goal: { numerator: number; denominator: number; percent: number | null }
  byScenario: Array<{ id: string; title: string; count: number }>
  requiredInfoCoverage: { numerator: number; denominator: number; percent: number | null }
  fabricationCount: number
  structuredRate: { numerator: number; denominator: number; percent: number | null }
  expertAppropriatenessStatus: 'not_evaluated'
}

export interface StatsResponse {
  pilotPeriod: { start: string; end: string }
  today: string
  generatedAt: string
  stats: StatsResult
  scenarioStats: ScenarioStats
  participationGrid: ParticipationRow[]
  cumulativeSeries: CumulativePoint[]
}

export type ReportListItem = Partial<CareReportRecord> & { id: string }
export type ReportDetail = CareReportRecord

export interface AdminRepo {
  login(password: string): Promise<void>
  logout(): Promise<void>
  getSession(): Promise<{ authenticated: boolean }>
  getStats(): Promise<StatsResponse>
  listReports(source?: 'live' | 'scenario' | 'all'): Promise<ReportListItem[]>
  getReport(id: string): Promise<ReportDetail>
  evaluateRaw(id: string, payload: Record<string, unknown>): Promise<ReportDetail>
  evaluateAi(id: string, payload: Record<string, unknown>): Promise<ReportDetail>
  deleteReport(id: string, reason: string): Promise<void>
  listParticipants(): Promise<Array<{ code: string; active: boolean; pinSet: boolean; updatedAt: string }>>
  resetPin(code: string): Promise<{ code: string; pin: string }>
  exportCsv(type: 'summary' | 'full'): Promise<void>
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const realAdminRepo: AdminRepo = {
  async login(password) {
    await api.post('/api/admin/login', { password })
  },
  async logout() {
    await api.del('/api/admin/login').catch(() => undefined)
  },
  async getSession() {
    return api.get('/api/admin/session')
  },
  async getStats() {
    return api.get<StatsResponse>('/api/admin/stats')
  },
  async listReports(source = 'live') {
    const res = await api.get<{ reports: ReportListItem[] }>(`/api/admin/reports?source=${source}`)
    return res.reports
  },
  async getReport(id) {
    const res = await api.get<{ report: ReportDetail }>(`/api/admin/reports?id=${id}`)
    return res.report
  },
  async evaluateRaw(id, payload) {
    const res = await api.patch<{ report: ReportDetail }>('/api/admin/reports', { id, stage: 'raw', ...payload })
    return res.report
  },
  async evaluateAi(id, payload) {
    const res = await api.patch<{ report: ReportDetail }>('/api/admin/reports', { id, stage: 'ai', ...payload })
    return res.report
  },
  async deleteReport(id, reason) {
    await api.del(`/api/admin/reports?id=${id}&reason=${encodeURIComponent(reason)}`)
  },
  async listParticipants() {
    const res = await api.get<{ participants: Array<{ code: string; active: boolean; pinSet: boolean; updatedAt: string }> }>(
      '/api/admin/participants',
    )
    return res.participants
  },
  async resetPin(code) {
    return api.post<{ code: string; pin: string }>('/api/admin/participants', { code })
  },
  async exportCsv(type) {
    // 실제 서버는 content-disposition:attachment로 내려주므로 새 창(=현재 세션 쿠키
    // 포함)으로 이동시키는 것으로 충분하다.
    window.open(`/api/admin/export?type=${type}`, '_blank')
  },
}

export { triggerDownload }
