import { api } from './api'

/** 주간 상태변화기록 초안 1건(요양보호사·어르신·주 단위). */
export interface WeeklyDraft {
  id: string
  participant_code: string
  recipient_code: string
  week_start: string
  source_report_ids: string[]
  ai_draft: string | null
  ai_model: string | null
  ai_created_at: string | null
  caregiver_text: string | null
  caregiver_edit_seconds: number | null
  status: 'draft' | 'sent' | 'confirmed'
  sent_at: string | null
  admin_final_text: string | null
  admin_note: string | null
  admin_followup: string | null
  admin_confirmed_at: string | null
  created_at: string
  updated_at: string
}

export interface AskResult {
  questions: string[]
  source: 'ai' | 'rule'
  previous: { date: string } | null
}

/** 연구용 요양보호사 흐름의 데이터 접근(실서버/시연). AI는 ask·prepareWeekly에서만 부른다. */
export interface ResearchRepo {
  ask(recipientCode: string, rawInput: string): Promise<AskResult>
  getWeekly(recipientCode: string, weekStart: string): Promise<{ weekly: WeeklyDraft | null; dayCount: number }>
  prepareWeekly(recipientCode: string, weekStart: string): Promise<{ weekly: WeeklyDraft; reused: boolean }>
  sendWeekly(id: string, caregiverText: string, editSeconds: number): Promise<{ weekly: WeeklyDraft }>
}

export const realResearchRepo: ResearchRepo = {
  ask(recipientCode, rawInput) {
    return api.post<AskResult>('/api/care/ai-turn', { mode: 'ask', recipientCode, rawInput })
  },
  getWeekly(recipientCode, weekStart) {
    return api.get(`/api/care/reports?view=weekly&recipient=${encodeURIComponent(recipientCode)}&week=${weekStart}`)
  },
  prepareWeekly(recipientCode, weekStart) {
    return api.post('/api/care/ai-turn', { mode: 'weekly', recipientCode, weekStart })
  },
  sendWeekly(id, caregiverText, editSeconds) {
    return api.post('/api/care/reports', { op: 'weekly_send', id, caregiverText, editSeconds })
  },
}
