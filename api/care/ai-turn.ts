import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { requireCareSession } from '../_lib/auth.js'
import { runCareReportTurn, type FollowupTurn } from '../_lib/careReportAi.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { todayKstDateString } from '../_lib/date.js'
import { researchAsk, researchWeeklyPrepare } from '../_lib/researchCareHandlers.js'

interface RawHistoryItem {
  question: string
  answer: string
  missingField?: string
}

function isRawHistoryItem(v: unknown): v is RawHistoryItem {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r.question === 'string' && typeof r.answer === 'string'
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'POST')
    const session = await requireCareSession(req)

    const body = await readJsonBody(req)
    // 연구용 흐름: 하루 되묻기(AI 1회), 주간 초안(AI 1회, 이미 있으면 재호출 없음).
    if (body.mode === 'ask') {
      sendJson(res, 200, await researchAsk(getSupabaseAdmin(), session.participantCode, body, todayKstDateString()))
      return
    }
    if (body.mode === 'weekly') {
      sendJson(res, 200, await researchWeeklyPrepare(getSupabaseAdmin(), session.participantCode, body, todayKstDateString()))
      return
    }

    const rawInput = String(body.rawInput ?? '').trim()
    if (!rawInput) throw new ApiError(400, '오늘 관찰한 내용을 입력해 주세요.')
    if (rawInput.length > 4000) throw new ApiError(400, '입력 내용이 너무 깁니다.')

    const historyRaw: unknown[] = Array.isArray(body.history) ? body.history : []
    const history: FollowupTurn[] = historyRaw.filter(isRawHistoryItem).map((h) => ({
      question: h.question,
      missingField: h.missingField ?? 'other',
      answer: h.answer,
    }))

    const forceFinalize = body.forceFinalize === true
    const result = await runCareReportTurn(rawInput, history, forceFinalize)
    sendJson(res, 200, result)
  })
}
