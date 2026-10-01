import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, getQuery, readJsonBody, requireMethod, sendJson, withHandler } from '../_lib/http.js'
import { requireAdminOrganization, generateRandomPin, hashPin } from '../_lib/auth.js'
import { getSupabaseAdmin } from '../_lib/supabase.js'
import { logAudit } from '../_lib/audit.js'
import { loadRecipientAdminView, registerRecipient, updateRecipient } from '../_lib/recipientAdminStore.js'
import { loadStaffNoteView, saveStaffNote } from '../_lib/staffChangeNoteStore.js'
import { draftStaffNoteText, parseDraftInput } from '../_lib/staffNoteAi.js'
import { todayKstDateString } from '../_lib/date.js'

const CODE_PATTERN = /^C0[1-9]$/

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await withHandler(res, async () => {
    requireMethod(req, 'GET', 'POST')
    await requireAdminOrganization(req)
    const supabase = getSupabaseAdmin()

    // 수급자 등록·담당 요양보호사 배정(Vercel 함수 개수 제한 때문에 이 파일에 함께 둔다). 관리자 세션은 위에서 이미 확인했다.
    if (req.method === 'GET' && getQuery(req).get('view') === 'recipients') {
      sendJson(res, 200, await loadRecipientAdminView(supabase))
      return
    }

    // 직원(담당 요양보호사) 변경 상담일지 — 담당이 해제된 변경마다 한 건. 같은 이유로 이 파일에 둔다.
    if (req.method === 'GET' && getQuery(req).get('view') === 'staff_notes') {
      sendJson(res, 200, await loadStaffNoteView(supabase, todayKstDateString()))
      return
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('participants')
        .select('code, active, pin_hash, updated_at')
        .order('code', { ascending: true })
      if (error) throw new ApiError(500, '참여자 목록을 불러오지 못했습니다.')

      // 요양보호사(C코드)별 배정된 수급자(A코드) 목록도 함께 내려준다 — 관리자
      // 화면에서 C-A 매칭 관계를 확인할 수 있어야 한다.
      const { data: assignments } = await supabase
        .from('caregiver_assignments')
        .select('caregiver_code, recipient_code')
        .eq('active', true)
        .order('recipient_code', { ascending: true })
      const assignmentMap: Record<string, string[]> = {}
      for (const a of (assignments ?? []) as Array<{ caregiver_code: string; recipient_code: string }>) {
        ;(assignmentMap[a.caregiver_code] ??= []).push(a.recipient_code)
      }

      sendJson(res, 200, {
        participants: (data ?? []).map((p: { code: string; active: boolean; pin_hash: string; updated_at: string }) => ({
          code: p.code,
          active: p.active,
          pinSet: p.pin_hash !== 'unset',
          updatedAt: p.updated_at,
          recipientCodes: assignmentMap[p.code] ?? [],
        })),
      })
      return
    }

    const body = await readJsonBody(req)
    if (body.op === 'recipient_register' || body.op === 'recipient_update') {
      const result = body.op === 'recipient_register' ? await registerRecipient(supabase, body) : await updateRecipient(supabase, body)
      // 표시명 등 내용은 감사 기록에 남기지 않는다 — 어떤 수급자에 무슨 작업을 했는지만.
      if (!result.duplicate) await logAudit(body.op, result.code)
      sendJson(res, 200, result)
      return
    }

    // 선택지 → 기록 문장 초안(저장하지 않음). 어떤 방식으로 만들어졌는지(AI/기본 문장)만 감사 기록에 남기고 내용은 남기지 않는다.
    if (body.op === 'staff_note_draft') {
      const result = await draftStaffNoteText(parseDraftInput(body))
      await logAudit('staff_note_ai_text', result.source)
      sendJson(res, 200, result)
      return
    }

    if (body.op === 'staff_note_save') {
      const result = await saveStaffNote(supabase, body, todayKstDateString())
      // 일지 내용은 감사 기록에 남기지 않는다 — 어떤 변경 건에 초안/확정을 했는지만.
      await logAudit(body.confirm === true ? 'staff_note_confirm' : 'staff_note_draft', String(result.changeLogId))
      sendJson(res, 200, result)
      return
    }

    // POST: PIN 초기화
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
