/** 관리자 수급자 등록·담당 요양보호사 배정의 공통 규칙. 서버(api/admin/participants.ts)와 데모 저장소가 같은
 * 함수를 쓴다 — 화면(수급자 관리)은 이 모양만 안다. 실제 저장의 원자성·중복 방지는 DB 함수
 * (db/migrations/2026-10-02-recipient-registration.sql)가 맡고, 여기 검증은 같은 규칙을 입력 단계에서 먼저 알려 주는 용도다. */

export const DISPLAY_NAME_MAX = 30
export const RECIPIENT_CODE_PATTERN = /^A[0-9]{2,6}$/
export const CAREGIVER_CODE_PATTERN = /^C[0-9]{2}$/

export interface RecipientAdminRow {
  code: string
  /** 별칭. 아직 입력하지 않은 기존 수급자는 null. */
  displayName: string | null
  active: boolean
  /** 현재 활성 배정된 요양보호사. 비어 있으면 "담당자 미배정". */
  caregivers: string[]
  /** 수정 충돌 검사용(서버 값 그대로 되돌려 보낸다). */
  updatedAt: string
}

export interface CaregiverOption {
  code: string
  active: boolean
}

export interface RecipientAdminView {
  /** false면 DB 마이그레이션이 아직 적용되지 않았다 — 목록 대신 안내만 보인다. */
  ready: boolean
  recipients: RecipientAdminRow[]
  caregivers: CaregiverOption[]
}

export interface RegisterRecipientInput {
  displayName: string
  caregiverCodes: string[]
  active: boolean
  /** 비우면 서버가 다음 A 코드를 자동으로 정한다. */
  code?: string
  /** 같은 요청의 재전송(응답 유실 후 재시도)을 한 번만 저장하는 열쇠. */
  requestId: string
}

export interface UpdateRecipientInput {
  code: string
  displayName?: string
  active?: boolean
  /** 주면 "지금 담당할 전체 목록"이다. 빠진 사람은 삭제가 아니라 해제된다. */
  caregiverCodes?: string[]
  expectedUpdatedAt?: string
  requestId: string
}

export interface RecipientSaveResult {
  code: string
  /** true면 같은 요청이 이미 반영되어 있었다(중복 저장 아님). */
  duplicate: boolean
}

/** 표시명 입력 검사. 문제가 없으면 null, 있으면 사용자에게 보일 문장. 주민등록번호·전화번호처럼 보이는 숫자열은 거부한다
 * (실명·식별번호를 별칭으로 넣지 않게 하는 최소 안전장치 — 완전한 판별은 아니다). */
export function validateDisplayName(raw: string): string | null {
  const name = raw.trim()
  if (name.length === 0) return '표시명(별칭)을 입력해 주세요.'
  if (name.length > DISPLAY_NAME_MAX) return `표시명은 ${DISPLAY_NAME_MAX}자 이내로 입력해 주세요.`
  if (/\d{6}-?[1-4]\d{6}/.test(name) || (name.match(/\d/g) ?? []).length >= 7) {
    return '주민등록번호·전화번호처럼 보이는 숫자는 넣을 수 없습니다. 실명 대신 별칭을 써 주세요.'
  }
  return null
}

export function normalizeCaregiverCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    const code = String(v ?? '').trim().toUpperCase()
    if (code && !out.includes(code)) out.push(code)
  }
  return out
}

/** 수급자 코드 직접 지정 검사. 비어 있으면(자동) null. */
export function validateRecipientCode(raw: string | undefined): string | null {
  const code = (raw ?? '').trim().toUpperCase()
  if (!code) return null
  return RECIPIENT_CODE_PATTERN.test(code) ? null : '수급자 코드는 A와 숫자 2~6자리(예: A10)여야 합니다.'
}

/** 기존 A 계열 코드에서 다음 번호를 정한다(데모 저장소용 — 운영은 DB 함수가 잠금을 잡고 같은 규칙으로 정한다). */
export function nextRecipientCode(existing: string[]): string {
  let max = 0
  for (const c of existing) {
    if (/^A[0-9]{1,6}$/.test(c)) max = Math.max(max, Number(c.slice(1)))
  }
  return `A${String(max + 1).padStart(2, '0')}`
}
