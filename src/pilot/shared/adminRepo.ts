import { api, ApiClientError } from './api'
import type { CareReportRecord, StructuredReport } from './types'
import type { StatsResult } from '../../../shared/statsCalc'
import type { Organization } from '../../../shared/organization'
import type { RecipientSummary, RecipientTimeline, ReviewQueueItem, TimelinePeriod } from '../../../shared/recipientHub'
import type { WorkBoard } from '../../../shared/workBoard'
import type { ActionMutationInput, CreateActionInput, DecisionInput, SafetyReviewInput } from '../../../shared/workflow'
import type { ActionDetailView, ActionFilter, ActionSummary, RecipientWorkflowView, ReportWorkflowView } from '../../../shared/workflowViews'
import type {
  ChooseReferenceInput,
  LinkActionInput,
  RecipientBaselineView,
  RegisterDocumentInput,
  SaveEntryInput,
  SetEntryStatusInput,
  SourceDocument,
  WithdrawDocumentInput,
} from '../../../shared/baseline'
import type { CandidateReviewInput } from '../../../shared/changeCandidates'
import type { RecipientObservationsView } from '../../../shared/observationViews'
import type { OperationMetricsView, OperationPeriod } from '../../../shared/operationMetrics'

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

export interface RecipientHubResponse {
  organization: Organization
  generatedAt: string
  recipients: RecipientSummary[]
  reviewQueue: ReviewQueueItem[]
}

export interface RecipientTimelineResponse {
  organization: Organization
  recipient: RecipientSummary
  timeline: RecipientTimeline
  /** 보고별 판단·안전 검토·조치(2단계). workflowReady=false면 DB 준비 전. */
  workflow: RecipientWorkflowView
}

export interface WorkBoardResponse {
  organization: Organization
  board: WorkBoard
}

export interface ActionListResponse {
  workflowReady: boolean
  filter: ActionFilter
  asOf: string
  actions: ActionSummary[]
}

export type DecisionRequest = DecisionInput
export type SafetyReviewRequest = SafetyReviewInput
export type CreateActionRequest = CreateActionInput
export type MutateActionRequest = ActionMutationInput

/** 4단계 기준정보 요청(원본 올리기는 파일과 함께 따로 보낸다). */
export type BaselineOpRequest =
  | ({ baselineOp: 'withdraw_document' } & WithdrawDocumentInput)
  | ({ baselineOp: 'save_entry' } & SaveEntryInput)
  | ({ baselineOp: 'set_entry_status' } & SetEntryStatusInput)
  | ({ baselineOp: 'choose_reference' } & ChooseReferenceInput)
export type UploadDocumentRequest = Omit<RegisterDocumentInput, 'originalFilename'>
export interface UnlinkActionBaselineRequest {
  actionId: string
  linkId: string
  reason: string
  requestId: string
  enteredByLabel?: string | null
}

/** 업무 저장 실패(409 충돌·503 준비 전 등). 입력값은 호출부가 지우지 않고 유지한다. */
export class WorkflowRequestError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface AdminRepo {
  login(password: string): Promise<void>
  logout(): Promise<void>
  getSession(): Promise<{ authenticated: boolean; organization?: Organization | null }>
  /** 기관 수급자 목록 + 검토 대기 목록. orgId가 세션 기관과 다르면 403. */
  getRecipientHub(orgId: string): Promise<RecipientHubResponse>
  /** 수급자 한 명의 보고 타임라인. 기관 범위 밖이면 403, 없는 수급자면 404. */
  getRecipientTimeline(orgId: string, code: string, period: TimelinePeriod): Promise<RecipientTimelineResponse>
  /** 기관 첫 화면 업무 카드 + 전체 목록(서버가 전체 범위로 계산). */
  getWorkBoard(orgId: string): Promise<WorkBoardResponse>
  getReportWorkflow(orgId: string, reportId: string): Promise<ReportWorkflowView>
  listActions(orgId: string, filter: ActionFilter, recipientCode?: string): Promise<ActionListResponse>
  getAction(orgId: string, actionId: string): Promise<ActionDetailView>
  recordDecision(orgId: string, input: DecisionRequest): Promise<ReportWorkflowView>
  recordSafetyReview(orgId: string, input: SafetyReviewRequest): Promise<ReportWorkflowView>
  createAction(orgId: string, input: CreateActionRequest): Promise<ActionDetailView>
  mutateAction(orgId: string, input: MutateActionRequest): Promise<ActionDetailView>
  /** 4단계: 수급자 기준문서·기준정보. 저장소 준비 전이면 ready:false(가짜 0 없음). */
  getRecipientBaseline(orgId: string, recipientCode: string): Promise<RecipientBaselineView>
  /** 원본 올리기 — 같은 requestId로 다시 보내면 한 벌만 저장된다. */
  uploadDocument(orgId: string, input: UploadDocumentRequest, file: File): Promise<{ document: SourceDocument; baseline: RecipientBaselineView }>
  /** 원본을 새 창에서 열 주소(관리자 세션 필요). */
  documentFileUrl(orgId: string, documentId: string): Promise<string>
  baselineOp(orgId: string, input: BaselineOpRequest): Promise<RecipientBaselineView>
  linkActionBaseline(orgId: string, input: LinkActionInput): Promise<ActionDetailView>
  unlinkActionBaseline(orgId: string, input: UnlinkActionBaselineRequest): Promise<ActionDetailView>
  /** 5단계: 관찰 달력(7·30일)·반복 보고 후보·값 비교·판단 상태·열린 조치. */
  getRecipientObservations(orgId: string, recipientCode: string, window: 7 | 30): Promise<RecipientObservationsView>
  /** 5단계: 후보에 대한 관리자 판단(서버가 후보를 다시 계산해 열쇠를 확인한다). */
  reviewCandidate(orgId: string, input: CandidateReviewInput & { recipientCode: string; window: 7 | 30 }): Promise<RecipientObservationsView>
  /** 6단계: 운영 지표(2·3단계 이벤트 기반). 연구용 실증 지표(getStats)와 분모·기간이 다르다. */
  getOperationMetrics(orgId: string, period: OperationPeriod): Promise<OperationMetricsView>
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

function workflowUrl(orgId: string): string {
  return `/api/admin/workflow?org=${encodeURIComponent(orgId)}`
}

async function workflowPost<T>(orgId: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await api.post<T>(workflowUrl(orgId), body)
  } catch (e) {
    if (e instanceof ApiClientError) throw new WorkflowRequestError(e.status, e.message)
    throw e
  }
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('')
}

function base64Utf8(text: string): string {
  let bin = ''
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte)
  return btoa(bin)
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
  async getRecipientHub(orgId) {
    return api.get<RecipientHubResponse>(`${workflowUrl(orgId)}&view=recipients`)
  },
  async getRecipientTimeline(orgId, code, period) {
    return api.get<RecipientTimelineResponse>(`${workflowUrl(orgId)}&view=recipient&code=${encodeURIComponent(code)}&period=${period}`)
  },
  async getWorkBoard(orgId) {
    return api.get<WorkBoardResponse>(`${workflowUrl(orgId)}&view=board`)
  },
  async getReportWorkflow(orgId, reportId) {
    return api.get<ReportWorkflowView>(`${workflowUrl(orgId)}&view=report&reportId=${encodeURIComponent(reportId)}`)
  },
  async listActions(orgId, filter, recipientCode) {
    const recipient = recipientCode ? `&recipient=${encodeURIComponent(recipientCode)}` : ''
    return api.get<ActionListResponse>(`${workflowUrl(orgId)}&view=actions&filter=${filter}${recipient}`)
  },
  async getAction(orgId, actionId) {
    return api.get<ActionDetailView>(`${workflowUrl(orgId)}&view=action&id=${encodeURIComponent(actionId)}`)
  },
  async recordDecision(orgId, input) {
    return workflowPost<ReportWorkflowView>(orgId, { op: 'decide', ...input })
  },
  async recordSafetyReview(orgId, input) {
    return workflowPost<ReportWorkflowView>(orgId, { op: 'safety_review', ...input })
  },
  async createAction(orgId, input) {
    return workflowPost<ActionDetailView>(orgId, { op: 'create_action', ...input })
  },
  async mutateAction(orgId, input) {
    // 조치 변경 종류(input.op)는 body의 mutation 필드로 옮기고, 요청 종류는 mutate_action으로 둔다.
    const { op, ...rest } = input
    return workflowPost<ActionDetailView>(orgId, { ...rest, op: 'mutate_action', mutation: op })
  },
  async getRecipientBaseline(orgId, recipientCode) {
    return api.get<RecipientBaselineView>(`${workflowUrl(orgId)}&view=baseline&code=${encodeURIComponent(recipientCode)}`)
  },
  async uploadDocument(orgId, input, file) {
    const bytes = await file.arrayBuffer()
    const meta = { ...input, originalFilename: file.name, sha256: await sha256Hex(bytes) }
    let res: Response
    try {
      res = await fetch(`${workflowUrl(orgId)}&op=upload_document`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/octet-stream', 'x-document-meta': base64Utf8(JSON.stringify(meta)) },
        body: bytes,
      })
    } catch {
      throw new WorkflowRequestError(0, '연결이 끊겨 올렸는지 확인하지 못했습니다. 같은 파일로 다시 시도하면 한 번만 저장됩니다.')
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const message = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : `올리기에 실패했습니다 (${res.status})`
      throw new WorkflowRequestError(res.status, message)
    }
    return data as { document: SourceDocument; baseline: RecipientBaselineView }
  },
  async documentFileUrl(orgId, documentId) {
    return `${workflowUrl(orgId)}&view=document_file&id=${encodeURIComponent(documentId)}`
  },
  async baselineOp(orgId, input) {
    return workflowPost<RecipientBaselineView>(orgId, { ...input, op: 'baseline' })
  },
  async linkActionBaseline(orgId, input) {
    return workflowPost<ActionDetailView>(orgId, { ...input, op: 'link_baseline' })
  },
  async unlinkActionBaseline(orgId, input) {
    return workflowPost<ActionDetailView>(orgId, { ...input, op: 'unlink_baseline' })
  },
  async getRecipientObservations(orgId, recipientCode, window) {
    return api.get<RecipientObservationsView>(`${workflowUrl(orgId)}&view=observations&code=${encodeURIComponent(recipientCode)}&window=${window}`)
  },
  async reviewCandidate(orgId, input) {
    return workflowPost<RecipientObservationsView>(orgId, { ...input, window: String(input.window), op: 'candidate_review' })
  },
  async getOperationMetrics(orgId, period) {
    return api.get<OperationMetricsView>(`${workflowUrl(orgId)}&view=operations&period=${period}`)
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
