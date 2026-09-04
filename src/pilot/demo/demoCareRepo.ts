import type { CareRepo } from '../shared/careRepo'
import type { CareReportRecord } from '../../../shared/careTypes'
import {
  DEMO_RECIPIENT_CODES,
  demoAllReports,
  demoCareLogin,
  demoCareLogout,
  demoCareSession,
  demoCreateReport,
  demoGetReport,
  demoUpdateReport,
  newDemoId,
} from './demoStore'
import { runDemoAiTurn } from './demoAiEngine'

function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function newReportRecord(input: {
  participantCode: string
  recipientCode: string
  reportType: 'daily' | 'additional'
  inputMethod: 'voice' | 'text'
  reportSource: 'live' | 'scenario'
  scenarioId: string | null
}): CareReportRecord {
  const now = new Date().toISOString()
  return {
    id: newDemoId(),
    participant_code: input.participantCode,
    recipient_code: input.recipientCode,
    report_type: input.reportType,
    report_date: todayKst(),
    status: 'draft',
    input_method: input.inputMethod,
    started_at: now,
    submitted_at: null,
    completion_seconds: null,
    raw_input: '',
    followup_questions: [],
    followup_answers: [],
    ai_generated_report: null,
    caregiver_final_report: null,
    initial_status_choice: null,
    no_change_initial_input: false,
    observed_domains_json: [],
    changed_domains_json: [],
    unobserved_domains_json: [],
    uncertain_domains_json: [],
    no_change_followup_count: 0,
    no_change_followup_answered: 0,
    initial_information_count: 0,
    final_information_count: 0,
    information_added_count: 0,
    no_information_report: false,
    report_source: input.reportSource,
    scenario_id: input.scenarioId,
    raw_immediately_actionable: null,
    raw_followup_needed: null,
    raw_completeness_score: null,
    raw_eval_note: null,
    raw_evaluated_at: null,
    ai_immediately_actionable: null,
    ai_followup_needed: null,
    ai_completeness_score: null,
    actual_followup_type: null,
    ai_usefulness_score: null,
    ai_inaccuracy_detected: null,
    ai_eval_note: null,
    manager_status: null,
    ai_evaluated_at: null,
    deleted: false,
    created_at: now,
    updated_at: now,
  }
}

function patchToRecord(patch: Record<string, unknown>): Partial<CareReportRecord> {
  const map: Record<string, string> = {
    rawInput: 'raw_input',
    inputMethod: 'input_method',
    followupQuestions: 'followup_questions',
    followupAnswers: 'followup_answers',
    aiGeneratedReport: 'ai_generated_report',
    caregiverFinalReport: 'caregiver_final_report',
    initialStatusChoice: 'initial_status_choice',
    noChangeInitialInput: 'no_change_initial_input',
    observedDomains: 'observed_domains_json',
    changedDomains: 'changed_domains_json',
    unobservedDomains: 'unobserved_domains_json',
    uncertainDomains: 'uncertain_domains_json',
    noChangeFollowupCount: 'no_change_followup_count',
    noChangeFollowupAnswered: 'no_change_followup_answered',
    initialInformationCount: 'initial_information_count',
    finalInformationCount: 'final_information_count',
    informationAddedCount: 'information_added_count',
    noInformationReport: 'no_information_report',
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id' || key === 'submit') continue
    const target = map[key]
    if (target) out[target] = value
  }
  return out as Partial<CareReportRecord>
}

export const demoCareRepo: CareRepo = {
  async login(code, pin) {
    if (!demoCareLogin(code, pin)) throw Object.assign(new Error('참여자 코드 또는 PIN이 올바르지 않습니다.'), { status: 401 })
  },
  async logout() {
    demoCareLogout()
  },
  async getSession() {
    const code = demoCareSession()
    if (!code) return { authenticated: false, today: todayKst(), dailyReportToday: null, recipientCodes: DEMO_RECIPIENT_CODES }
    const today = todayKst()
    const daily = demoAllReports().find(
      (r) => r.participant_code === code && r.report_date === today && r.report_type === 'daily' && r.report_source === 'live',
    )
    return {
      authenticated: true,
      participantCode: code,
      today,
      dailyReportToday: daily ? { id: daily.id, status: daily.status } : null,
      recipientCodes: DEMO_RECIPIENT_CODES,
    }
  },
  async listReports() {
    const code = demoCareSession()
    if (!code) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 })
    return demoAllReports()
      .filter((r) => r.participant_code === code)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  },
  async getReport(id) {
    const report = demoGetReport(id)
    if (!report) throw Object.assign(new Error('보고를 찾을 수 없습니다.'), { status: 404 })
    return report
  },
  async createReport(input) {
    const code = demoCareSession()
    if (!code) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 })
    const reportSource = input.reportSource ?? 'live'
    const scenarioId = input.scenarioId ?? null

    if (reportSource === 'live' && input.reportType === 'daily') {
      const today = todayKst()
      const existing = demoAllReports().find(
        (r) => r.participant_code === code && r.report_date === today && r.report_type === 'daily' && r.report_source === 'live',
      )
      if (existing) {
        if (existing.status === 'submitted') {
          throw Object.assign(
            new Error('오늘의 기본 돌봄보고를 이미 제출했습니다. 추가 상태변화 보고를 이용해 주세요.'),
            { status: 409 },
          )
        }
        return { report: existing, resumed: true }
      }
    }

    const record = newReportRecord({
      participantCode: code,
      recipientCode: input.recipientCode,
      reportType: input.reportType,
      inputMethod: input.inputMethod,
      reportSource,
      scenarioId,
    })
    demoCreateReport(record)
    return { report: record, resumed: false }
  },
  async patchReport(input) {
    const existing = demoGetReport(input.id)
    if (!existing) throw Object.assign(new Error('보고를 찾을 수 없습니다.'), { status: 404 })
    if (existing.status !== 'draft') throw Object.assign(new Error('이미 제출된 보고는 수정할 수 없습니다.'), { status: 409 })

    const patch = patchToRecord(input as unknown as Record<string, unknown>)
    if (input.submit) {
      const startedAt = new Date(existing.started_at).getTime()
      patch.status = 'submitted'
      patch.submitted_at = new Date().toISOString()
      patch.completion_seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    }
    const updated = demoUpdateReport(input.id, patch)
    if (!updated) throw new Error('보고를 저장하지 못했습니다.')
    return updated
  },
  async aiTurn(rawInput, history) {
    return runDemoAiTurn(rawInput, history)
  },
}
