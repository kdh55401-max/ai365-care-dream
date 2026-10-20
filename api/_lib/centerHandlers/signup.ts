import type { IncomingMessage, ServerResponse } from 'node:http'
import { centerAuthClient } from '../centerAuth.js'
import { getSupabaseAdmin } from '../supabase.js'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../http.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) { await withHandler(res, async () => {
  requireMethod(req, 'POST')
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, '동일 사이트에서 신청하세요.')
  const body = await readJsonBody(req)
  const email = String(body.email || '').trim().toLowerCase(), password = String(body.password || ''), name = String(body.name || '').trim(), organizationCode = String(body.organizationCode || '').trim().toUpperCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 128 || !name || name.length > 60 || !/^[A-Z0-9_-]{2,40}$/.test(organizationCode)) throw new ApiError(400, '이름·기관코드·이메일과 12자 이상 비밀번호를 확인하세요.')
  if (body.passwordConfirm !== password) throw new ApiError(400, '비밀번호가 일치하지 않습니다.')
  const { data: organization, error: lookupError } = await getSupabaseAdmin().from('center_organizations').select('code').eq('code', organizationCode).eq('active', true).maybeSingle()
  if (lookupError) throw new ApiError(503, '회원가입 데이터베이스 설정이 필요합니다.')
  if (!organization) throw new ApiError(400, '기관코드를 확인하거나 기관 관리자에게 문의하세요.')
  const { error } = await centerAuthClient().auth.signUp({ email, password, options: { data: { name, organization_code: organizationCode, requested_role: body.requestedRole === 'admin' ? 'admin' : 'caregiver' } } })
  if (error) throw new ApiError(400, '가입 신청을 처리하지 못했습니다. 입력 정보와 기존 가입 여부를 확인하세요.')
  sendJson(res, 200, { ok: true, message: '가입 신청이 접수되었습니다. 이메일 인증 후 기관 관리자의 승인을 기다려 주세요.' })
}) }
