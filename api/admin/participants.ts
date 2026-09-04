import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { requireAdminSession, generateRandomPin, hashPin } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { logAudit } from '../_lib/audit.js'

const CODE_PATTERN = /^C0[1-9]$/

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST')
    await requireAdminSession(req)
    const supabase = getSupabaseAdmin()

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('participants')
        .select('code, active, pin_hash, updated_at')
        .order('code', { ascending: true })
      if (error) throw new ApiError(500, '참여자 목록을 불러오지 못했습니다.')
      sendJson(res, 200, {
        participants: (data ?? []).map((p: { code: string; active: boolean; pin_hash: string; updated_at: string }) => ({
          code: p.code,
          active: p.active,
          pinSet: p.pin_hash !== 'unset',
          updatedAt: p.updated_at,
        })),
      })
      return
    }

    // POST: PIN 초기화
    const body = await readJsonBody(req)
    const code = String(body.code ?? '').trim().toUpperCase()
    if (!CODE_PATTERN.test(code)) throw new ApiError(400, '참여자 코드가 올바르지 않습니다.')

    const newPin = generateRandomPin()
    const pinHash = await hashPin(newPin)

    const { error } = await supabase.from('participants').update({ pin_hash: pinHash }).eq('code', code)
    if (error) throw new ApiError(500, 'PIN을 초기화하지 못했습니다.')

    await logAudit('reset_pin', code)
    // 새 PIN은 이 응답에서만 평문으로 노출된다. 저장하지 않고 관리자가 즉시 오프라인으로 전달해야 한다.
    sendJson(res, 200, { code, pin: newPin })
  })
}
