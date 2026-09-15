import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseCookie, stringifySetCookie } from 'cookie'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { env } from './env.js'
import { ApiError, getQuery } from './http.js'
import { checkOrganizationAccess, DEPLOYMENT_ORGANIZATION, type Organization } from '../../shared/organization.js'

const CARE_COOKIE = 'ai365_care_session'
const ADMIN_COOKIE = 'ai365_admin_session'
const CARE_SESSION_DAYS = 14
const ADMIN_SESSION_DAYS = 14

function secretKey() {
  return new TextEncoder().encode(env.jwtSecret)
}

export interface CareSession {
  role: 'care'
  participantCode: string
}

export interface AdminSession {
  role: 'admin'
  /** 서버가 서명한 기관 ID. 클라이언트가 보내는 기관 ID는 이 값과 대조만 한다. */
  organizationId: string
}

async function signSession(payload: Record<string, unknown>, days: number): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secretKey())
}

async function verifySession(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey())
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}

function readCookies(req: IncomingMessage): Record<string, string | undefined> {
  return parseCookie(req.headers.cookie ?? '')
}

function cookieOptions(name: string, value: string, maxAgeDays: number) {
  return {
    name,
    value,
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeDays * 24 * 60 * 60,
  }
}

export async function setCareSessionCookie(res: ServerResponse, participantCode: string) {
  const token = await signSession({ role: 'care', participantCode }, CARE_SESSION_DAYS)
  res.setHeader('set-cookie', stringifySetCookie(cookieOptions(CARE_COOKIE, token, CARE_SESSION_DAYS)))
}

/** 관리자 비밀번호는 이 배포(= 파일럿 기관 한 곳)에 하나뿐이므로 로그인하면 그 기관
 * 세션이 된다. 기관별 계정은 다기관 가입을 만들 때 추가한다(이번 범위 아님). */
export async function setAdminSessionCookie(res: ServerResponse, organizationId: string = DEPLOYMENT_ORGANIZATION.id) {
  const token = await signSession({ role: 'admin', orgId: organizationId }, ADMIN_SESSION_DAYS)
  res.setHeader('set-cookie', stringifySetCookie(cookieOptions(ADMIN_COOKIE, token, ADMIN_SESSION_DAYS)))
}

export function clearCareSessionCookie(res: ServerResponse) {
  res.setHeader('set-cookie', stringifySetCookie({ ...cookieOptions(CARE_COOKIE, '', 0), maxAge: 0 }))
}

export function clearAdminSessionCookie(res: ServerResponse) {
  res.setHeader('set-cookie', stringifySetCookie({ ...cookieOptions(ADMIN_COOKIE, '', 0), maxAge: 0 }))
}

export async function getCareSession(req: IncomingMessage): Promise<CareSession | null> {
  const token = readCookies(req)[CARE_COOKIE]
  if (!token) return null
  const payload = await verifySession(token)
  if (!payload || payload.role !== 'care' || typeof payload.participantCode !== 'string') return null
  return { role: 'care', participantCode: payload.participantCode }
}

export async function getAdminSession(req: IncomingMessage): Promise<AdminSession | null> {
  const token = readCookies(req)[ADMIN_COOKIE]
  if (!token) return null
  const payload = await verifySession(token)
  if (!payload || payload.role !== 'admin') return null
  // 기관 클레임이 없는 토큰은 이 변경 전에 발급된 것이다 — 그때도 이 배포의 유일한
  // 관리자 비밀번호로만 발급됐으므로 이 배포의 기관 세션으로 읽는다(재로그인 강제 없음).
  const organizationId = typeof payload.orgId === 'string' ? payload.orgId : DEPLOYMENT_ORGANIZATION.id
  return { role: 'admin', organizationId }
}

export async function requireCareSession(req: IncomingMessage): Promise<CareSession> {
  const session = await getCareSession(req)
  if (!session) throw new ApiError(401, '로그인이 필요합니다.')
  return session
}

export async function requireAdminSession(req: IncomingMessage): Promise<AdminSession> {
  const session = await getAdminSession(req)
  if (!session) throw new ApiError(401, '관리자 로그인이 필요합니다.')
  return session
}

/** 관리자 세션 + 기관 범위 확인. 요청에 `org` 쿼리가 있으면 세션 기관과 같아야 한다
 * (다른 기관 URL을 직접 열거나 API를 직접 호출해도 세션 기관 밖은 거부). */
export async function requireAdminOrganization(req: IncomingMessage): Promise<{ session: AdminSession; organization: Organization }> {
  const session = await requireAdminSession(req)
  const access = checkOrganizationAccess(session.organizationId, getQuery(req).get('org'))
  if (!access.ok) throw new ApiError(access.status, access.reason)
  return { session, organization: access.organization }
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10)
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!hash || hash === 'unset') return false
  try {
    return await bcrypt.compare(pin, hash)
  } catch {
    return false
  }
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, env.adminPasswordHash)
  } catch {
    return false
  }
}

/** 관리자 PIN 초기화 시 발급하는 4자리 숫자 PIN. crypto로 생성해 예측 가능성을 낮춘다. */
export function generateRandomPin(): string {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  const n = bytes[0] % 10000
  return String(n).padStart(4, '0')
}
