import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
const mocks = vi.hoisted(() => ({ profile: null as unknown, organization: { code: 'TEST' } as unknown, signIn: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signInWithPassword: mocks.signIn } }) }))
vi.mock('./supabase.js', () => ({ getSupabaseAdmin: () => ({ from: (table: string) => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'center_members' ? mocks.profile : mocks.organization, error: null }) }; return query } }) }))
import { assertApproved, canUseLegacyPilot, centerLogin, centerSession, requireCenterMaster } from './centerAuth.js'
const secret = 'unit-test-secret-not-for-production-123456789'
const profile = { id: '00000000-0000-4000-8000-000000000001', name: 'Test', organization_code: 'TEST', role: 'admin' as const, status: 'active' as const, participant_code: null }
beforeEach(() => { vi.stubEnv('SUPABASE_URL','https://example.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-placeholder'); vi.stubEnv('CENTER_SESSION_SECRET', secret); vi.stubEnv('CENTER_MASTER_ID', 'test-master'); vi.stubEnv('CENTER_MASTER_ORGANIZATION_CODE', 'TEST'); vi.stubEnv('CENTER_LEGACY_ORGANIZATION_CODE', 'TEST'); mocks.profile = { ...profile }; mocks.organization = { code: 'TEST' }; mocks.signIn.mockReset(); mocks.signIn.mockResolvedValue({ data: { user: { id: profile.id, email_confirmed_at: '2026-01-01' } }, error: null }) })
afterEach(() => vi.unstubAllEnvs())
const request = (cookie: string) => ({ headers: { cookie } }) as IncomingMessage
const response = () => ({ setHeader: vi.fn() }) as unknown as ServerResponse & { setHeader: ReturnType<typeof vi.fn> }
async function signed(role = 'center', sub = profile.id) { return new SignJWT({ role }).setSubject(sub).setProtectedHeader({ alg: 'HS256' }).setIssuer('ai365-center').setAudience('center-workspace').setExpirationTime('1h').sign(new TextEncoder().encode(secret)) }
describe('회원가입 승인과 마스터 권한 경계', () => {
 it('승인대기·반려·정지 계정은 로그인이 불가하다', () => { for (const status of ['pending','rejected','suspended'] as const) expect(() => assertApproved({ ...profile, status })).toThrow(); expect(() => assertApproved(null)).toThrow(); expect(() => assertApproved(profile)).not.toThrow() })
 it('마스터 비밀번호 해시 검증 후 전용 세션을 발급한다', async () => { vi.stubEnv('CENTER_MASTER_PASSWORD_HASH', await bcrypt.hash('test-only-password',4)); const res = response(); await expect(centerLogin('test-master','wrong',res)).rejects.toThrow(); expect(await centerLogin('test-master','test-only-password',res)).toEqual({ role:'master', redirect:'/center' }); const cookie=String(res.setHeader.mock.calls[0][1]); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); const master = await requireCenterMaster(request(cookie.split(';')[0])); expect(master.role).toBe('master'); expect(mocks.signIn).not.toHaveBeenCalled() })
 it('일반 관리자 계정은 가입 승인 권한이 없다', async () => { await expect(requireCenterMaster(request('ai365_center_session='+await signed()))).rejects.toThrow('마스터'); })
 it('기존에 발급된 세션도 현재 회원이 정지되면 거부한다', async () => { const token=await signed(); expect((await centerSession(request('ai365_center_session='+token)))?.role).toBe('admin'); mocks.profile={...profile,status:'suspended'}; expect(await centerSession(request('ai365_center_session='+token))).toBeNull() })
 it('이메일 미인증 및 승인 대기 계정은 쿠키를 받지 못한다', async () => { const res=response(); mocks.signIn.mockResolvedValueOnce({data:{user:{id:profile.id}},error:null}); await expect(centerLogin('test@example.test','test-password',res)).rejects.toThrow(); mocks.profile={...profile,status:'pending'}; await expect(centerLogin('test@example.test','test-password',res)).rejects.toThrow('승인 대기'); expect(res.setHeader).not.toHaveBeenCalled() })
 it('기관이 비활성화되면 세션을 거부하며 다른 기관에 기존 보고를 노출하지 않는다', async () => { mocks.organization=null; expect(await centerSession(request('ai365_center_session='+await signed()))).toBeNull(); expect(canUseLegacyPilot({...profile,organization_code:'OTHER'})).toBe(false) })
 it('인증되지 않은 쿠키와 역할은 거부한다', async () => { expect(await centerSession(request(''))).toBeNull(); expect(await centerSession(request('ai365_center_session=bad'))).toBeNull(); expect(await centerSession(request('ai365_center_session='+await signed('admin')))).toBeNull() })
})
