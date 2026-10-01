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

    // 로그인한 요양보호사에게 배정된 수급자만 돌려준다 — 전체 수급자 목록이
    // 아니라 caregiver_assignments를 거쳐야 한다. 배정이 없으면 빈 배열.
    const { data: assignments } = await supabase
      .from('caregiver_assignments')
      .select('recipient_code')
      .eq('caregiver_code', session.participantCode)
      .eq('active', true)
    const assignedCodes = (assignments ?? []).map((a: { recipient_code: string }) => a.recipient_code)

    // 서버가 매번 "배정 + 활성"을 다시 확인한다 — 배정 해제·비활성화는 다음 조회부터 바로 반영된다.
    // display_name은 수급자 등록 마이그레이션(2026-10-02)이 적용된 뒤에만 있다 — 없으면 코드만 돌려준다(기존 동작).
    let recipients: Array<{ code: string; displayName: string | null }> = []
    if (assignedCodes.length > 0) {
      const withName = await supabase.from('recipients').select('code, display_name').in('code', assignedCodes).eq('active', true).order('code', { ascending: true })
      if (!withName.error) {
        recipients = (withName.data ?? []).map((r: { code: string; display_name: string | null }) => ({ code: r.code, displayName: r.display_name ?? null }))
      } else {
        const { data } = await supabase.from('recipients').select('code').in('code', assignedCodes).eq('active', true).order('code', { ascending: true })
        recipients = (data ?? []).map((r: { code: string }) => ({ code: r.code, displayName: null }))
      }
    }
    const recipientCodes = recipients.map((r) => r.code)

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
      recipientCodes,
      recipients,
    })
  })
}
