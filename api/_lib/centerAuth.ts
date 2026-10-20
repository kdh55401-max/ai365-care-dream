import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseCookie, stringifySetCookie } from 'cookie'
import { SignJWT, jwtVerify } from 'jose'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { env } from './env.js'
import { getSupabaseAdmin } from './supabase.js'
import { ApiError } from './http.js'

const cookieName = 'ai365_center_session'
export interface CenterMember { id: string; organization_code: string; name: string; role: 'master' | 'admin' | 'caregiver'; status: 'pending' | 'active' | 'rejected' | 'suspended'; participant_code: string | null }
export function centerAuthClient() { return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) }
export function canUseLegacyPilot(member: CenterMember) { return Boolean(process.env.CENTER_LEGACY_ORGANIZATION_CODE) && member.organization_code === process.env.CENTER_LEGACY_ORGANIZATION_CODE }
export function assertApproved(member: CenterMember | null): asserts member is CenterMember { if (!member || member.status !== 'active') throw new ApiError(403, member?.status === 'pending' ? '기관 관리자 승인 대기 중입니다.' : '이 계정은 현재 업무공간을 이용할 수 없습니다.') }
function key() { const value = process.env.CENTER_SESSION_SECRET; if (!value || value.length < 32) throw new ApiError(503, '센터 로그인 서버 설정이 필요합니다.'); return new TextEncoder().encode(value) }
async function readMember(id: string): Promise<CenterMember | null> { const { data, error } = await getSupabaseAdmin().from('center_members').select('id,organization_code,name,role,status,participant_code').eq('id', id).maybeSingle(); if (error) throw new ApiError(503, '센터 회원 데이터베이스 설정이 필요합니다.'); return data }
export async function centerSession(req: IncomingMessage): Promise<CenterMember | null> {
  const token = parseCookie(req.headers.cookie || '')[cookieName]
  if (!token) return null
  let id: string | undefined
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'], issuer: 'ai365-center', audience: 'center-workspace' })
    if (payload.role === 'center_master') {
      if (!process.env.CENTER_MASTER_ID || !process.env.CENTER_MASTER_PASSWORD_HASH || !process.env.CENTER_MASTER_ORGANIZATION_CODE || payload.sub !== process.env.CENTER_MASTER_ID) return null
      return { id: payload.sub, organization_code: process.env.CENTER_MASTER_ORGANIZATION_CODE, name: '마스터 관리자', role: 'master', status: 'active', participant_code: null }
    }
    if (payload.role !== 'center') return null
    id = payload.sub
  } catch { return null }
  if (!id) return null
  const member = await readMember(id)
  if (!member || member.status !== 'active') return null
  const { data: organization, error } = await getSupabaseAdmin().from('center_organizations').select('code').eq('code', member.organization_code).eq('active', true).maybeSingle()
  if (error) throw new ApiError(503, '기관 정보를 확인하지 못했습니다.')
  return organization ? member : null
}
export async function requireCenterMaster(req: IncomingMessage) { const member = await centerSession(req); if (!member || member.role !== 'master') throw new ApiError(403, '마스터 관리자 승인 권한이 필요합니다.'); return member }
export async function centerLogin(email: string, password: string, res: ServerResponse) {
  const secret = key()
  if (process.env.CENTER_MASTER_ID && email.trim() === process.env.CENTER_MASTER_ID) {
    const hash = process.env.CENTER_MASTER_PASSWORD_HASH
    if (!hash || !process.env.CENTER_MASTER_ORGANIZATION_CODE) throw new ApiError(503, '마스터 관리자 초기 설정이 필요합니다.')
    if (!await bcrypt.compare(password, hash)) throw new ApiError(401, '아이디 또는 비밀번호를 확인하세요.')
    const token = await new SignJWT({ role: 'center_master' }).setSubject(process.env.CENTER_MASTER_ID).setProtectedHeader({ alg: 'HS256' }).setIssuer('ai365-center').setAudience('center-workspace').setIssuedAt().setExpirationTime('8h').sign(secret)
    res.setHeader('set-cookie', stringifySetCookie({ name: cookieName, value: token, httpOnly: true, secure: env.isProduction, sameSite: 'strict', path: '/', maxAge: 8 * 3600 }))
    return { role: 'master', redirect: '/center' }
  }
  const { data, error } = await centerAuthClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
  if (error || !data.user || !data.user.email_confirmed_at) throw new ApiError(401, '이메일 인증 여부와 로그인 정보를 확인하세요.')
  const member = await readMember(data.user.id)
  assertApproved(member)
  const { data: organization, error: orgError } = await getSupabaseAdmin().from('center_organizations').select('code').eq('code', member.organization_code).eq('active', true).maybeSingle()
  if (orgError || !organization) throw new ApiError(403, '기관 이용 상태를 확인해 주세요.')
  if (member.role === 'caregiver' && (!member.participant_code || !canUseLegacyPilot(member))) throw new ApiError(403, '계정의 돌봄보고 연결을 기관 관리자에게 요청해 주세요.')
  const token = await new SignJWT({ role: 'center' }).setSubject(member.id).setProtectedHeader({ alg: 'HS256' }).setIssuer('ai365-center').setAudience('center-workspace').setIssuedAt().setExpirationTime('8h').sign(secret)
  res.setHeader('set-cookie', stringifySetCookie({ name: cookieName, value: token, httpOnly: true, secure: env.isProduction, sameSite: 'strict', path: '/', maxAge: 8 * 3600 }))
  return { role: member.role, redirect: member.role === 'admin' ? '/center' : '/care' }
}
export function centerLogout(res: ServerResponse) { res.setHeader('set-cookie', stringifySetCookie({ name: cookieName, value: '', httpOnly: true, secure: env.isProduction, sameSite: 'strict', path: '/', maxAge: 0 })) }
