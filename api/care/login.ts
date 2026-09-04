import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { clearCareSessionCookie, setCareSessionCookie, verifyPin } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'

const CODE_PATTERN = /^C0[1-9]$/

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'POST', 'DELETE')

    if (req.method === 'DELETE') {
      clearCareSessionCookie(res)
      sendJson(res, 200, { ok: true })
      return
    }

    const body = await readJsonBody(req)
    const code = String(body.code ?? '').trim().toUpperCase()
    const pin = String(body.pin ?? '').trim()

    if (!CODE_PATTERN.test(code)) {
      throw new ApiError(400, '참여자 코드가 올바르지 않습니다.')
    }
    if (!/^\d{4,6}$/.test(pin)) {
      throw new ApiError(400, 'PIN을 확인해 주세요.')
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('participants')
      .select('code, pin_hash, active')
      .eq('code', code)
      .maybeSingle()

    if (error) throw new ApiError(500, '로그인 처리 중 오류가 발생했습니다.')
    if (!data || !data.active) {
      throw new ApiError(401, '참여자 코드 또는 PIN이 올바르지 않습니다.')
    }

    const ok = await verifyPin(pin, data.pin_hash as string)
    if (!ok) {
      throw new ApiError(401, '참여자 코드 또는 PIN이 올바르지 않습니다.')
    }

    await setCareSessionCookie(res, code)
    sendJson(res, 200, { ok: true, participantCode: code })
  })
}
