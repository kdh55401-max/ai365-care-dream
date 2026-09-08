import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseCookie, stringifySetCookie } from 'cookie'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { env } from './env.js'
import { ApiError } from './http.js'

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

export async function setAdminSessionCookie(res: ServerResponse) {
  const token = await signSession({ role: 'admin' }, ADMIN_SESSION_DAYS)
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
  return { role: 'admin' }
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
