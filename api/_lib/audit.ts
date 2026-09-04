import { getSupabaseAdmin } from './supabase.js'

/** 관리자의 열람/평가/다운로드/PIN초기화/삭제/로그인 기록. 실패해도 본 요청은 막지 않는다. */
export async function logAudit(action: string, target?: string, detail?: Record<string, unknown>) {
  try {
    await getSupabaseAdmin()
      .from('admin_audit_log')
      .insert({ action, target: target ?? null, detail: detail ?? null })
  } catch (err) {
    console.error('audit log failed', err)
  }
}
