import type { IncomingMessage, ServerResponse } from 'node:http'
import { requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { getAdminSession } from '../_lib/auth.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET')
    const session = await getAdminSession(req)
    sendJson(res, 200, { authenticated: Boolean(session) })
  })
}
