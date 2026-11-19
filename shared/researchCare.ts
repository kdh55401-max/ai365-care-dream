/**
 * 논문 연구용 요양보호사 흐름의 순수 규칙(서버·화면·데모 공용).
 *
 * AI 호출은 두 종류뿐이다.
 *  1) 하루 되묻기: 요양보호사의 첫 발화 직후 1회. 등록된 평소 상태와 직전 기록을 참고해 짧은 질문 1~2개.
 *  2) 주간 초안: 요양보호사가 "이번 주 정리하기"를 누를 때 1회. 그 주 전사본을 묶어 상태변화기록 초안.
 * 요양보호사의 답변 저장, 전사본 저장, 관리자 조회에는 AI를 부르지 않는다.
 * AI로 보내는 글은 maskForAi로 이름·전화번호 등을 가린 뒤 보낸다.
 */
import { detectNoChangePhrase } from './noChangeEngine.js'

export const MAX_DAILY_QUESTIONS = 2

export interface TranscriptTurn { question: string; answer: string }

/** 저장된 하루 기록(원자료 전사본). */
export interface DailyTranscript {
  date: string
  rawInput: string
  turns: TranscriptTurn[]
  noChange: boolean
}

export interface PreviousRecord { date: string; text: string }

export interface DailyContext {
  /** 관리자가 등록·확정한 평소 상태 요약(영역: 내용). */
  usual: string[]
  previous: PreviousRecord | null
}

// ── 식별정보 가리기 ──────────────────────────────────────────────

export interface NameCode { name: string; code: string }

const PHONE = /(?:\+?82[-\s]?)?0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g
const RRN = /\d{6}[-\s]?[1-4]\d{6}/g

/** AI로 보내기 전 이름(별칭)을 코드로 바꾸고, 주민번호·전화번호를 가린다. */
export function maskForAi(text: string, names: NameCode[]): string {
  let out = text.replace(RRN, '[주민번호 가림]').replace(PHONE, '[전화번호 가림]')
  const sorted = names.filter((n) => n.name && n.name.trim().length >= 2).sort((a, b) => b.name.length - a.name.length)
  for (const n of sorted) out = out.split(n.name.trim()).join(n.code)
  return out
}

// ── 날짜(한국 시간 기준 월~일 한 주) ─────────────────────────────

function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && formatDate(parseDate(v)) === v
}
/** 그 날짜가 속한 주의 월요일. */
export function weekStartOf(date: string): string {
  const d = parseDate(date)
  const offset = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  return formatDate(d)
}
export function weekEndOf(weekStart: string): string {
  const d = parseDate(weekStart)
  d.setUTCDate(d.getUTCDate() + 6)
  return formatDate(d)
}
export function addDays(date: string, days: number): string {
  const d = parseDate(date)
  d.setUTCDate(d.getUTCDate() + days)
  return formatDate(d)
}
export function inWeek(date: string, weekStart: string): boolean {
  return date >= weekStart && date <= weekEndOf(weekStart)
}

// ── 전사본 ──────────────────────────────────────────────────────

export function transcriptText(t: Pick<DailyTranscript, 'rawInput' | 'turns'>): string {
  const lines = [`요양보호사: ${t.rawInput.trim()}`]
  for (const turn of t.turns) {
    lines.push(`AI: ${turn.question.trim()}`)
    lines.push(`요양보호사: ${turn.answer.trim() || '(답하지 않음)'}`)
  }
  return lines.join('\n')
}

/** 특이사항이 없는 날도 의미 있는 한 줄이 남게 한다(AI 호출 없음). */
export function dailySummaryLine(t: DailyTranscript, usual: string[]): string {
  if (!t.noChange) return ''
  const answered = t.turns.filter((x) => x.answer.trim()).length
  const basis = usual.length > 0 ? `등록된 평소 상태(${usual.slice(0, 3).join(', ')})` : '평소 상태'
  return `${basis}와 비교해 변화 없음 확인` + (answered > 0 ? ` · 확인 질문 ${answered}개 답변` : ' · 확인 질문 답변 없음')
}

export function isNoChangeDay(rawInput: string): boolean {
  return detectNoChangePhrase(rawInput)
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

// ── 하루 되묻기 ─────────────────────────────────────────────────

export const DAILY_SYSTEM_PROMPT = [
  '너는 방문요양 요양보호사의 돌봄기록을 돕는 동료다.',
  '요양보호사가 오늘 말한 내용, 어르신의 등록된 평소 상태, 직전 기록을 보고 짧은 되묻기 질문을 1~2개만 만든다.',
  '규칙: 한 질문은 40자 이내의 존댓말. 직전 기록이 있으면 "지난번엔 ~하셨는데 오늘은 어떠셨어요?"처럼 비교해 묻는다.',
  '이미 말한 내용은 다시 묻지 않는다. 진단·처치·위험 판단을 하지 않는다. 어르신은 코드(A01 등)로만 부른다.',
  '특이사항이 없다고 하면 평소 상태 중 한 가지를 직접 확인했는지 묻는다.',
  'JSON {"questions": ["..."]} 로만 답한다.',
].join('\n')

export function buildDailyUserText(recipientCode: string, rawInput: string, ctx: DailyContext): string {
  const parts = [`어르신: ${recipientCode}`]
  if (ctx.usual.length) parts.push(`등록된 평소 상태: ${clip(ctx.usual.join(' / '), 300)}`)
  parts.push(ctx.previous ? `직전 기록(${ctx.previous.date}): ${clip(ctx.previous.text, 300)}` : '직전 기록: 없음')
  parts.push(`오늘 요양보호사 말: ${clip(rawInput, 600)}`)
  return parts.join('\n')
}

export const DAILY_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: { questions: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['questions'],
}

/** AI 응답을 화면에 쓸 질문 목록으로 다듬는다. 형식이 틀리면 null. */
export function normalizeQuestions(value: unknown): string[] | null {
  const list = (value as { questions?: unknown })?.questions
  if (!Array.isArray(list)) return null
  const out = list.filter((q): q is string => typeof q === 'string').map((q) => clip(q, 80)).filter(Boolean).slice(0, MAX_DAILY_QUESTIONS)
  return out.length > 0 ? out : null
}

/** AI를 쓸 수 없을 때(연결 실패·설정 없음·시연 모드)의 규칙 기반 질문. */
export function fallbackQuestions(rawInput: string, ctx: DailyContext): string[] {
  const qs: string[] = []
  if (ctx.previous) qs.push(`지난번(${ctx.previous.date.slice(5)}) 기록과 비교해 오늘은 어떠셨어요?`)
  if (isNoChangeDay(rawInput)) {
    qs.push(ctx.usual.length ? `평소 상태 중 '${clip(ctx.usual[0], 20)}'은 오늘 직접 확인하셨어요?` : '식사·잠·기분 중 오늘 직접 확인한 것이 있으세요?')
  } else if (qs.length === 0) {
    qs.push('그 변화는 언제부터, 어느 정도였는지 말씀해 주세요.')
  }
  return qs.slice(0, MAX_DAILY_QUESTIONS)
}

// ── 주간 초안 ───────────────────────────────────────────────────

export const WEEKLY_SYSTEM_PROMPT = [
  '너는 방문요양 기관의 주간 상태변화기록 초안을 쓰는 보조자다.',
  '한 주 동안 요양보호사가 남긴 하루 전사본만 근거로 쓴다. 전사본에 없는 사실을 지어내지 않는다.',
  '형식: 1) 이번 주 전반 상태 2) 평소와 달라진 점(날짜 포함) 3) 변화 없이 확인된 점 4) 다음 주 살펴볼 점.',
  '각 항목은 1~3문장의 짧은 존댓말 기록체. 진단·처치 지시를 하지 않는다. 어르신은 코드로만 부른다.',
  'JSON {"draft": "..."} 로만 답한다.',
].join('\n')

export const WEEKLY_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: { draft: { type: 'STRING' } },
  required: ['draft'],
}

export function buildWeeklyUserText(recipientCode: string, weekStart: string, days: DailyTranscript[]): string {
  const header = `어르신: ${recipientCode}\n기간: ${weekStart} ~ ${weekEndOf(weekStart)}\n`
  return header + days.map((d) => `[${d.date}]\n${clip(transcriptText(d), 700)}`).join('\n\n')
}

export function normalizeDraft(value: unknown): string | null {
  const d = (value as { draft?: unknown })?.draft
  return typeof d === 'string' && d.trim() ? d.trim().slice(0, 4000) : null
}

/** AI 없이 만드는 주간 초안(날짜별 원문 나열). */
export function fallbackWeeklyDraft(days: DailyTranscript[], usual: string[]): string {
  if (days.length === 0) return '이번 주에 저장된 기록이 없습니다.'
  const lines = ['[자동 정리 — AI를 쓰지 못해 날짜별 기록을 그대로 모았습니다]']
  for (const d of days) {
    const summary = d.noChange ? dailySummaryLine(d, usual) : clip(d.rawInput, 120)
    const extra = d.turns.filter((t) => t.answer.trim()).map((t) => clip(t.answer, 60)).join(' / ')
    lines.push(`· ${d.date.slice(5)} ${summary}${extra ? ` (추가: ${extra})` : ''}`)
  }
  return lines.join('\n')
}
