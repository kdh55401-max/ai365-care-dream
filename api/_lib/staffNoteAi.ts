import { env } from './env.js'
import { ApiError } from './http.js'
import { MODEL } from './careReportAi.js'
import { getVertexAccessToken } from './vertexAuth.js'
import {
  CONSENT_CHOICES,
  CONSENT_LABEL,
  COUNSEL_METHODS,
  COUNSEL_METHOD_LABEL,
  buildTemplateDraft,
  checkAiDraft,
  validateDraftInput,
  type ConsentChoice,
  type CounselMethod,
  type StaffNoteDraftInput,
  type StaffNoteDraftResult,
} from '../../shared/staffChangeNote.js'

/** 직원변경 상담일지 초안 만들기. 사람이 고른 선택지(사유·상담 방법·대상자 관계·동의 여부)를 기록 문장으로 정리한다.
 *
 * 안전 원칙
 * - AI에는 수급자 코드·이름·담당자 코드를 보내지 않는다(선택지와 짧은 추가 설명만).
 * - 동의 여부는 사람이 고른 값이다. AI 결과가 그 선택과 어긋나거나 입력에 없던 숫자를 만들면 버리고 기본 문장을 쓴다.
 * - AI가 꺼져 있거나(환경변수 없음) 실패해도 초안 만들기는 항상 기본 문장으로 동작한다. 저장은 하지 않는다. */

const REQUEST_TIMEOUT_MS = 15000

const SYSTEM_PROMPT = `당신은 재가 장기요양기관 관리자가 쓰는 "직원(담당 요양보호사) 변경 상담일지"의 문장을 정리하는 도우미입니다.
관리자가 고른 선택지를 간결한 기록문으로 바꿉니다. 아래 규칙을 반드시 지킵니다.
1. 입력에 있는 사실만 씁니다. 이름, 날짜, 숫자, 전화번호, 금액, 따옴표 인용, 입력에 없는 이유나 경과를 절대 만들지 않습니다.
2. 수급자(보호자)가 동의했는지는 입력의 consent 값 그대로만 씁니다. 동의하지 않았거나 아직 안내하지 못했다면 절대 동의한 것처럼 쓰지 않습니다.
3. content는 정확히 두 줄입니다. 첫 줄은 "[안내]"로, 둘째 줄은 "[의견·동의]"로 시작합니다. 첫 줄에는 상담 대상자(relation) 표현을 그대로 넣습니다.
4. 문체는 상담일지 기록문(…함, …하였음, …않음)으로 짧게 씁니다. 전체 4문장을 넘기지 않습니다.
5. reason은 변경 사유를 한 문장으로 씁니다. 사유가 "기타"이면 reasonMemo를 그대로 다듬어 씁니다.
6. 의견(opinionMemo)이 있으면 의미를 바꾸지 말고 [의견·동의] 줄에 넣습니다.
결과는 JSON {"reason": string, "content": string} 만 돌려줍니다.`

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: { reason: { type: 'STRING' }, content: { type: 'STRING' } },
  required: ['reason', 'content'],
}

const str = (v: unknown): string => String(v ?? '').trim()

/** 요청 본문 → 검증된 초안 입력. 잘못된 값은 400. */
export function parseDraftInput(body: Record<string, unknown>): StaffNoteDraftInput {
  const method = str(body.counselMethod)
  const consent = str(body.consent)
  if (!COUNSEL_METHODS.includes(method as CounselMethod)) throw new ApiError(400, '상담 방법을 선택해 주세요.')
  if (!CONSENT_CHOICES.includes(consent as ConsentChoice)) throw new ApiError(400, '수급자(보호자)의 의견·동의 여부를 선택해 주세요.')
  const input: StaffNoteDraftInput = {
    reasonLabel: str(body.reasonLabel),
    reasonMemo: str(body.reasonMemo),
    counselMethod: method as CounselMethod,
    relation: str(body.relation),
    consent: consent as ConsentChoice,
    opinionMemo: str(body.opinionMemo),
  }
  const problem = validateDraftInput(input)
  if (problem) throw new ApiError(400, problem)
  return input
}

export function aiConfigured(): boolean {
  return env.useVertexAi || Boolean(process.env.GEMINI_API_KEY)
}

function userMessage(input: StaffNoteDraftInput): string {
  return JSON.stringify({
    reason: input.reasonLabel,
    reasonMemo: input.reasonMemo || null,
    counselMethod: COUNSEL_METHOD_LABEL[input.counselMethod],
    relation: input.relation,
    consent: CONSENT_LABEL[input.consent],
    opinionMemo: input.opinionMemo || null,
  })
}

async function askModel(input: StaffNoteDraftInput): Promise<{ reason?: unknown; content?: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  let url: string
  if (env.useVertexAi) {
    headers.authorization = `Bearer ${await getVertexAccessToken()}`
    url =
      `https://${env.vertexLocation}-aiplatform.googleapis.com/v1/projects/${env.vertexProjectId}` +
      `/locations/${env.vertexLocation}/publishers/google/models/${MODEL}:generateContent`
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.geminiApiKey}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userMessage(input) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.2 },
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('empty response')
    return JSON.parse(text) as { reason?: unknown; content?: unknown }
  } finally {
    clearTimeout(timer)
  }
}

export async function draftStaffNoteText(input: StaffNoteDraftInput): Promise<StaffNoteDraftResult> {
  const template = buildTemplateDraft(input)
  if (!aiConfigured()) return { ...template, source: 'template', fallbackReason: 'not_configured' }
  let out: { reason?: unknown; content?: unknown }
  try {
    out = await askModel(input)
  } catch (e) {
    // 내용(입력·응답)은 로그에 남기지 않는다 — 실패 종류만.
    console.error('직원변경 상담일지 AI 초안 실패:', e instanceof Error ? e.message : 'unknown')
    return { ...template, source: 'template', fallbackReason: 'failed' }
  }
  if (!checkAiDraft(out, input)) return { ...template, source: 'template', fallbackReason: 'rejected' }
  return { reason: out.reason.trim(), content: out.content.trim(), source: 'ai' }
}
