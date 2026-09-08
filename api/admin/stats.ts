import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { requireAdminSession } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { todayKstDateString } from '../_lib/date.js'
import type { CareReportRecord } from '../../shared/careTypes.js'
import {
  buildCumulativeSeries,
  buildParticipationGrid,
  computeScenarioStats,
  computeStats,
  pilotDateRange,
} from '../../shared/statsCalc.js'

const PILOT_START = process.env.CARE_PILOT_START_DATE ?? '2026-09-07'
const PILOT_END = process.env.CARE_PILOT_END_DATE ?? '2026-09-18'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET')
    await requireAdminSession(req)

    const { data, error } = await getSupabaseAdmin().from('reports').select('*').eq('deleted', false).limit(5000)
    if (error) throw new ApiError(500, '통계를 계산하지 못했습니다.')

    const rows = (data ?? []) as unknown as CareReportRecord[]
    const today = todayKstDateString()
    const dates = pilotDateRange(PILOT_START, PILOT_END)

    sendJson(res, 200, {
      pilotPeriod: { start: PILOT_START, end: PILOT_END },
      today,
      generatedAt: new Date().toISOString(),
      stats: computeStats(rows, today),
      scenarioStats: computeScenarioStats(rows),
      participationGrid: buildParticipationGrid(rows, dates),
      cumulativeSeries: buildCumulativeSeries(rows, dates, today),
    })
  })
}
