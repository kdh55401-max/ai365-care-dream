import { api } from './api'
import type { WeeklyDraft } from './researchRepo'
import type { PreRecord, ResearchExportType, ResearchParticipant } from '../../../shared/researchExport'

export interface ResearchDay {
  id: string
  participant_code: string
  recipient_code: string
  report_date: string
  raw_input: string
  followup_answers: Array<{ question: string; answer: string }>
  completion_seconds: number | null
  submitted_at: string | null
}

export interface ResearchWeek {
  weekStart: string
  reports: ResearchDay[]
  weeklies: WeeklyDraft[]
  /** 주간 표(weekly_drafts)가 DB에 있는지. 없으면 하루 기록만 보인다. */
  weeklyReady: boolean
}

export interface WeeklyReviewInput {
  id: string
  adminFinalText?: string
  adminNote?: string
  adminFollowup?: string
  confirm?: boolean
  expectedUpdatedAt: string
}

export interface ResearchDataView {
  cutoffDate: string | null
  participants: ResearchParticipant[]
  preRecords: PreRecord[]
}

export interface PreRecordInput {
  caregiverCode: string
  recipientCode: string
  recordDate: string
  recordText: string
  writingSeconds: number | null
  source: PreRecord['source']
}

/** 관리자 연구 화면 데이터 접근(실서버/시연). AI를 부르지 않는다. */
export interface ResearchAdminRepo {
  week(weekStart: string): Promise<ResearchWeek>
  review(input: WeeklyReviewInput): Promise<{ weekly: WeeklyDraft }>
  data(): Promise<ResearchDataView>
  setCutoff(cutoffDate: string | null): Promise<void>
  saveParticipant(input: { code: string; consented: boolean; consentDate: string | null; highBaseline: boolean; note: string }): Promise<void>
  addPreRecord(input: PreRecordInput): Promise<void>
  hidePreRecord(id: string): Promise<void>
  exportCsv(type: ResearchExportType): Promise<void>
}

export const realResearchAdminRepo: ResearchAdminRepo = {
  week(weekStart) {
    return api.get<ResearchWeek>(`/api/admin/reports?view=research_week&week=${weekStart}`)
  },
  review(input) {
    return api.patch<{ weekly: WeeklyDraft }>('/api/admin/reports', { op: 'weekly_review', ...input })
  },
  data() {
    return api.get<ResearchDataView>('/api/admin/participants?view=research')
  },
  async setCutoff(cutoffDate) {
    await api.post('/api/admin/participants', { op: 'research_cutoff', cutoffDate })
  },
  async saveParticipant(input) {
    await api.post('/api/admin/participants', { op: 'research_participant', ...input })
  },
  async addPreRecord(input) {
    await api.post('/api/admin/participants', { op: 'research_pre_add', ...input })
  },
  async hidePreRecord(id) {
    await api.post('/api/admin/participants', { op: 'research_pre_hide', id })
  },
  async exportCsv(type) {
    window.open(`/api/admin/export?type=${type}`, '_blank')
  },
}
