import { api } from './api'
import type { AiTurnResult, CareReportDetail, CareReportListItem, CareReportPatchInput, CareReportCreateInput, FollowupItem } from './types'
import type { CenterRequestView, CenterResponseResult } from '../../../shared/fieldRequests'
import type { FieldResponseInput } from '../../../shared/workflow'

/** 보고 제출 + 센터 요청 답변(3단계). 답변은 보고 제출 뒤 서버가 원 요청·조치·보고에 연결한다. */
export interface CareSubmitInput {
  id: string
  caregiverFinalReport: CareReportPatchInput['caregiverFinalReport']
  centerResponses: FieldResponseInput[]
}

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
  /** 최종 제출 — 같은 내용으로 다시 보내면 보고는 한 번만 저장되고 답변만 이어서 저장된다. */
  submitReport(input: CareSubmitInput): Promise<{ report: CareReportDetail; centerResponses: CenterResponseResult[] }>
  aiTurn(rawInput: string, history: FollowupItem[], forceFinalize?: boolean): Promise<AiTurnResult>
  /** 3단계: 이 수급자에게 게시된 센터 요청(현재 배정·지정 대상 기준, 공개 문구만). */
  listCenterRequests(recipientCode: string): Promise<{ ready: boolean; requests: CenterRequestView[] }>
  /** 3단계: 요청이 화면에 실제로 표시됐다는 기록(첫 표시 1회). */
  markCenterRequestsShown(requestIds: string[]): Promise<void>
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
  async submitReport(input) {
    const res = await api.patch<{ report: CareReportDetail; centerResponses?: CenterResponseResult[] }>('/api/care/reports', {
      id: input.id,
      caregiverFinalReport: input.caregiverFinalReport,
      submit: true,
      centerResponses: input.centerResponses,
    })
    return { report: res.report, centerResponses: res.centerResponses ?? [] }
  },
  async aiTurn(rawInput, history, forceFinalize) {
    return api.post<AiTurnResult>('/api/care/ai-turn', { rawInput, history, forceFinalize })
  },
  async listCenterRequests(recipientCode) {
    return api.get<{ ready: boolean; requests: CenterRequestView[] }>(`/api/care/reports?view=center_requests&recipient=${encodeURIComponent(recipientCode)}`)
  },
  async markCenterRequestsShown(requestIds) {
    if (requestIds.length === 0) return
    await api.post('/api/care/reports', { op: 'mark_center_requests_shown', requestIds })
  },
}
