import type { IncomingMessage, ServerResponse } from 'node:http'
import login from './centerHandlers/login.js'
import signup from './centerHandlers/signup.js'
import session from './centerHandlers/session.js'
import members from './centerHandlers/members.js'
import { sendJson } from './http.js'
export async function handleCenterRequest(req: IncomingMessage, res: ServerResponse) {
  const action = new URL(req.url || '/', 'https://localhost').searchParams.get('centerAction')
  switch (action) {
    case 'login': return login(req, res)
    case 'signup': return signup(req, res)
    case 'session': return session(req, res)
    case 'members': return members(req, res)
    default: sendJson(res, 404, { error: '지원하지 않는 회원 요청입니다.' })
  }
}
