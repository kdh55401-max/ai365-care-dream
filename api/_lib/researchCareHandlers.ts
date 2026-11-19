/**
 * 연구용 요양보호사 흐름 요청 처리. 새 서버리스 함수 파일을 늘리지 않기 위해
 * 기존 /api/care/ai-turn(mode=ask|weekly)와 /api/care/reports(view=weekly, op=weekly_send)에서 부른다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import { callShortAi } from './researchCareAi.js'
import {
  assertAssigned, getWeekly, insertWeekly, loadDailyContext, loadNames, loadUsual, loadWeekTranscripts,
  parseRecipientCode, sendWeekly,
} from './researchCareStore.js'
import {
  DAILY_RESPONSE_SCHEMA, DAILY_SYSTEM_PROMPT, WEEKLY_RESPONSE_SCHEMA, WEEKLY_SYSTEM_PROMPT,
  buildDailyUserText, buildWeeklyUserText, fallbackQuestions, fallbackWeeklyDraft, isIsoDate, maskForAi,
  normalizeDraft, normalizeQuestions, weekStartOf,
} from '../../shared/researchCare.js'

export interface AskResult {
  questions: string[]
  source: 'ai' | 'rule'
  previous: { date: string } | null
}

/** 하루 되묻기: AI 1회. 실패하면 규칙 기반 질문. */
export async function researchAsk(db: SupabaseClient, caregiver: string, body: Record<string, unknown>, today: string): Promise<AskResult> {
  const recipient = parseRecipientCode(body.recipientCode)
  await assertAssigned(db, caregiver, recipient)
  const rawInput = String(body.rawInput ?? '').trim()
  if (!rawInput) throw new ApiError(400, '오늘 돌봄 내용을 먼저 말씀해 주세요.')
  if (rawInput.length > 4000) throw new ApiError(400, '입력 내용이 너무 깁니다.')

  const [ctx, names] = await Promise.all([loadDailyContext(db, recipient, today), loadNames(db, recipient)])
  const masked = {
    usual: ctx.usual.map((u) => maskForAi(u, names)),
    previous: ctx.previous ? { date: ctx.previous.date, text: maskForAi(ctx.previous.text, names) } : null,
  }
  const ai = await callShortAi({
    system: DAILY_SYSTEM_PROMPT,
    user: buildDailyUserText(recipient, maskForAi(rawInput, names), masked),
    schema: DAILY_RESPONSE_SCHEMA,
    maxOutputTokens: 200,
  })
  const questions = ai ? normalizeQuestions(ai.value) : null
  return {
    questions: questions ?? fallbackQuestions(rawInput, ctx),
    source: questions ? 'ai' : 'rule',
    previous: ctx.previous ? { date: ctx.previous.date } : null,
  }
}

function parseWeekStart(v: unknown, today: string): string {
  if (!isIsoDate(v) || weekStartOf(v) !== v) throw new ApiError(400, '주 시작일(월요일)을 확인해 주세요.')
  if (v > weekStartOf(today)) throw new ApiError(400, '아직 시작하지 않은 주입니다.')
  return v
}

export async function researchWeeklyGet(db: SupabaseClient, caregiver: string, query: URLSearchParams, today: string) {
  const recipient = parseRecipientCode(query.get('recipient'))
  await assertAssigned(db, caregiver, recipient)
  const weekStart = parseWeekStart(query.get('week'), today)
  const [weekly, week] = await Promise.all([getWeekly(db, caregiver, recipient, weekStart), loadWeekTranscripts(db, caregiver, recipient, weekStart)])
  return { weekly, dayCount: week.days.length }
}

/** 주간 초안: 이 주·어르신에 초안이 없을 때만 AI 1회. 이미 있으면 다시 부르지 않는다. */
export async function researchWeeklyPrepare(db: SupabaseClient, caregiver: string, body: Record<string, unknown>, today: string) {
  const recipient = parseRecipientCode(body.recipientCode)
  await assertAssigned(db, caregiver, recipient)
  const weekStart = parseWeekStart(body.weekStart, today)
  const existing = await getWeekly(db, caregiver, recipient, weekStart)
  if (existing) return { weekly: existing, reused: true }

  const week = await loadWeekTranscripts(db, caregiver, recipient, weekStart)
  if (week.days.length === 0) throw new ApiError(400, '이번 주에 저장된 하루 기록이 없습니다.')
  const [names, usual] = await Promise.all([loadNames(db, recipient), loadUsual(db, recipient)])
  const maskedDays = week.days.map((d) => ({
    ...d,
    rawInput: maskForAi(d.rawInput, names),
    turns: d.turns.map((t) => ({ question: t.question, answer: maskForAi(t.answer, names) })),
  }))
  const ai = await callShortAi({
    system: WEEKLY_SYSTEM_PROMPT,
    user: buildWeeklyUserText(recipient, weekStart, maskedDays),
    schema: WEEKLY_RESPONSE_SCHEMA,
    maxOutputTokens: 900,
  })
  const draft = ai ? normalizeDraft(ai.value) : null
  const now = new Date().toISOString()
  const weekly = await insertWeekly(db, {
    participant_code: caregiver,
    recipient_code: recipient,
    week_start: weekStart,
    source_report_ids: week.ids,
    ai_draft: draft ?? fallbackWeeklyDraft(week.days, usual),
    ai_model: draft && ai ? ai.model : 'rule',
    ai_created_at: now,
    status: 'draft',
  })
  return { weekly, reused: false }
}

export async function researchWeeklySend(db: SupabaseClient, caregiver: string, body: Record<string, unknown>) {
  const id = String(body.id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, '주간 초안 id를 확인해 주세요.')
  const text = String(body.caregiverText ?? '').trim()
  if (!text) throw new ApiError(400, '보낼 내용이 비어 있습니다.')
  if (text.length > 6000) throw new ApiError(400, '내용이 너무 깁니다.')
  const seconds = typeof body.editSeconds === 'number' && Number.isFinite(body.editSeconds) ? Math.max(0, Math.round(body.editSeconds)) : null
  return { weekly: await sendWeekly(db, caregiver, id, text, seconds) }
}
