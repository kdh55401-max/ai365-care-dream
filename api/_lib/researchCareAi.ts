/**
 * 연구용 흐름의 AI 호출(하루 되묻기 1회, 주간 초안 1회). 센터 서버 계정 하나로만 부른다.
 * 실패하면 예외 대신 null을 돌려주고, 부른 쪽이 규칙 기반 결과로 대신한다(요양보호사 흐름을 멈추지 않는다).
 * 보내는 글은 부르기 전에 maskForAi로 가린 것이어야 한다.
 */
import { env } from './env.js'
import { getVertexAccessToken } from './vertexAuth.js'

const TIMEOUT_MS = 15000

export interface ShortAiCall {
  system: string
  user: string
  schema: Record<string, unknown>
  maxOutputTokens: number
}

export interface ShortAiResult { value: unknown; model: string }

export async function callShortAi(call: ShortAiCall): Promise<ShortAiResult | null> {
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
        systemInstruction: { parts: [{ text: call.system }] },
        contents: [{ role: 'user', parts: [{ text: call.user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: call.schema,
          temperature: 0.2,
          maxOutputTokens: call.maxOutputTokens,
        },
      }),
    })
    if (!res.ok) { console.warn('research-ai-failed', { status: res.status }); return null }
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null
    return { value: JSON.parse(text), model: configuration.model }
  } catch {
    console.warn('research-ai-failed', { status: 0 })
    return null
  } finally {
    clearTimeout(timer)
  }
}
