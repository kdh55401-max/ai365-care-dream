import type { IncomingMessage, ServerResponse } from 'node:http'
import { centerLogin, centerLogout } from '../centerAuth.js'
import { readJsonBody, requireMethod, sendJson, withHandler, ApiError } from '../http.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) { await withHandler(res, async () => {
  requireMethod(req, 'POST', 'DELETE')
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, '동일 사이트에서 요청하세요.')
  if (req.method === 'DELETE') { centerLogout(res); sendJson(res, 200, { ok: true }); return }
  const body = await readJsonBody(req)
  const email = String(body.email || ''); const password = String(body.password || '')
  if (!email || !password || email.length > 254 || password.length > 256) throw new ApiError(400, '이메일과 비밀번호를 확인하세요.')
  const result = await centerLogin(email, password, res); sendJson(res, 200, { ok: true, ...result })
}) }

