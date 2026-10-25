import { assignmentId } from './centerAssignments.js'
import { isCenterDate } from './centerOperations.js'
// Observed EZcare labels; these are not eligibility or current statutory rate determinations.
export const patientRateLabels = { '01': '일반 15%', '02': '의료 7.5%', '03': '기초 0%', '04': '감경 7.5%', '05': '감경 60% (6%)', '06': '감경 40% (9%)', '07': '의료 6%' } as const
export interface PatientRate { id: string; effectiveDate: string; rateCode: keyof typeof patientRateLabels; note: string }
export interface StoredPatientRate extends PatientRate { archived: boolean }
export interface PatientRatesState { patientId: string; version: number; entries: StoredPatientRate[] }
export type PatientRateMutation = { requestId: string; patientId: string; expectedVersion: number } & ({ action: 'save'; rate: PatientRate } | { action: 'archive'; id: string })
export interface PatientRateResult { state: PatientRatesState }
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('부담률 이력 형식 오류'); return v as Record<string, unknown> }
function version(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) >= 2147483647) throw new Error('부담률 이력 버전 오류'); return Number(v) }
export function parsePatientRate(value: unknown): PatientRate {
 const v = object(value)
 if (Object.keys(v).some(k => !['id', 'effectiveDate', 'rateCode', 'note'].includes(k)) || typeof v.effectiveDate !== 'string' || !isCenterDate(v.effectiveDate) || typeof v.rateCode !== 'string' || !Object.hasOwn(patientRateLabels, v.rateCode) || typeof v.note !== 'string' || v.note.length > 2000 || v.note.includes('\0')) throw new Error('부담률 코드·적용일·비고를 확인하세요.')
 return { id: assignmentId(v.id), effectiveDate: v.effectiveDate, rateCode: v.rateCode as PatientRate['rateCode'], note: v.note }
}
export function parsePatientRatesState(value: unknown): PatientRatesState {
 const v = object(value)
 if (Object.keys(v).some(k => !['patientId', 'version', 'entries'].includes(k)) || !Array.isArray(v.entries) || v.entries.length > 500) throw new Error('부담률 이력 전체 조회 실패')
 const entries = v.entries.map(raw => { const r = object(raw); if (typeof r.archived !== 'boolean') throw new Error('부담률 보관 상태 오류'); const { archived, ...fields } = r; return { ...parsePatientRate(fields), archived } })
 const n = version(v.version), dates = entries.filter(e => !e.archived).map(e => e.effectiveDate)
 if (new Set(entries.map(e => e.id)).size !== entries.length || new Set(dates).size !== dates.length || (n === 0 && entries.length)) throw new Error('부담률 이력 연결 오류')
 return { patientId: assignmentId(v.patientId), version: n, entries }
}
export function parsePatientRateMutation(value: unknown): PatientRateMutation {
 const v = object(value), base = { requestId: assignmentId(v.requestId), patientId: assignmentId(v.patientId), expectedVersion: version(v.expectedVersion) }
 if (Object.keys(v).some(k => !['requestId', 'patientId', 'expectedVersion', 'action', ...(v.action === 'save' ? ['rate'] : ['id'])].includes(k))) throw new Error('부담률 요청 필드 오류')
 if (v.action === 'save') return { ...base, action: 'save', rate: parsePatientRate(v.rate) }
 if (v.action === 'archive') return { ...base, action: 'archive', id: assignmentId(v.id) }
 throw new Error('부담률 처리 구분 오류')
}
export function checkedPatientRateResult(value: unknown, input: PatientRateMutation): PatientRateResult {
 const v = object(value), state = parsePatientRatesState(v.state)
 if (Object.keys(v).some(k => k !== 'state') || state.patientId !== input.patientId || state.version !== input.expectedVersion + 1) throw new Error('부담률 저장 응답 불일치 · 같은 요청으로 재시도하세요.')
 const entry = state.entries.find(e => e.id === (input.action === 'save' ? input.rate.id : input.id))
 if (!entry || entry.archived !== (input.action === 'archive')) throw new Error('부담률 저장 상태 불일치')
 if (input.action === 'save') { const { archived: _a, ...fields } = entry; if (JSON.stringify(fields) !== JSON.stringify(input.rate)) throw new Error('부담률 저장 내용 불일치') }
 return { state }
}
export function patientRateAt(state: PatientRatesState, day: string): StoredPatientRate | null {
 if (!isCenterDate(day)) throw new Error('조회 기준일을 확인하세요.')
 return state.entries.filter(e => !e.archived && e.effectiveDate <= day).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null
}
