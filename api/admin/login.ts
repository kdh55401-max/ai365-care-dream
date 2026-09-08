import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, readJsonBody, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { clearAdminSessionCookie, setAdminSessionCookie, verifyAdminPassword } from '../_lib/auth.js'
import { logAudit } from '../_lib/audit.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'POST', 'DELETE')

    if (req.method === 'DELETE') {
      clearAdminSessionCookie(res)
      sendJson(res, 200, { ok: true })
      return
    }

    const body = await readJsonBody(req)
    const password = String(body.password ?? '')
    if (!password) throw new ApiError(400, '비밀번호를 입력해 주세요.')

    const ok = await verifyAdminPassword(password)
    if (!ok) throw new ApiError(401, '비밀번호가 올바르지 않습니다.')

    await setAdminSessionCookie(res)
    await logAudit('login')
    sendJson(res, 200, { ok: true })
  })
}
