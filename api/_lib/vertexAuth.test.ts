import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
  vi.resetModules()
})

// 실제 RSA 개인키(테스트 전용, 발급기관 없음 — 어떤 실제 계정과도 무관)로 서명
// 자체는 성공시키고, 네트워크 호출(oauth2 토큰 교환)만 모의한다. jose가 유효한
// PKCS8 PEM을 요구하므로, 테스트 실행 시 즉석에서 생성한다.
async function generateTestPrivateKeyPem(): Promise<string> {
  const { generateKeyPair, exportPKCS8 } = await import('jose')
  const { privateKey } = await generateKeyPair('RS256', { extractable: true })
  return exportPKCS8(privateKey)
}

describe('vertexAuth', () => {
  it('GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON이 없으면 명확한 오류를 던진다', async () => {
    delete process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON
    const { getVertexAccessToken } = await import('./vertexAuth.js')
    await expect(getVertexAccessToken()).rejects.toThrow('GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON')
  })

  it('JSON 형식이 아니면 명확한 오류를 던진다', async () => {
    process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON = 'not-json'
    const { getVertexAccessToken } = await import('./vertexAuth.js')
    await expect(getVertexAccessToken()).rejects.toThrow('올바른 JSON이 아닙니다')
  })

  it('client_email/private_key가 없으면 명확한 오류를 던진다', async () => {
    process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON = JSON.stringify({ foo: 'bar' })
    const { getVertexAccessToken } = await import('./vertexAuth.js')
    await expect(getVertexAccessToken()).rejects.toThrow('client_email/private_key')
  })

  it('정상 키가 있으면 oauth2 토큰 교환을 호출하고 access_token을 반환한다', async () => {
    const privateKey = await generateTestPrivateKeyPem()
    process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'test@example.iam.gserviceaccount.com',
      private_key: privateKey,
    })
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: 'fake-token-1', expires_in: 3600 }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { getVertexAccessToken } = await import('./vertexAuth.js')
    const token = await getVertexAccessToken()
    expect(token).toBe('fake-token-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(String(init?.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
  })

  it('만료 전 재호출은 캐시된 토큰을 그대로 쓰고 네트워크를 다시 부르지 않는다', async () => {
    const privateKey = await generateTestPrivateKeyPem()
    process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'test@example.iam.gserviceaccount.com',
      private_key: privateKey,
    })
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'fake-token-2', expires_in: 3600 }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { getVertexAccessToken } = await import('./vertexAuth.js')
    const first = await getVertexAccessToken()
    const second = await getVertexAccessToken()
    expect(first).toBe('fake-token-2')
    expect(second).toBe('fake-token-2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('토큰 교환이 실패(비정상 HTTP 상태)하면 상태코드를 포함한 오류를 던진다', async () => {
    const privateKey = await generateTestPrivateKeyPem()
    process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'test@example.iam.gserviceaccount.com',
      private_key: privateKey,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid_grant', { status: 400 })),
    )
    const { getVertexAccessToken } = await import('./vertexAuth.js')
    await expect(getVertexAccessToken()).rejects.toThrow('HTTP 400')
  })
})
