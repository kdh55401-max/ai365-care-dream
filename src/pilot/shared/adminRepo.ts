import { api, ApiClientError } from './api'
import type { CareReportRecord, StructuredReport } from './types'
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

export interface ReviewReportInput {
  id: string
  reviewStatus: 'approved' | 'rejected'
  reviewNote?: string
  /** true면 reviewNote를 요양보호사의 "내가 남긴 돌봄기록" 상세 화면에 공개한다.
   * 관리자가 매번 명시적으로 선택해야 하며, 기본값은 false다. */
  reviewNoteVisibleToCaregiver?: boolean
  adminFinalReport: StructuredReport
  /** CAS용: 관리자가 마지막으로 읽은 updated_at. 서버 값과 다르면 충돌(409)로 거부된다. */
  expectedUpdatedAt?: string
  /** 중복요청 방지용 idempotency key. 같은 값으로 재전송하면 중복 이력 없이 직전 결과를 그대로 반환. */
  requestId?: string
}

/** 저장 실패 시(주로 CAS 충돌 409) 던져지는 에러. 최신 서버 데이터가 실려 있으면
 * 호출부가 입력값을 지우지 않고 재조회를 안내할 수 있다. */
export class ReviewConflictError extends Error {
  latest?: ReportDetail
  constructor(message: string, latest?: ReportDetail) {
    super(message)
    this.name = 'ReviewConflictError'
    this.latest = latest
  }
}

export interface AdminRepo {
  login(password: string): Promise<void>
  logout(): Promise<void>
  getSession(): Promise<{ authenticated: boolean }>
  getStats(): Promise<StatsResponse>
  listReports(source?: 'live' | 'scenario' | 'all'): Promise<ReportListItem[]>
  getReport(id: string): Promise<ReportDetail>
  evaluateRaw(id: string, payload: Record<string, unknown>): Promise<ReportDetail>
  evaluateAi(id: string, payload: Record<string, unknown>): Promise<ReportDetail>
  /** 관리자 검토(승인/반려) — 연구용 1/2단계 평가와 별개의 운영 워크플로우. */
  reviewReport(input: ReviewReportInput): Promise<ReportDetail>
  deleteReport(id: string, reason: string): Promise<void>
  listParticipants(): Promise<Array<{ code: string; active: boolean; pinSet: boolean; updatedAt: string; recipientCodes: string[] }>>
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
  async reviewReport(input) {
    try {
      const res = await api.patch<{ report: ReportDetail }>('/api/admin/reports', {
        id: input.id,
        stage: 'review',
        reviewStatus: input.reviewStatus,
        reviewNote: input.reviewNote,
        reviewNoteVisibleToCaregiver: input.reviewNoteVisibleToCaregiver === true,
        adminFinalReport: input.adminFinalReport,
        expectedUpdatedAt: input.expectedUpdatedAt,
        requestId: input.requestId,
      })
      return res.report
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        const latest = e.body && typeof e.body === 'object' && 'report' in e.body ? (e.body as { report: ReportDetail | null }).report : null
        throw new ReviewConflictError(e.message, latest ?? undefined)
      }
      throw e
    }
  },
  async deleteReport(id, reason) {
    await api.del(`/api/admin/reports?id=${id}&reason=${encodeURIComponent(reason)}`)
  },
  async listParticipants() {
    const res = await api.get<{
      participants: Array<{ code: string; active: boolean; pinSet: boolean; updatedAt: string; recipientCodes: string[] }>
    }>('/api/admin/participants')
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
