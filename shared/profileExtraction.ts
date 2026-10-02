/** ERP 3단계 — 서류에서 수급자 인적사항을 AI가 읽어 채우는 규칙. 서버(api/_lib/profileExtractionAi.ts)와 화면·데모가 같은 함수를 쓴다.
 *
 * 원칙
 * - AI가 읽은 값은 "제안"일 뿐이다. 칸에 채우기만 하고, 관리자가 확인해 저장해야 반영된다(자동 저장 없음).
 * - 값은 칸 하나씩 검증한다. 형식이 틀린 값은 채우지 않고 사유와 함께 따로 알린다(그럴듯하게 고쳐 넣지 않는다).
 * - 서류마다 값이 다르면 어느 쪽도 고르지 않고 충돌로 보여 준다(다른 사람의 서류가 섞였을 수 있다).
 * - 관리자가 이미 입력한 칸은 덮어쓰지 않는다. 다르면 "입력한 값과 다름"으로만 알린다. */
import { LTC_GRADES, cleanProfile, validateProfile, type RecipientProfile } from './recipientAdmin.js'

export const DOC_KINDS = ['ltc_certificate', 'ltc_use_plan', 'care_plan', 'welfare_equipment', 'guidance', 'needs_assessment', 'other'] as const
export type DocKind = (typeof DOC_KINDS)[number]
export const DOC_KIND_LABELS: Record<DocKind, string> = {
  ltc_certificate: '장기요양인정서',
  ltc_use_plan: '개인별장기요양이용계획서',
  care_plan: '급여제공계획서',
  welfare_equipment: '복지용구 급여확인서',
  guidance: '안내문(인정번호·주소 면)',
  needs_assessment: '욕구조사 기록',
  other: '기타 서류',
}

export type ProfileField = keyof RecipientProfile
export const FIELD_LABELS: Record<ProfileField, string> = {
  fullName: '이름',
  birthDate: '생년월일',
  ltcNumber: '장기요양인정번호',
  ltcGrade: '장기요양등급',
  ltcValidFrom: '인정 유효기간 시작',
  ltcValidTo: '인정 유효기간 종료',
  address: '주소',
  phone: '전화번호',
}
export const PROFILE_FIELDS = Object.keys(FIELD_LABELS) as ProfileField[]
/** 서로 다르면 다른 사람의 서류가 섞였을 가능성이 있는 항목. */
const IDENTITY_FIELDS: ProfileField[] = ['fullName', 'ltcNumber', 'birthDate']

export interface RejectedField {
  field: ProfileField
  label: string
  /** 서류에 적혀 있다고 AI가 읽은 값(관리자가 서류와 직접 대조할 수 있게 보여 준다). */
  value: string
  reason: string
}

/** 서류 한 장을 읽은 결과(서버 응답 모양). */
export interface FileExtraction {
  fileName: string
  docKind: DocKind
  fields: Partial<RecipientProfile>
  rejected: RejectedField[]
  /** AI 호출에 쓴 토큰(비용·손익 계산용). 데모는 null. */
  usage: { promptTokens: number; outputTokens: number } | null
  /** 실제 AI를 호출하지 않은 가상 결과(데모). */
  simulated?: boolean
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

/** "2025.02.25" · "2025-2-5" · "2025년 2월 25일" → "2025-02-25". 읽을 수 없으면 원문 그대로(검증에서 걸러진다). */
export function normalizeDateText(raw: string): string {
  const m = /^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?$/.exec(raw.trim())
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : raw.trim()
}

/** "4" · "4등급" · "인지지원" → 표준 등급 값. 모르면 원문 그대로(검증에서 걸러진다). */
export function normalizeGradeText(raw: string): string {
  const t = raw.replace(/\s+/g, '')
  if (!t) return ''
  if (t.includes('인지지원')) return '인지지원등급'
  const m = /^([1-5])(등급)?$/.exec(t)
  return m ? `${m[1]}등급` : raw.trim()
}

const isDocKind = (v: unknown): v is DocKind => (DOC_KINDS as readonly string[]).includes(String(v))

/** AI 응답(검증 전)을 칸 단위로 검증한다. 통과한 값만 fields에, 나머지는 사유와 함께 rejected에 담는다. */
export function sanitizeExtraction(raw: unknown, fileName: string, usage: FileExtraction['usage'] = null): FileExtraction {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const fields: Partial<RecipientProfile> = {}
  const rejected: RejectedField[] = []
  for (const field of PROFILE_FIELDS) {
    let value = asText(obj[field])
    if (!value) continue
    if (field === 'birthDate' || field === 'ltcValidFrom' || field === 'ltcValidTo') value = normalizeDateText(value)
    if (field === 'ltcGrade') value = normalizeGradeText(value)
    const cleaned = cleanProfile({ [field]: value })
    const error = validateProfile({ [field]: cleaned[field] }, false)
    if (error) rejected.push({ field, label: FIELD_LABELS[field], value, reason: error })
    else if (cleaned[field]) fields[field] = cleaned[field]
  }
  // 유효기간 선후 관계는 두 칸을 함께 볼 때만 알 수 있다.
  if (fields.ltcValidFrom && fields.ltcValidTo && fields.ltcValidFrom > fields.ltcValidTo) {
    for (const field of ['ltcValidFrom', 'ltcValidTo'] as const) {
      rejected.push({ field, label: FIELD_LABELS[field], value: fields[field] ?? '', reason: '인정 유효기간의 시작일이 종료일보다 늦습니다.' })
      delete fields[field]
    }
  }
  return { fileName, docKind: isDocKind(obj.docKind) ? obj.docKind : 'other', fields, rejected, usage }
}

export interface ExtractionConflict {
  field: ProfileField
  label: string
  /** 다른 사람의 서류가 섞였을 수 있는 항목(이름·인정번호·생년월일). */
  identity: boolean
  values: Array<{ value: string; source: string }>
}

export interface MergedExtraction {
  /** 충돌이 없는 칸의 제안 값. 충돌한 칸은 비워 둔다. */
  fields: Partial<RecipientProfile>
  /** 칸마다 어느 서류에서 읽었는지(관리자가 대조할 서류). */
  sources: Partial<Record<ProfileField, string>>
  conflicts: ExtractionConflict[]
  rejected: Array<RejectedField & { source: string }>
}

const sourceName = (e: FileExtraction) => `${DOC_KIND_LABELS[e.docKind]} (${e.fileName})`

/** 여러 서류의 결과를 합친다. 같은 값이면 출처만 늘리고, 다른 값이면 충돌로 남긴다. */
export function mergeExtractions(list: FileExtraction[]): MergedExtraction {
  const seen = new Map<ProfileField, Array<{ value: string; source: string }>>()
  for (const e of list) {
    for (const field of PROFILE_FIELDS) {
      const value = e.fields[field]
      if (!value) continue
      seen.set(field, [...(seen.get(field) ?? []), { value, source: sourceName(e) }])
    }
  }
  const fields: Partial<RecipientProfile> = {}
  const sources: Partial<Record<ProfileField, string>> = {}
  const conflicts: ExtractionConflict[] = []
  for (const field of PROFILE_FIELDS) {
    const entries = seen.get(field)
    if (!entries) continue
    const distinct = [...new Set(entries.map((x) => x.value))]
    if (distinct.length === 1) {
      fields[field] = distinct[0]
      sources[field] = entries.map((x) => x.source).join(' · ')
    } else {
      conflicts.push({ field, label: FIELD_LABELS[field], identity: IDENTITY_FIELDS.includes(field), values: entries })
    }
  }
  const rejected = list.flatMap((e) => e.rejected.map((r) => ({ ...r, source: sourceName(e) })))
  return { fields, sources, conflicts, rejected }
}

export interface AppliedExtraction {
  profile: RecipientProfile
  /** AI가 채운 칸(화면에서 "AI가 채움 · 확인 필요"로 표시). */
  filled: ProfileField[]
  /** 관리자가 이미 입력한 값과 달라 건드리지 않은 칸. */
  keptDifferent: Array<{ field: ProfileField; label: string; entered: string; suggested: string }>
}

/** 제안을 현재 입력에 반영한다. 비어 있는 칸만 채우고, 입력된 값은 그대로 둔다. */
export function applyExtraction(current: RecipientProfile, merged: MergedExtraction): AppliedExtraction {
  const profile = { ...current }
  const filled: ProfileField[] = []
  const keptDifferent: AppliedExtraction['keptDifferent'] = []
  for (const field of PROFILE_FIELDS) {
    const suggested = merged.fields[field]
    if (!suggested) continue
    const entered = current[field].trim()
    if (!entered) {
      profile[field] = suggested
      filled.push(field)
    } else if (entered !== suggested) {
      keptDifferent.push({ field, label: FIELD_LABELS[field], entered, suggested })
    }
  }
  return { profile, filled, keptDifferent }
}

export const LTC_GRADE_HINT = LTC_GRADES.join(' · ')

/** 서류 파일 종류에 따른 저장 문서유형(4단계 원본 보관) 연결. */
export function storedDocType(kind: DocKind): 'ltc_use_plan' | 'care_plan' | 'other' {
  if (kind === 'ltc_use_plan') return 'ltc_use_plan'
  if (kind === 'care_plan') return 'care_plan'
  return 'other'
}
