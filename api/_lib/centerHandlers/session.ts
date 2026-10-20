import type { IncomingMessage, ServerResponse } from 'node:http'
import { centerSession } from '../centerAuth.js'
import { requireMethod, sendJson, withHandler } from '../http.js'
export default async function handler(req: IncomingMessage, res: ServerResponse) { await withHandler(res, async () => { requireMethod(req, 'GET'); const session = await centerSession(req); sendJson(res, 200, { authenticated: Boolean(session), role: session?.role, organizationCode: session?.organization_code, name: session?.name, redirect: session?.role === 'caregiver' ? '/care' : '/center' }) }) }
