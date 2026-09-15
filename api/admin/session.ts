import type { IncomingMessage, ServerResponse } from 'node:http'
import { requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { getAdminSession } from '../_lib/auth.js'
import { findOrganization } from '../../shared/organization.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET')
    const session = await getAdminSession(req)
    // 관리자 화면은 이 기관 정보로 자기 기관 수급자 목록에 바로 들어간다(기관 선택 없음).
    sendJson(res, 200, {
      authenticated: Boolean(session),
      organization: session ? findOrganization(session.organizationId) : null,
    })
  })
}
