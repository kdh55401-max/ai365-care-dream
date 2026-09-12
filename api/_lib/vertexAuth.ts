import { SignJWT, importPKCS8 } from 'jose'
import { env } from './env.js'

/** Vertex AI는 API 키가 아니라 GCP 서비스 계정의 OAuth2 access token으로 인증한다.
 * 별도 Google SDK(google-auth-library 등)를 추가하지 않고, 이미 이 저장소가 자체
 * 세션 JWT 서명에 쓰는 jose로 "서비스 계정 JWT-bearer" 흐름을 직접 구현한다 —
 * 새 의존성 없이, RFC 7523(JWT Bearer)을 그대로 따른다:
 * https://developers.google.com/identity/protocols/oauth2/service-account#httprest
 */
interface ServiceAccountKey {
  client_email: string
  private_key: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function parseServiceAccountKey(): ServiceAccountKey {
  const raw = env.vertexServiceAccountJson
  if (!raw) throw new Error('GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON이 설정되지 않았습니다.')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON이 올바른 JSON이 아닙니다.')
  }
  const key = parsed as Partial<ServiceAccountKey>
  if (!key.client_email || !key.private_key) {
    throw new Error('GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON에 client_email/private_key가 없습니다.')
  }
  return key as ServiceAccountKey
}

async function fetchAccessToken(): Promise<{ token: string; expiresInSeconds: number }> {
  const key = parseServiceAccountKey()
  const privateKey = await importPKCS8(key.private_key, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(key.client_email)
    .setSubject(key.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Vertex AI 인증 토큰 발급 실패 (HTTP ${res.status}): ${detail.slice(0, 300)}`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  return { token: data.access_token, expiresInSeconds: data.expires_in }
}

/** 서버리스 함수가 warm 상태로 재사용될 때(같은 인스턴스가 다음 요청도 처리할 때)
 * 매번 새로 토큰을 받지 않도록 만료 60초 전까지는 캐시를 그대로 쓴다. 콜드
 * 스타트마다는 모듈이 새로 로드되므로 자연히 새 토큰을 받는다 — 별도 무효화
 * 로직이 필요 없다. */
export async function getVertexAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.token
  const { token, expiresInSeconds } = await fetchAccessToken()
  cachedToken = { token, expiresAt: now + expiresInSeconds * 1000 }
  return token
}
