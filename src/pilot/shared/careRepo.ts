import { api } from './api'
import type { AiTurnResult, CareReportDetail, CareReportListItem, CareReportPatchInput, CareReportCreateInput, FollowupItem } from './types'

/** /care 화면이 데이터에 접근하는 방식을 추상화한다. 실증 모드(real)는 서버 API를
 * 거치고, 데모 모드(demo)는 브라우저 localStorage만 쓴다 — 화면(CareApp)은 어느
 * 쪽인지 몰라도 되게 한다. */
export interface CareRepo {
  login(code: string, pin: string): Promise<void>
  logout(): Promise<void>
  getSession(): Promise<{
    authenticated: boolean
    participantCode?: string
    today: string
    dailyReportToday: { id: string; status: string } | null
    recipientCodes: string[]
  }>
  listReports(): Promise<CareReportListItem[]>
  getReport(id: string): Promise<CareReportDetail>
  createReport(input: CareReportCreateInput): Promise<{ report: CareReportDetail; resumed: boolean }>
  patchReport(input: CareReportPatchInput): Promise<CareReportDetail>
  aiTurn(rawInput: string, history: FollowupItem[]): Promise<AiTurnResult>
}

export const realCareRepo: CareRepo = {
  async login(code, pin) {
    await api.post('/api/care/login', { code, pin })
  },
  async logout() {
    await api.del('/api/care/login').catch(() => undefined)
  },
  async getSession() {
    return api.get('/api/care/session')
  },
  async listReports() {
    const res = await api.get<{ reports: CareReportListItem[] }>('/api/care/reports')
    return res.reports
  },
  async getReport(id) {
    const res = await api.get<{ report: CareReportDetail }>(`/api/care/reports?id=${id}`)
    return res.report
  },
  async createReport(input) {
    const res = await api.post<{ report: CareReportDetail; resumed: boolean }>('/api/care/reports', input)
    return res
  },
  async patchReport(input) {
    const res = await api.patch<{ report: CareReportDetail }>('/api/care/reports', input)
    return res.report
  },
  async aiTurn(rawInput, history) {
    return api.post<AiTurnResult>('/api/care/ai-turn', { rawInput, history })
  },
}
