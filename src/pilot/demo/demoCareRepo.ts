import { sameFinalReport } from '../../../shared/reportRetry'
import type { CareRepo } from '../shared/careRepo'
import type { CareReportRecord } from '../../../shared/careTypes'
import {
  demoAllReports,
  demoAssignedRecipients,
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

/** 데모 엔진은 로컬 계산이라 즉시 응답해, 실제 Gemini 호출의 네트워크 지연 구간에서만
 * 드러나는 화면 버그(예: 질문 전환 중 대화 영역이 비어 보이는 문제)를 데모로는 재현할
 * 수 없었다. `?e2eAiDelayMs=N`을 붙이면 이 구간에서만 인위적으로 지연시켜, 그 버그를
 * 자동 테스트(e2e)로 반복 재현·검증할 수 있게 한다.
 *
 * 운영 안전성(중요 — 실제 사용자 경로에는 영향을 줄 수 없는 구조):
 * 1) 이 함수는 demoCareRepo 안에만 있고, demoCareRepo는 isDemoMode()(URL의
 *    ?demo=1)가 true일 때만 CareApp이 선택하는 저장소다. 실제 참여자가 쓰는
 *    /care(데모 파라미터 없음)는 항상 realCareRepo를 쓰고, realCareRepo.aiTurn은
 *    서버 API(/api/care/ai-turn)를 그대로 호출할 뿐 이 함수를 참조하지 않는다 —
 *    즉 ?e2eAiDelayMs=를 실제 운영 URL에 붙여도 아무 효과가 없다(?demo=1이 함께
 *    없으면 애초에 이 코드 경로 자체를 안 탄다).
 * 2) 데모 모드 안에서도 최대 10초로 상한을 둬(Math.min) 외부 입력값으로 무한정
 *    지연시킬 수 없게 한다.
 */
function e2eAiDelayMs(): number {
  const raw = new URLSearchParams(window.location.search).get('e2eAiDelayMs')
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 0
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
    emergency_flagged: false,
    ai_fallback_used: null,
    ai_fallback_stage: null,
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
    admin_final_report: null,
    review_status: 'pending',
    review_note: null,
    review_note_visible_to_caregiver: false,
    reviewed_at: null,
    review_history: [],
    last_review_request_id: null,
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
    emergencyFlagged: 'emergency_flagged',
    aiFallbackUsed: 'ai_fallback_used',
    aiFallbackStage: 'ai_fallback_stage',
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
    if (!code) return { authenticated: false, today: todayKst(), dailyReportToday: null, recipientCodes: [] }
    const today = todayKst()
    const daily = demoAllReports().find(
      (r) => r.participant_code === code && r.report_date === today && r.report_type === 'daily' && r.report_source === 'live',
    )
    return {
      authenticated: true,
      participantCode: code,
      today,
      dailyReportToday: daily ? { id: daily.id, status: daily.status } : null,
      // 로그인한 요양보호사에게 배정된 수급자만 돌려준다 — 다른 요양보호사의
      // 수급자로 폴백하지 않는다(배정이 없으면 빈 배열 그대로).
      recipientCodes: demoAssignedRecipients(code),
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
    // 실서버(api/care/reports.ts)는 GET id 조회에 항상 session.participantCode 필터를
    // 건다 — 이 데모 경로는 그 필터가 빠져 있어, 다른 참여자의 보고 id를 알면(추측
    // 등) 그 보고의 관리자 응답까지 그대로 읽을 수 있는 문제가 있었다(이번 작업에서
    // "다른 작성자의 기록 id로는 조회할 수 없어야 한다"는 요구를 확인하며 발견).
    // 로그인한 참여자 본인 소유가 아니면 존재 여부도 구분하지 않고 동일하게 404를
    // 던진다(id가 있는지 없는지로 다른 참여자의 존재를 유추할 수 없게 함).
    const code = demoCareSession()
    if (!code) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 })
    const report = demoGetReport(id)
    if (!report || report.participant_code !== code) {
      throw Object.assign(new Error('보고를 찾을 수 없습니다.'), { status: 404 })
    }
    return report
  },
  async createReport(input) {
    const code = demoCareSession()
    if (!code) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 })
    if (!demoAssignedRecipients(code).includes(input.recipientCode)) {
      throw Object.assign(new Error('배정되지 않은 수급자입니다.'), { status: 403 })
    }
    const reportSource = input.reportSource ?? 'live'
    const scenarioId = input.scenarioId ?? null

    // "하루 1회"는 요양보호사 전체가 아니라 지금 이 수급자 기준이다 — 실서버
    // (api/care/reports.ts)와 동일하게 recipient_code까지 함께 확인해야, 다른
    // 수급자(A02) 제출 때문에 이 수급자(A01)의 기본보고 시작이 막히지 않는다
    // (설계 검토 결정 D3).
    if (reportSource === 'live' && input.reportType === 'daily') {
      const today = todayKst()
      const existing = demoAllReports().find(
        (r) =>
          r.participant_code === code &&
          r.recipient_code === input.recipientCode &&
          r.report_date === today &&
          r.report_type === 'daily' &&
          r.report_source === 'live',
      )
      if (existing) {
        if (existing.status === 'submitted') {
          throw Object.assign(
            new Error('오늘 이 수급자의 기본 돌봄보고를 이미 제출했습니다. 추가 상태변화 보고를 이용해 주세요.'),
            { status: 409 },
          )
        }
        return { report: existing, resumed: true }
      }
    }

    // 실서버(api/care/reports.ts)와 동일하게, "응답만 유실된" 추가보고 재시도가 새
    // 보고를 중복 생성하지 않도록 방금(2분 이내) 만든 빈 draft가 있으면 재사용한다.
    if (reportSource === 'live' && input.reportType === 'additional') {
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000
      const recentEmptyDraft = demoAllReports()
        .filter(
          (r) =>
            r.participant_code === code &&
            r.recipient_code === input.recipientCode &&
            r.report_type === 'additional' &&
            r.report_source === 'live' &&
            r.status === 'draft' &&
            r.raw_input === '' &&
            new Date(r.created_at).getTime() >= twoMinutesAgo,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      if (recentEmptyDraft) return { report: recentEmptyDraft, resumed: true }
    }

    if (reportSource === 'scenario') {
      const draft = demoAllReports().find(r => r.participant_code === code && r.recipient_code === input.recipientCode && r.report_source === 'scenario' && r.scenario_id === scenarioId && r.status === 'draft')
      if (draft) return { report: draft, resumed: true }
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
    if (existing.status === 'submitted' && input.submit && sameFinalReport(existing.caregiver_final_report, input.caregiverFinalReport)) return existing
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
  async aiTurn(rawInput, history, forceFinalize) {
    const delay = e2eAiDelayMs()
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    return runDemoAiTurn(rawInput, history, forceFinalize)
  },
}
