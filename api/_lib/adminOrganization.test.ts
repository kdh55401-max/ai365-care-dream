import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeAll, describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import { requireAdminOrganization, setAdminSessionCookie } from './auth.js'
import { ApiError } from './http.js'

const SECRET = 'test-secret-for-admin-organization-scope-0123456789'

beforeAll(() => {
  process.env.CARE_PILOT_JWT_SECRET = SECRET
})

async function issuedCookie(orgId?: string): Promise<string> {
  let header = ''
  const res = { setHeader: (_: string, v: string) => (header = v) } as unknown as ServerResponse
  await setAdminSessionCookie(res, orgId)
  return header.split(';')[0]
}

async function legacyCookie(): Promise<string> {
  // 기관 클레임이 생기기 전 방식으로 서명된 관리자 토큰
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1d')
    .sign(new TextEncoder().encode(SECRET))
  return `ai365_admin_session=${token}`
}

function req(cookie: string | undefined, url = '/api/admin/recipients'): IncomingMessage {
  return { headers: cookie ? { cookie } : {}, url } as unknown as IncomingMessage
}

async function statusOf(p: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof ApiError ? e.statusCode : -1
  }
}

describe('관리자 기관 범위 (서버 권한)', () => {
  it('로그인으로 발급한 세션은 이 배포의 기관으로 들어간다', async () => {
    const { organization } = await requireAdminOrganization(req(await issuedCookie()))
    expect(organization.id).toBe('gadream365')
  })

  it('기관 클레임이 없는 기존 세션도 재로그인 없이 이 배포의 기관으로 읽는다', async () => {
    const { organization } = await requireAdminOrganization(req(await legacyCookie()))
    expect(organization.id).toBe('gadream365')
  })

  it('요청이 다른 기관을 가리키면(직접 URL·직접 API 호출) 403으로 거부한다', async () => {
    const cookie = await issuedCookie()
    expect(await statusOf(requireAdminOrganization(req(cookie, '/api/admin/recipients?org=other-center')))).toBe(403)
    expect(await statusOf(requireAdminOrganization(req(cookie, '/api/admin/recipients?org=gadream365')))).toBe('ok')
  })

  it('알 수 없는 기관의 세션은 모든 기관 데이터에서 거부된다', async () => {
    expect(await statusOf(requireAdminOrganization(req(await issuedCookie('unknown-center'))))).toBe(403)
  })

  it('세션이 없거나 위조된 쿠키는 401이다 — 클라이언트가 보낸 기관 ID만으로는 통과하지 못한다', async () => {
    expect(await statusOf(requireAdminOrganization(req(undefined, '/api/admin/recipients?org=gadream365')))).toBe(401)
    expect(await statusOf(requireAdminOrganization(req('ai365_admin_session=forged.token.value', '/api/admin/recipients?org=gadream365')))).toBe(401)
  })
})
