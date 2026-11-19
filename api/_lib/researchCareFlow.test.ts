/** 연구용 요양보호사 흐름을 실제 서버 핸들러 + PGlite(실제 Postgres 엔진) + 실제 마이그레이션 위에서 확인한다.
 * AI 호출부(callShortAi)만 가짜로 바꿔 호출 횟수와 보내는 글(이름 가림)을 확인한다. 운영 DB·실제 AI는 검증하지 않는다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { fakeRequest, fakeResponse, newTestDb, pgliteSupabase } from './testSupport/pgliteSupabase.js'

const holder = vi.hoisted(() => ({ client: null as unknown, ai: vi.fn() }))
vi.mock('./supabase.js', () => ({ getSupabaseAdmin: () => holder.client }))
vi.mock('./researchCareAi.js', () => ({ callShortAi: holder.ai }))
vi.mock('./date.js', async (orig) => ({ ...(await orig<typeof import('./date.js')>()), todayKstDateString: () => '2026-11-19' }))

import aiTurn from '../care/ai-turn.js'
import careReports from '../care/reports.js'
import adminReports from '../admin/reports.js'
import { setAdminSessionCookie, setCareSessionCookie } from './auth.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8').replace(/create extension[^;]*;/gi, '')

let db: PGlite
const cookies: Record<string, string> = {}
let adminCookie = ''

async function call(handler: (req: never, res: never) => Promise<void>, method: string, url: string, cookie: string, body?: unknown) {
  const r = fakeResponse()
  await handler(fakeRequest(method, url, cookie, body) as never, r.res as never)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, body: r.json as any }
}

beforeAll(async () => {
  process.env.CARE_PILOT_JWT_SECRET = 'test-secret-for-research-flow-0123456789abcdef'
  {
    const r = fakeResponse()
    await setAdminSessionCookie(r.res as never)
    adminCookie = r.headers['set-cookie'].split(';')[0]
  }
  for (const c of ['C01', 'C02']) {
    const r = fakeResponse()
    await setCareSessionCookie(r.res as never, c)
    cookies[c] = r.headers['set-cookie'].split(';')[0]
  }
})

beforeEach(async () => {
  holder.ai.mockReset()
  db = newTestDb()
  await db.exec(read('db/schema.sql'))
  await db.exec(read('db/migrations/2026-10-02-recipient-registration.sql'))
  await db.exec(read('db/migrations/2026-11-19-research-daily-weekly.sql'))
  await db.exec(`insert into caregiver_assignments (caregiver_code, recipient_code) values ('C01', 'A01')`)
  await db.exec(`update recipients set display_name = '홍길순' where code = 'A01'`)
  holder.client = pgliteSupabase(db)
}, 60_000)

async function submitDay(date: string, raw: string) {
  await db.exec(`insert into reports (participant_code, recipient_code, report_type, report_date, status, raw_input, followup_answers, submitted_at, transcript_only)
    values ('C01', 'A01', 'daily', '${date}', 'submitted', '${raw}', '[{"question":"오늘은요?","missingField":"research_daily","answer":"괜찮으셨어요"}]', now(), true)`)
}

describe('하루 되묻기', () => {
  it('AI를 1번만 부르고, 이름은 코드로 가려 보내며, 직전 기록을 넣는다', async () => {
    await submitDay('2026-11-18', '홍길순 어르신 식사량이 줄었어요')
    holder.ai.mockResolvedValue({ value: { questions: ['지난번 식사가 줄었는데 오늘은요?'] }, model: 'test-model' })
    const r = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C01, { mode: 'ask', recipientCode: 'A01', rawInput: '홍길순 어르신 평소와 같았어요' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ questions: ['지난번 식사가 줄었는데 오늘은요?'], source: 'ai', previous: { date: '2026-11-18' } })
    expect(holder.ai).toHaveBeenCalledTimes(1)
    const sent = holder.ai.mock.calls[0][0].user as string
    expect(sent).not.toContain('홍길순')
    expect(sent).toContain('직전 기록(2026-11-18): A01 어르신 식사량이 줄었어요')
  })

  it('AI가 실패하면 규칙 질문으로 이어간다', async () => {
    holder.ai.mockResolvedValue(null)
    const r = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C01, { mode: 'ask', recipientCode: 'A01', rawInput: '특이사항 없어요' })
    expect(r.body.source).toBe('rule')
    expect(r.body.questions.length).toBeGreaterThan(0)
  })

  it('배정되지 않은 어르신은 거절하고 AI를 부르지 않는다', async () => {
    const r = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C02, { mode: 'ask', recipientCode: 'A01', rawInput: '평소와 같음' })
    expect(r.status).toBe(403)
    expect(holder.ai).not.toHaveBeenCalled()
  })
})

describe('원자료 전사본 저장', () => {
  it('AI 정리본 없이 제출되고 transcript_only로 표시된다', async () => {
    const start = await call(careReports, 'POST', '/api/care/reports', cookies.C01, { recipientCode: 'A01', reportType: 'daily', inputMethod: 'voice' })
    expect(start.status).toBe(201)
    const id = start.body.report.id
    const turns = [{ question: '오늘 식사는요?', missingField: 'research_daily', answer: '반 공기 드셨어요' }]
    const done = await call(careReports, 'PATCH', '/api/care/reports', cookies.C01, { id, rawInput: '평소와 같았어요', followupQuestions: turns, followupAnswers: turns, transcriptOnly: true, questionsSource: 'ai', submit: true })
    expect(done.status).toBe(200)
    expect(done.body.report.status).toBe('submitted')
    expect(done.body.report.transcript_only).toBe(true)
    expect(done.body.report.ai_questions_source).toBe('ai')
    expect(done.body.report.caregiver_final_report).toBeNull()
    expect(holder.ai).not.toHaveBeenCalled()
    // 응답 유실 후 같은 내용 재전송은 그대로 성공
    const again = await call(careReports, 'PATCH', '/api/care/reports', cookies.C01, { id, rawInput: '평소와 같았어요', transcriptOnly: true, submit: true })
    expect(again.status).toBe(200)
  })

  it('기존 흐름은 여전히 최종 보고문이 있어야 제출된다', async () => {
    const start = await call(careReports, 'POST', '/api/care/reports', cookies.C01, { recipientCode: 'A01', reportType: 'daily', inputMethod: 'text' })
    const r = await call(careReports, 'PATCH', '/api/care/reports', cookies.C01, { id: start.body.report.id, submit: true })
    expect(r.status).toBe(400)
  })
})

describe('주간 초안', () => {
  it('주 1회만 AI를 부르고, 요양보호사 수정본을 따로 저장한다', async () => {
    await submitDay('2026-11-17', '기침을 하셨어요')
    await submitDay('2026-11-18', '평소와 같았어요')
    await submitDay('2026-11-10', '지난주 기록')
    holder.ai.mockResolvedValue({ value: { draft: 'AI 초안 본문' }, model: 'test-model' })

    const empty = await call(careReports, 'GET', '/api/care/reports?view=weekly&recipient=A01&week=2026-11-16', cookies.C01)
    expect(empty.body).toEqual({ weekly: null, dayCount: 2 })

    const first = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C01, { mode: 'weekly', recipientCode: 'A01', weekStart: '2026-11-16' })
    expect(first.status).toBe(200)
    expect(first.body.weekly.ai_draft).toBe('AI 초안 본문')
    expect(first.body.weekly.source_report_ids).toHaveLength(2)
    const again = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C01, { mode: 'weekly', recipientCode: 'A01', weekStart: '2026-11-16' })
    expect(again.body.reused).toBe(true)
    expect(holder.ai).toHaveBeenCalledTimes(1)

    const sent = await call(careReports, 'POST', '/api/care/reports', cookies.C01, { op: 'weekly_send', id: first.body.weekly.id, caregiverText: '고친 본문', editSeconds: 42.4 })
    expect(sent.status).toBe(200)
    expect(sent.body.weekly).toMatchObject({ status: 'sent', ai_draft: 'AI 초안 본문', caregiver_text: '고친 본문', caregiver_edit_seconds: 42 })
    const other = await call(careReports, 'POST', '/api/care/reports', cookies.C01, { op: 'weekly_send', id: first.body.weekly.id, caregiverText: '다른 본문' })
    expect(other.status).toBe(409)
  })

  it('AI가 실패하면 날짜별 자동 정리로 저장한다', async () => {
    await submitDay('2026-11-17', '기침을 하셨어요')
    holder.ai.mockResolvedValue(null)
    const r = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C01, { mode: 'weekly', recipientCode: 'A01', weekStart: '2026-11-16' })
    expect(r.body.weekly.ai_model).toBe('rule')
    expect(r.body.weekly.ai_draft).toContain('11-17 기침을 하셨어요')
  })

  it('월요일이 아니거나 앞으로의 주, 기록 없는 주는 거절한다', async () => {
    const notMonday = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C01, { mode: 'weekly', recipientCode: 'A01', weekStart: '2026-11-18' })
    expect(notMonday.status).toBe(400)
    const future = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C01, { mode: 'weekly', recipientCode: 'A01', weekStart: '2026-11-23' })
    expect(future.status).toBe(400)
    const none = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C01, { mode: 'weekly', recipientCode: 'A01', weekStart: '2026-11-16' })
    expect(none.status).toBe(400)
    expect(holder.ai).not.toHaveBeenCalled()
  })
})

describe('관리자 주간 검토', () => {
  async function sentWeekly() {
    await submitDay('2026-11-17', '기침을 하셨어요')
    holder.ai.mockResolvedValue({ value: { draft: 'AI 초안' }, model: 'test-model' })
    const first = await call(aiTurn, 'POST', '/api/care/ai-turn', cookies.C01, { mode: 'weekly', recipientCode: 'A01', weekStart: '2026-11-16' })
    return first.body.weekly.id as string
  }

  it('요양보호사 세션으로는 관리자 화면 자료를 볼 수 없다', async () => {
    const r = await call(adminReports, 'GET', '/api/admin/reports?view=research_week&week=2026-11-16', cookies.C01)
    expect(r.status).toBe(401)
  })

  it('한 주의 하루 기록과 주간 초안을 함께 돌려주고, 보내기 전 초안은 검토할 수 없다', async () => {
    const id = await sentWeekly()
    const view = await call(adminReports, 'GET', '/api/admin/reports?view=research_week&week=2026-11-16', adminCookie)
    expect(view.status).toBe(200)
    expect(view.body.reports).toHaveLength(1)
    expect(view.body.reports[0]).toMatchObject({ participant_code: 'C01', recipient_code: 'A01', report_date: '2026-11-17' })
    expect(view.body.weeklies[0]).toMatchObject({ id, status: 'draft', week_start: '2026-11-16' })
    const early = await call(adminReports, 'PATCH', '/api/admin/reports', adminCookie, { op: 'weekly_review', id, adminFinalText: 'x', expectedUpdatedAt: view.body.weeklies[0].updated_at })
    expect(early.status).toBe(409)
  })

  it('저장·확정 후에도 AI 초안과 요양보호사 수정본은 그대로 남고, 확정본은 잠긴다', async () => {
    const id = await sentWeekly()
    await call(careReports, 'POST', '/api/care/reports', cookies.C01, { op: 'weekly_send', id, caregiverText: '요양보호사 수정본' })
    const view = await call(adminReports, 'GET', '/api/admin/reports?view=research_week&week=2026-11-16', adminCookie)
    const w = view.body.weeklies[0]
    const saved = await call(adminReports, 'PATCH', '/api/admin/reports', adminCookie, { op: 'weekly_review', id, adminFinalText: '관리자 수정', adminNote: '보호자 통화', expectedUpdatedAt: w.updated_at })
    expect(saved.status).toBe(200)
    expect(saved.body.weekly).toMatchObject({ status: 'sent', admin_final_text: '관리자 수정', admin_note: '보호자 통화', ai_draft: 'AI 초안', caregiver_text: '요양보호사 수정본' })
    const stale = await call(adminReports, 'PATCH', '/api/admin/reports', adminCookie, { op: 'weekly_review', id, adminNote: '덮어쓰기', expectedUpdatedAt: w.updated_at })
    expect(stale.status).toBe(409)
    const confirmed = await call(adminReports, 'PATCH', '/api/admin/reports', adminCookie, { op: 'weekly_review', id, adminFollowup: '다음 방문 기침 확인', confirm: true, expectedUpdatedAt: saved.body.weekly.updated_at })
    expect(confirmed.body.weekly).toMatchObject({ status: 'confirmed', admin_final_text: '관리자 수정', admin_followup: '다음 방문 기침 확인' })
    expect(confirmed.body.weekly.admin_confirmed_at).toBeTruthy()
    const relock = await call(adminReports, 'PATCH', '/api/admin/reports', adminCookie, { op: 'weekly_review', id, adminFinalText: '바꾸기', expectedUpdatedAt: confirmed.body.weekly.updated_at })
    expect(relock.status).toBe(409)
    const noteAfter = await call(adminReports, 'PATCH', '/api/admin/reports', adminCookie, { op: 'weekly_review', id, adminNote: '추가 상담', expectedUpdatedAt: confirmed.body.weekly.updated_at })
    expect(noteAfter.body.weekly).toMatchObject({ status: 'confirmed', admin_note: '추가 상담', admin_final_text: '관리자 수정' })
  })
})
