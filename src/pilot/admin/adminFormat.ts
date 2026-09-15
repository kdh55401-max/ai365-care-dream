import type { StructuredReport } from '../shared/types'

/** 관리자 화면(AdminApp·수급자 허브)이 함께 쓰는 표시 규칙. */

export const FIELD_LABELS: Array<{ key: keyof StructuredReport; label: string }> = [
  { key: 'change', label: '관찰한 돌봄 상황' },
  { key: 'action', label: '현장에서 한 조치' },
  { key: 'result', label: '현재 상태' },
  { key: 'escalation', label: '센터 확인사항' },
  { key: 'caregiverNote', label: '요양보호사 상황·지원 요청 (발화 원문 발췌)' },
]

/** 관리자 화면 전반에서 시각을 사람이 바로 읽을 수 있는 형태로 보여준다("2026-09-
 * 12T02:14:22.716+00:00" 같은 원본 문자열을 그대로 노출하지 않는다) — 올해면 연도를
 * 생략해 더 짧게 보여준다. */
export function formatKoreanDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const datePart = d.toLocaleDateString('ko-KR', { year: sameYear ? undefined : 'numeric', month: 'long', day: 'numeric' })
  const timePart = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
  return `${datePart} ${timePart}`
}
