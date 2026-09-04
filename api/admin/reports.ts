import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, getQuery, readJsonBody, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { requireAdminSession } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { logAudit } from '../_lib/audit.js'

const LIST_COLUMNS =
  'id, participant_code, recipient_code, report_type, report_date, status, submitted_at, ' +
  'completion_seconds, raw_evaluated_at, ai_evaluated_at, initial_status_choice, ' +
  'no_information_report, report_source, scenario_id, ai_inaccuracy_detected, created_at'

const DETAIL_COLUMNS = '*'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'PATCH', 'DELETE')
    await requireAdminSession(req)
    const supabase = getSupabaseAdmin()

    if (req.method === 'GET') {
      const id = getQuery(req).get('id')
      if (id) {
        const { data, error } = await supabase
          .from('reports')
          .select(DETAIL_COLUMNS)
          .eq('id', id)
          .eq('deleted', false)
          .maybeSingle()
        if (error) throw new ApiError(500, '보고를 불러오지 못했습니다.')
        if (!data) throw new ApiError(404, '보고를 찾을 수 없습니다.')
        await logAudit('view_report', id)
        sendJson(res, 200, { report: data })
        return
      }

      const source = getQuery(req).get('source') // 'live' | 'scenario' | 'all' — 기본은 실제 현장보고만
      let query = supabase.from('reports').select(LIST_COLUMNS).eq('deleted', false)
      if (source !== 'all') query = query.eq('report_source', source === 'scenario' ? 'scenario' : 'live')
      const { data, error } = await query.order('created_at', { ascending: false }).limit(500)
      if (error) throw new ApiError(500, '보고 목록을 불러오지 못했습니다.')
      sendJson(res, 200, { reports: data ?? [] })
      return
    }

    if (req.method === 'DELETE') {
      const id = getQuery(req).get('id')
      const reason = getQuery(req).get('reason') ?? ''
      if (!id) throw new ApiError(400, '삭제할 보고 id가 필요합니다.')
      if (!reason.trim()) throw new ApiError(400, '삭제 사유를 입력해 주세요.')

      const { error } = await supabase
        .from('reports')
        .update({ deleted: true, delete_reason: reason, deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw new ApiError(500, '보고를 삭제하지 못했습니다.')
      await logAudit('delete_report', id, { reason })
      sendJson(res, 200, { ok: true })
      return
    }

    // PATCH: 관리자 평가 저장 (1단계: raw, 2단계: ai)
    const body = await readJsonBody(req)
    const id = String(body.id ?? '')
    const stage = body.stage === 'ai' ? 'ai' : body.stage === 'raw' ? 'raw' : null
    if (!id || !stage) throw new ApiError(400, '요청 형식이 올바르지 않습니다.')

    const { data: existing, error: fetchError } = await supabase
      .from('reports')
      .select('id, status, raw_evaluated_at, raw_eval_history, ai_evaluated_at, ai_eval_history, ' +
        'raw_immediately_actionable, raw_followup_needed, raw_completeness_score, raw_eval_note, ' +
        'ai_immediately_actionable, ai_followup_needed, ai_completeness_score, actual_followup_type, ' +
        'ai_usefulness_score, ai_inaccuracy_detected, ai_eval_note, manager_status')
      .eq('id', id)
      .eq('deleted', false)
      .maybeSingle()
    if (fetchError) throw new ApiError(500, '보고를 불러오지 못했습니다.')
    if (!existing) throw new ApiError(404, '보고를 찾을 수 없습니다.')
    if (existing.status !== 'submitted') {
      throw new ApiError(409, '제출된 보고만 평가할 수 있습니다.')
    }

    const update: Record<string, unknown> = {}

    if (stage === 'raw') {
      if (typeof body.rawImmediatelyActionable !== 'boolean') throw new ApiError(400, '원문 판단 가능 여부를 선택해 주세요.')
      if (typeof body.rawFollowupNeeded !== 'boolean') throw new ApiError(400, '추가 질문 필요 여부를 선택해 주세요.')
      const score = Number(body.rawCompletenessScore)
      if (!Number.isInteger(score) || score < 1 || score > 5) throw new ApiError(400, '필수정보 충실도(1~5)를 선택해 주세요.')

      if (existing.raw_evaluated_at) {
        const history = Array.isArray(existing.raw_eval_history) ? existing.raw_eval_history : []
        history.push({
          at: existing.raw_evaluated_at,
          raw_immediately_actionable: existing.raw_immediately_actionable,
          raw_followup_needed: existing.raw_followup_needed,
          raw_completeness_score: existing.raw_completeness_score,
          raw_eval_note: existing.raw_eval_note,
        })
        update.raw_eval_history = history
      }

      update.raw_immediately_actionable = body.rawImmediatelyActionable
      update.raw_followup_needed = body.rawFollowupNeeded
      update.raw_completeness_score = score
      update.raw_eval_note = typeof body.rawEvalNote === 'string' ? body.rawEvalNote : null
      update.raw_evaluated_at = new Date().toISOString()
    } else {
      if (!existing.raw_evaluated_at) {
        throw new ApiError(409, '먼저 원문 평가를 완료해야 AI 보고를 평가할 수 있습니다.')
      }
      if (typeof body.aiImmediatelyActionable !== 'boolean') throw new ApiError(400, '최종보고 판단 가능 여부를 선택해 주세요.')
      if (typeof body.aiFollowupNeeded !== 'boolean') throw new ApiError(400, '추가 질문 필요 여부를 선택해 주세요.')
      const completeness = Number(body.aiCompletenessScore)
      if (!Number.isInteger(completeness) || completeness < 1 || completeness > 5) {
        throw new ApiError(400, '필수정보 충실도(1~5)를 선택해 주세요.')
      }
      const usefulness = Number(body.aiUsefulnessScore)
      if (!Number.isInteger(usefulness) || usefulness < 1 || usefulness > 5) {
        throw new ApiError(400, '업무 유용성(1~5)을 선택해 주세요.')
      }
      const followupType = body.actualFollowupType
      if (!['none', 'sms', 'call'].includes(followupType as string)) {
        throw new ApiError(400, '실제 추가 확인 방식을 선택해 주세요.')
      }
      if (typeof body.aiInaccuracyDetected !== 'boolean') throw new ApiError(400, '사실과 다른 내용 포함 여부를 선택해 주세요.')

      if (existing.ai_evaluated_at) {
        const history = Array.isArray(existing.ai_eval_history) ? existing.ai_eval_history : []
        history.push({
          at: existing.ai_evaluated_at,
          ai_immediately_actionable: existing.ai_immediately_actionable,
          ai_followup_needed: existing.ai_followup_needed,
          ai_completeness_score: existing.ai_completeness_score,
          actual_followup_type: existing.actual_followup_type,
          ai_usefulness_score: existing.ai_usefulness_score,
          ai_inaccuracy_detected: existing.ai_inaccuracy_detected,
          ai_eval_note: existing.ai_eval_note,
          manager_status: existing.manager_status,
        })
        update.ai_eval_history = history
      }

      update.ai_immediately_actionable = body.aiImmediatelyActionable
      update.ai_followup_needed = body.aiFollowupNeeded
      update.ai_completeness_score = completeness
      update.actual_followup_type = followupType
      update.ai_usefulness_score = usefulness
      update.ai_inaccuracy_detected = body.aiInaccuracyDetected
      update.ai_eval_note = typeof body.aiEvalNote === 'string' ? body.aiEvalNote : null
      if (['confirmed', 'needs_followup', 'called', 'closed'].includes(body.managerStatus as string)) {
        update.manager_status = body.managerStatus
      }
      update.ai_evaluated_at = new Date().toISOString()
    }

    const { data: updated, error: updateError } = await supabase
      .from('reports')
      .update(update)
      .eq('id', id)
      .select(DETAIL_COLUMNS)
      .single()
    if (updateError || !updated) throw new ApiError(500, '평가를 저장하지 못했습니다.')
    await logAudit(stage === 'raw' ? 'evaluate_raw' : 'evaluate_ai', id)
    sendJson(res, 200, { report: updated })
  })
}
