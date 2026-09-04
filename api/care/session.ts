import type { IncomingMessage, ServerResponse } from 'node:http'
import { requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { getCareSession } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { todayKstDateString } from '../_lib/date.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET')
    const session = await getCareSession(req)
    if (!session) {
      sendJson(res, 200, { authenticated: false })
      return
    }

    const supabase = getSupabaseAdmin()
    const today = todayKstDateString()
    const { data: recipients } = await supabase
      .from('recipients')
      .select('code')
      .eq('active', true)
      .order('code', { ascending: true })

    const { data: dailyToday } = await supabase
      .from('reports')
      .select('id, status')
      .eq('participant_code', session.participantCode)
      .eq('report_date', today)
      .eq('report_type', 'daily')
      .eq('deleted', false)
      .maybeSingle()

    sendJson(res, 200, {
      authenticated: true,
      participantCode: session.participantCode,
      today,
      dailyReportToday: dailyToday ?? null,
      recipientCodes: (recipients ?? []).map((r: { code: string }) => r.code),
    })
  })
}
