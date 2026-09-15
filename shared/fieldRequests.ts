/** 현장 요청(3단계)의 화면용 계산 — 서버·데모·현장 화면 공통.
 *
 * - 현장 화면에는 게시된 요청의 공개 문구·기한만 보인다(내부 메모는 요청 행에 없고 여기서도 다루지 않음).
 * - 응답 대기 상태는 저장된 사실로만 나눈다: 기한 지남 / 게시 뒤 이 수급자 보고가 있었지만 이 요청 답 없음 /
 *   방문 대기(다음 방문 자료 없음). 다음 방문이 있었는지 모르면 "미응답 실패"로 확정하지 않는다.
 * - 이미 말한 내용은 다시 묻지 않는다: 이번 보고 원문에서 요청과 같은 돌봄 영역을 말한 문장을 찾아
 *   요양보호사에게 "이 내용으로 답하기"로 확인만 받는다. 자동으로 응답 완료 처리하지 않는다. */
import { classifyDomainsFromText } from './noChangeEngine.js'
import { isObligationOverdue, timeOf, type ActionObligation, type DueKind, type FieldRequest, type FieldResponse, type RequestTargetMode } from './workflow.js'

/** 요양보호사 화면에 내려주는 요청 — 공개 필드만. */
export interface CenterRequestView {
  id: string
  recipientCode: string
  message: string
  publishedAt: string
  responseDueKind: DueKind
  responseDueAt: string | null
  targetMode: RequestTargetMode
}

export function toCenterRequestView(r: FieldRequest, obligation: Pick<ActionObligation, 'current_due_kind' | 'current_due_at'> | null): CenterRequestView {
  return {
    id: r.id,
    recipientCode: r.recipient_code,
    message: r.message,
    publishedAt: r.published_at,
    responseDueKind: obligation?.current_due_kind ?? 'unset',
    responseDueAt: obligation?.current_due_at ?? null,
    targetMode: r.target_mode,
  }
}

/** 보고 제출과 함께 보낸 센터 요청 답변의 저장 결과(요청별). */
export interface CenterResponseResult {
  fieldRequestId: string
  status: 'ok' | 'duplicate' | 'forbidden' | 'invalid' | 'not_found' | 'not_ready'
  message?: string
  fulfilledObligation?: boolean
}

export type RequestWaitState = 'overdue' | 'reports_without_answer' | 'awaiting_visit' | 'awaiting'
export const REQUEST_WAIT_LABELS: Record<RequestWaitState, string> = {
  overdue: '현장 응답기한 지남',
  reports_without_answer: '게시 뒤 이 수급자 보고는 있었지만 이 요청에는 답 없음',
  awaiting_visit: '방문 대기 — 다음 방문 자료 없음(미응답으로 확정하지 않음)',
  awaiting: '응답 대기',
}

type ReportLite = { id: string; recipient_code: string; participant_code: string; status: string; submitted_at?: string | null; report_source?: string; deleted?: boolean }

/** 게시 중(응답 전)인 요청의 대기 상태. 게시 뒤 제출된 이 수급자의 실제 보고(지정 대상이면 그 사람의 보고)를
 * 응답과 독립된 방문 근거로만 센다 — 보고가 없다고 방문이 없었다고 단정하지도 않는다. */
export function requestWaitState(
  req: Pick<FieldRequest, 'status' | 'published_at' | 'recipient_code' | 'target_mode' | 'target_caregiver_code'>,
  obligation: ActionObligation | null,
  reports: ReportLite[],
  nowIso: string,
): { state: RequestWaitState; reportsSincePublish: number } | null {
  if (req.status !== 'published') return null
  const published = timeOf(req.published_at) ?? 0
  const reportsSincePublish = reports.filter(
    (r) =>
      !r.deleted &&
      (r.report_source ?? 'live') === 'live' &&
      r.status === 'submitted' &&
      r.recipient_code === req.recipient_code &&
      (req.target_mode !== 'specific_caregiver' || r.participant_code === req.target_caregiver_code) &&
      (timeOf(r.submitted_at) ?? 0) > published,
  ).length
  if (obligation && isObligationOverdue(obligation, nowIso)) return { state: 'overdue', reportsSincePublish }
  if (reportsSincePublish > 0) return { state: 'reports_without_answer', reportsSincePublish }
  if (obligation?.current_due_kind === 'next_actual_visit') return { state: 'awaiting_visit', reportsSincePublish }
  return { state: 'awaiting', reportsSincePublish }
}

export type RoutingProblem = 'target_unassigned' | 'no_assignee'
export const ROUTING_PROBLEM_LABELS: Record<RoutingProblem, string> = {
  target_unassigned: '지정한 요양보호사가 지금 이 수급자 담당이 아님 — 재배정 필요',
  no_assignee: '이 수급자에게 지금 배정된 요양보호사가 없음 — 재배정 필요',
}

/** 게시 중인 요청이 지금 배정 기준으로 누구에게도 보이지 않는지(배정 변경 뒤 끊긴 연결). */
export function routingProblem(req: Pick<FieldRequest, 'status' | 'target_mode' | 'target_caregiver_code'>, assignees: string[]): RoutingProblem | null {
  if (req.status !== 'published') return null
  if (assignees.length === 0) return 'no_assignee'
  if (req.target_mode === 'specific_caregiver' && !assignees.includes(req.target_caregiver_code ?? '')) return 'target_unassigned'
  return null
}

/** 요청 문구에서 흔한 지시 표현을 빼고 돌봄 영역만 남긴다('변화'의 '변'이 배설로 잡히는 등 오분류 방지). */
function requestDomains(message: string) {
  const cleaned = message.replace(/변화|말씀해\s*주세요|알려\s*주세요|확인해\s*주세요|확인\s*부탁/g, ' ')
  return new Set(classifyDomainsFromText(cleaned).map((e) => e.domain))
}

/** 이번 보고 원문(최초 발화 + 답변들)에서 요청과 같은 돌봄 영역을 말한 첫 문장. 없으면 null.
 * 요양보호사가 확인하기 전에는 답으로 쓰지 않는다. */
export function findResponseEvidence(message: string, texts: string[], max = 120): string | null {
  const want = requestDomains(message)
  if (want.size === 0) return null
  for (const text of texts) {
    const sentences = text
      .split(/(?<=[.!?。])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const s of sentences) {
      if (classifyDomainsFromText(s.replace(/변화/g, ' ')).some((e) => want.has(e.domain))) {
        return s.length > max ? `${s.slice(0, max)}…` : s
      }
    }
  }
  return null
}

/** 보고에 실제로 저장된 원문(최초 발화 + 후속 답변) — 답의 근거 문장은 여기서 온 것이어야 한다. */
export function reportEvidenceTexts(report: { raw_input?: string | null; followup_answers?: Array<{ answer?: string | null }> | null }): string[] {
  return [report.raw_input ?? '', ...(report.followup_answers ?? []).map((a) => a?.answer ?? '')].filter((t) => t.trim())
}

/** 근거 문장이 이 보고 원문에 없으면 "보고 원문에서" 온 것으로 저장하지 않고 입력한 답으로 옮긴다. */
export function sanitizeEvidence<T extends { text?: string | null; evidenceExcerpt?: string | null }>(inputs: T[], texts: string[]): T[] {
  return inputs.map((i) => {
    const ex = (i.evidenceExcerpt ?? '').trim()
    if (!ex) return { ...i, evidenceExcerpt: null }
    const core = ex.replace(/…$/, '')
    if (texts.some((t) => t.includes(core))) return i
    return { ...i, evidenceExcerpt: null, text: [i.text?.trim(), ex].filter(Boolean).join(' / ') }
  })
}

/** 이 요청의 응답 중 의무를 이행시킨 첫 응답(없으면 null) — 이후 응답·늦은 응답은 보조 기록. */
export function firstFulfillingResponse(requestId: string, responses: FieldResponse[]): FieldResponse | null {
  return responses.filter((r) => r.field_request_id === requestId && r.fulfilled_obligation).sort((a, b) => (timeOf(a.submitted_at) ?? 0) - (timeOf(b.submitted_at) ?? 0))[0] ?? null
}
