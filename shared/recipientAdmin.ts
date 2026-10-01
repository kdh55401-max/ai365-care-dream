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
  /** 인적사항(ERP). 인적사항 마이그레이션 전이면 모두 빈 값. */
  profile: RecipientProfile
}

export interface CaregiverOption {
  code: string
  active: boolean
}

export interface RecipientAdminView {
  /** false면 DB 마이그레이션이 아직 적용되지 않았다 — 목록 대신 안내만 보인다. */
  ready: boolean
  /** false면 인적사항 마이그레이션(2026-10-03)이 아직 적용되지 않았다 — 목록은 보이되 인적사항 입력은 안내만 보인다. */
  profileReady: boolean
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
  profile?: Partial<RecipientProfile>
}

export interface UpdateRecipientInput {
  code: string
  displayName?: string
  active?: boolean
  /** 주면 "지금 담당할 전체 목록"이다. 빠진 사람은 삭제가 아니라 해제된다. */
  caregiverCodes?: string[]
  expectedUpdatedAt?: string
  requestId: string
  profile?: Partial<RecipientProfile>
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

// ── ERP 전환(2026-10-03): 수급자 인적사항 ─────────────────────────────────────
// 기관 내부 업무용이라 실명·장기요양인정번호 등 실제 정보를 넣는다. 서버(DB 함수)와 데모 저장소가 같은 규칙을 쓴다.
// 빈 문자열은 "입력 없음"이다.

export const LTC_GRADES = ['1등급', '2등급', '3등급', '4등급', '5등급', '인지지원등급'] as const
export const LTC_NUMBER_PATTERN = /^L[0-9]{10}-[0-9]{3}$/
export const ADDRESS_MAX = 200

export interface RecipientProfile {
  fullName: string
  /** YYYY-MM-DD */
  birthDate: string
  /** 장기요양인정번호 (예: L0011097739-103) */
  ltcNumber: string
  ltcGrade: string
  ltcValidFrom: string
  ltcValidTo: string
  address: string
  phone: string
}

export const EMPTY_PROFILE: RecipientProfile = {
  fullName: '',
  birthDate: '',
  ltcNumber: '',
  ltcGrade: '',
  ltcValidFrom: '',
  ltcValidTo: '',
  address: '',
  phone: '',
}

/** 공백·소문자·하이픈 누락을 바로잡는다("l0011097739103" → "L0011097739-103"). 형식이 다르면 정리만 하고 그대로 둔다(검사는 validateProfile). */
export function normalizeLtcNumber(raw: string): string {
  const s = raw.replace(/\s+/g, '').toUpperCase()
  const m = /^L([0-9]{10})-?([0-9]{3})$/.exec(s)
  return m ? `L${m[1]}-${m[2]}` : s
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** 인적사항 입력 검사. 문제가 없으면 null. requireName이면 이름이 필수(등록). */
export function validateProfile(p: Partial<RecipientProfile>, requireName: boolean): string | null {
  const name = (p.fullName ?? '').trim()
  if (requireName && !name) return '수급자 이름을 입력해 주세요.'
  if (name.length > DISPLAY_NAME_MAX) return `이름은 ${DISPLAY_NAME_MAX}자 이내로 입력해 주세요.`
  const ltc = normalizeLtcNumber(p.ltcNumber ?? '')
  if (ltc && !LTC_NUMBER_PATTERN.test(ltc)) return '장기요양인정번호 형식이 올바르지 않습니다(예: L0011097739-103).'
  if (p.ltcGrade && !(LTC_GRADES as readonly string[]).includes(p.ltcGrade)) return '장기요양등급 값이 올바르지 않습니다.'
  for (const [label, v] of [['생년월일', p.birthDate], ['인정 유효기간 시작일', p.ltcValidFrom], ['인정 유효기간 종료일', p.ltcValidTo]] as const) {
    if (v && !validDate(v)) return `${label} 형식이 올바르지 않습니다(예: 1956-02-24).`
  }
  if (p.ltcValidFrom && p.ltcValidTo && p.ltcValidFrom > p.ltcValidTo) return '인정 유효기간의 시작일이 종료일보다 늦습니다.'
  if ((p.address ?? '').length > ADDRESS_MAX) return `주소는 ${ADDRESS_MAX}자 이내로 입력해 주세요.`
  const phone = (p.phone ?? '').trim()
  if (phone && (phone.length > 20 || !/^[0-9+() -]+$/.test(phone))) return '전화번호는 숫자와 하이픈만 20자 이내로 입력해 주세요.'
  return null
}

/** 화면 입력을 저장 모양으로 정리한다(앞뒤 공백 제거, 인정번호 정규화). */
export function cleanProfile(p: Partial<RecipientProfile>): RecipientProfile {
  const t = (v: string | undefined) => (v ?? '').trim()
  return {
    fullName: t(p.fullName),
    birthDate: t(p.birthDate),
    ltcNumber: normalizeLtcNumber(t(p.ltcNumber)),
    ltcGrade: t(p.ltcGrade),
    ltcValidFrom: t(p.ltcValidFrom),
    ltcValidTo: t(p.ltcValidTo),
    address: t(p.address),
    phone: t(p.phone),
  }
}

/** 인정 유효기간 상태. 만료가 가까운 수급자를 목록에서 바로 알아보기 위한 값(갱신신청은 만료 90일 전~30일 전). */
export type LtcValidity = 'none' | 'valid' | 'expiring' | 'expired'
export function ltcValidity(validTo: string, today: string): LtcValidity {
  if (!validTo) return 'none'
  if (validTo < today) return 'expired'
  const days = Math.round((Date.parse(`${validTo}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  return days <= 90 ? 'expiring' : 'valid'
}
