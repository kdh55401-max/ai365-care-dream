/**
 * 시연용(/demo) 아바타 대화. 교수님 등 방문자가 앱이 어떤 것인지 실제 AI와 말로 주고받아 보게 한다.
 * - 시연 비밀번호는 서버에서만 확인한다(해시 비교, 환경변수 DEMO_PASSWORD_HASH가 있으면 그 값).
 * - AI는 센터 서버 계정 하나로만 부른다(GEMINI_API_KEY 또는 Vertex). 브라우저에 키가 가지 않는다.
 * - 보내기 전에 전화번호·주민번호를 가리고, 한 번에 보내는 양과 대화 길이를 제한해 비용을 막는다.
 * - 기록은 저장하지 않는다.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { maskForAi } from '../../shared/researchCare.js'
import { env } from './env.js'
import { ApiError } from './http.js'
import { getVertexAccessToken } from './vertexAuth.js'

const DEFAULT_PASSWORD_SHA256 = '9d70225dfc3f70cac539bd8de4a7ff7cf7abaaa1fd4ea25c7bca92c22659bab2'
const MAX_MESSAGE = 500
const MAX_TURNS = 16
const TIMEOUT_MS = 20000

export const DEMO_SYSTEM_PROMPT = [
  "당신은 'AI365 CARE DREAM'의 AI 돌봄 동료(화면 속 아바타)입니다. 가드림365재가복지센터 요양보호사의 방문 기록을 돕습니다.",
  '지금은 시연 화면입니다. 대학 교수님 같은 방문자가 이 앱이 무엇인지 알아보려고 당신과 대화합니다.',
  '말투: 한국어 존댓말, 따뜻하고 자연스럽게. 소리로 읽어 주므로 2~4문장으로 짧게 말하고, 목록·기호·마크다운·이모지는 쓰지 않습니다.',
  '앱 설명이 필요하면 이렇게 알려 줍니다: 네 단계로 씁니다. ① 요양보호사가 방문을 마치고 오늘 본 어르신 모습을 말로 남기고, ② AI가 빠진 내용을 한두 가지만 되묻고, ③ 한 주의 기록을 주간 상태변화기록 초안으로 묶으면 요양보호사가 고쳐서 보내고, ④ 관리자와 사회복지사가 원자료와 초안을 보고 확정하며 상담·후속조치를 기록합니다. 목적은 어르신의 평소와 달라진 상태변화를 놓치지 않고 기록하는 것입니다. 이름은 코드로 가려서 AI에 보내고, AI는 센터 계정 하나로만 씁니다.',
  '상대가 요양보호사처럼 오늘 돌봄 이야기를 하면, 실제 앱처럼 들은 내용을 한 문장으로 정리해 확인하고 빠진 점 하나만 되묻습니다.',
  '진단이나 처방은 하지 않습니다. 위급해 보이면 119와 센터에 먼저 연락하라고 안내합니다.',
  '앱과 관계없는 이야기도 짧고 친절하게 받아 주되, 자연스럽게 앱 체험으로 이어 갑니다.',
].join('\n')

export function isDemoPassword(input: unknown): boolean {
  if (typeof input !== 'string' || input.length > 64) return false
  const expected = Buffer.from((process.env.DEMO_PASSWORD_HASH?.trim() || DEFAULT_PASSWORD_SHA256).toLowerCase(), 'hex')
  const actual = createHash('sha256').update(input.trim()).digest()
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export interface DemoTurn { role: 'user' | 'model'; text: string }

export function normalizeDemoHistory(raw: unknown): DemoTurn[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is DemoTurn => !!t && typeof t === 'object' && ((t as DemoTurn).role === 'user' || (t as DemoTurn).role === 'model') && typeof (t as DemoTurn).text === 'string')
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, text: maskForAi(t.text.slice(0, 1000), []) }))
}

/** body.mode: 'demo-login' → 비밀번호만 확인, 'demo-chat' → 실제 AI 답변. */
export async function handleDemo(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isDemoPassword(body.password)) throw new ApiError(401, '시연 비밀번호가 맞지 않습니다.')
  if (body.mode === 'demo-login') return { ok: true }
  const message = String(body.message ?? '').trim()
  if (!message) throw new ApiError(400, '하실 말씀을 입력해 주세요.')
  if (message.length > MAX_MESSAGE) throw new ApiError(400, `한 번에 ${MAX_MESSAGE}자까지 보낼 수 있어요.`)
  const history = normalizeDemoHistory(body.history)
  const result = await callDemoAi([...history, { role: 'user', text: maskForAi(message, []) }])
  if (!result) return { reply: null, error: 'AI 연결이 되지 않았어요. 센터 AI 설정을 확인해 주세요.' }
  return { reply: result.text, model: result.model }
}

async function callDemoAi(turns: DemoTurn[]): Promise<{ text: string; model: string } | null> {
  let configuration
  try { configuration = env.careAiConfiguration } catch { return null }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  let url: string
  try {
    if (configuration.provider === 'vertex') {
      headers.authorization = `Bearer ${await getVertexAccessToken()}`
      url = `https://${env.vertexLocation}-aiplatform.googleapis.com/v1/projects/${env.vertexProjectId}` +
        `/locations/${env.vertexLocation}/publishers/google/models/${configuration.model}:generateContent`
    } else {
      headers['x-goog-api-key'] = env.geminiApiKey
      url = `https://generativelanguage.googleapis.com/v1beta/models/${configuration.model}:generateContent`
    }
  } catch { return null }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: DEMO_SYSTEM_PROMPT }] },
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
    })
    if (!res.ok) { console.warn('demo-ai-failed', { status: res.status }); return null }
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }
    const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim()
    return text ? { text, model: configuration.model } : null
  } catch {
    console.warn('demo-ai-failed', { status: 0 })
    return null
  } finally {
    clearTimeout(timer)
  }
}
