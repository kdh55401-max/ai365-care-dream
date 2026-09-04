import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, getQuery, readJsonBody, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { requireCareSession } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { todayKstDateString } from '../_lib/date.js'
import { STANDARD_SCENARIOS } from '../../shared/statsCalc.js'

const CARE_DETAIL_COLUMNS = '*'

const CARE_LIST_COLUMNS =
  'id, recipient_code, report_type, report_date, status, submitted_at, completion_seconds, ' +
  'initial_status_choice, no_information_report, report_source, scenario_id, created_at'

interface StructuredReport {
  change: string
  action: string
  result: string
  escalation: string
}

interface DomainEntry {
  domain: string
  status: string
}

function isStructuredReport(v: unknown): v is StructuredReport {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.change === 'string' &&
    typeof r.action === 'string' &&
    typeof r.result === 'string' &&
    typeof r.escalation === 'string'
  )
}

function isDomainEntryArray(v: unknown): v is DomainEntry[] {
  return Array.isArray(v) && v.every((e) => e && typeof e === 'object' && typeof (e as DomainEntry).domain === 'string' && typeof (e as DomainEntry).status === 'string')
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST', 'PATCH')
    const session = await requireCareSession(req)
    const supabase = getSupabaseAdmin()

    if (req.method === 'GET') {
      const id = getQuery(req).get('id')
      if (id) {
        const { data, error } = await supabase
          .from('reports')
          .select(CARE_DETAIL_COLUMNS)
          .eq('id', id)
          .eq('participant_code', session.participantCode)
          .eq('deleted', false)
          .maybeSingle()
        if (error) throw new ApiError(500, '보고를 불러오지 못했습니다.')
        if (!data) throw new ApiError(404, '보고를 찾을 수 없습니다.')
        sendJson(res, 200, { report: data })
        return
      }

      const { data, error } = await supabase
        .from('reports')
        .select(CARE_LIST_COLUMNS)
        .eq('participant_code', session.participantCode)
        .eq('deleted', false)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw new ApiError(500, '보고 목록을 불러오지 못했습니다.')
      sendJson(res, 200, { reports: data ?? [] })
      return
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      const recipientCode = String(body.recipientCode ?? '').trim().toUpperCase()
      const reportType = body.reportType === 'additional' ? 'additional' : 'daily'
      const inputMethod = body.inputMethod === 'voice' ? 'voice' : 'text'
      const reportSource = body.reportSource === 'scenario' ? 'scenario' : 'live'
      const scenarioId = reportSource === 'scenario' ? String(body.scenarioId ?? '') : null

      if (reportSource === 'scenario' && !STANDARD_SCENARIOS.some((s) => s.id === scenarioId)) {
        throw new ApiError(400, '표준상황 코드를 확인해 주세요.')
      }

      const { data: recipient } = await supabase
        .from('recipients')
        .select('code')
        .eq('code', recipientCode)
        .eq('active', true)
        .maybeSingle()
      if (!recipient) throw new ApiError(400, '수급자 코드를 확인해 주세요.')

      const today = todayKstDateString()

      // 표준상황 연습은 실제 현장보고의 "하루 1회" 규칙과 완전히 무관하다.
      if (reportSource === 'live' && reportType === 'daily') {
        const { data: existing } = await supabase
          .from('reports')
          .select(CARE_DETAIL_COLUMNS)
          .eq('participant_code', session.participantCode)
          .eq('report_date', today)
          .eq('report_type', 'daily')
          .eq('report_source', 'live')
          .eq('deleted', false)
          .maybeSingle()
        if (existing) {
          if (existing.status === 'submitted') {
            throw new ApiError(409, '오늘의 기본 돌봄보고를 이미 제출했습니다. 추가 상태변화 보고를 이용해 주세요.')
          }
          sendJson(res, 200, { report: existing, resumed: true })
          return
        }
      }

      const { data: created, error } = await supabase
        .from('reports')
        .insert({
          participant_code: session.participantCode,
          recipient_code: recipientCode,
          report_type: reportType,
          report_date: today,
          input_method: inputMethod,
          status: 'draft',
          report_source: reportSource,
          scenario_id: scenarioId,
        })
        .select(CARE_DETAIL_COLUMNS)
        .single()
      if (error || !created) throw new ApiError(500, '보고를 시작하지 못했습니다.')
      sendJson(res, 201, { report: created, resumed: false })
      return
    }

    // PATCH
    const body = await readJsonBody(req)
    const id = String(body.id ?? '')
    if (!id) throw new ApiError(400, '보고 id가 필요합니다.')

    const { data: existing, error: fetchError } = await supabase
      .from('reports')
      .select('id, participant_code, status, started_at')
      .eq('id', id)
      .eq('participant_code', session.participantCode)
      .eq('deleted', false)
      .maybeSingle()
    if (fetchError) throw new ApiError(500, '보고를 불러오지 못했습니다.')
    if (!existing) throw new ApiError(404, '보고를 찾을 수 없습니다.')
    if (existing.status !== 'draft') {
      throw new ApiError(409, '이미 제출된 보고는 수정할 수 없습니다.')
    }

    const update: Record<string, unknown> = {}
    if (typeof body.rawInput === 'string') update.raw_input = body.rawInput
    if (body.inputMethod === 'voice' || body.inputMethod === 'text') update.input_method = body.inputMethod
    if (Array.isArray(body.followupQuestions)) update.followup_questions = body.followupQuestions
    if (Array.isArray(body.followupAnswers)) update.followup_answers = body.followupAnswers
    if (body.aiGeneratedReport && isStructuredReport(body.aiGeneratedReport)) {
      update.ai_generated_report = body.aiGeneratedReport
    }
    if (body.caregiverFinalReport && isStructuredReport(body.caregiverFinalReport)) {
      update.caregiver_final_report = body.caregiverFinalReport
    }

    // 특이사항 없음 흐름 필드
    if (body.initialStatusChoice === 'changed' || body.initialStatusChoice === 'similar' || body.initialStatusChoice === 'uncertain') {
      update.initial_status_choice = body.initialStatusChoice
    }
    if (typeof body.noChangeInitialInput === 'boolean') update.no_change_initial_input = body.noChangeInitialInput
    if (isDomainEntryArray(body.observedDomains)) update.observed_domains_json = body.observedDomains
    if (isDomainEntryArray(body.changedDomains)) update.changed_domains_json = body.changedDomains
    if (isDomainEntryArray(body.unobservedDomains)) update.unobserved_domains_json = body.unobservedDomains
    if (isDomainEntryArray(body.uncertainDomains)) update.uncertain_domains_json = body.uncertainDomains
    if (typeof body.noChangeFollowupCount === 'number') update.no_change_followup_count = body.noChangeFollowupCount
    if (typeof body.noChangeFollowupAnswered === 'number') update.no_change_followup_answered = body.noChangeFollowupAnswered
    if (typeof body.initialInformationCount === 'number') update.initial_information_count = body.initialInformationCount
    if (typeof body.finalInformationCount === 'number') update.final_information_count = body.finalInformationCount
    if (typeof body.informationAddedCount === 'number') update.information_added_count = body.informationAddedCount
    if (typeof body.noInformationReport === 'boolean') update.no_information_report = body.noInformationReport

    if (body.submit === true) {
      if (!body.caregiverFinalReport || !isStructuredReport(body.caregiverFinalReport)) {
        throw new ApiError(400, '최종 보고문이 필요합니다.')
      }
      const startedAt = new Date(existing.started_at as string).getTime()
      update.status = 'submitted'
      update.submitted_at = new Date().toISOString()
      update.completion_seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    }

    const { data: updated, error: updateError } = await supabase
      .from('reports')
      .update(update)
      .eq('id', id)
      .select(CARE_DETAIL_COLUMNS)
      .single()
    if (updateError || !updated) throw new ApiError(500, '보고를 저장하지 못했습니다.')
    sendJson(res, 200, { report: updated })
  })
}
