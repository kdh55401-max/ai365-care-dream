import type { IncomingMessage, ServerResponse } from 'node:http'
import { canUseLegacyPilot, requireCenterMaster } from '../centerAuth.js'
import { getSupabaseAdmin } from '../supabase.js'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../http.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) { await withHandler(res, async () => {
  requireMethod(req, 'GET', 'PATCH')
  const actor = await requireCenterMaster(req), db = getSupabaseAdmin()
  if (req.method === 'GET') {
    const { data, error } = await db.from('center_members').select('id,name,email,requested_role,role,status,participant_code,created_at').eq('organization_code', actor.organization_code).order('created_at', { ascending: false }).limit(200)
    if (error) throw new ApiError(503, '가입 신청 목록을 불러오지 못했습니다.')
    sendJson(res, 200, { members: data || [] }); return
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, '동일 사이트에서 요청하세요.')
  const body = await readJsonBody(req), id = String(body.id || ''), role = body.role === 'admin' ? 'admin' : 'caregiver'
  const status = body.status === 'active' ? 'active' : body.status === 'rejected' ? 'rejected' : null
  if (!status || !/^[0-9a-f-]{36}$/i.test(id) || id === actor.id) throw new ApiError(400, '다른 가입 신청의 승인 또는 반려를 선택하세요.')
  const participantCode = role === 'caregiver' && status === 'active' ? String(body.participantCode || '').trim().toUpperCase() : null
  if (role === 'caregiver' && status === 'active') {
    if (!canUseLegacyPilot(actor) || !participantCode) throw new ApiError(400, '기관의 돌봄보고 연결 설정과 참여자코드가 필요합니다.')
    const { data: participant, error } = await db.from('participants').select('code').eq('code', participantCode).eq('active', true).maybeSingle()
    if (error || !participant) throw new ApiError(400, '사용 가능한 참여자코드가 아닙니다.')
  }
  const { data, error } = await db.from('center_members').update({ role, status, participant_code: participantCode, approved_by_master: actor.id, approved_at: new Date().toISOString() }).eq('id', id).eq('organization_code', actor.organization_code).eq('status', 'pending').select('id').maybeSingle()
  if (error) throw new ApiError(409, '승인 정보를 반영하지 못했습니다. 참여자코드 중복 여부를 확인하세요.')
  if (!data) throw new ApiError(409, '같은 기관의 승인 대기 신청이 아닙니다. 새로고침해 주세요.')
  sendJson(res, 200, { ok: true })
}) }
