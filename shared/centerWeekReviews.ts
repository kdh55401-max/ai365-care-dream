import { assignmentId } from './centerAssignments.js'
import { STATE_CHANGE_CHECKS, type StateChangeCheckKey, type StateChangeWeek } from './centerStateChange.js'

// 센터장이 상태변화기록지의 한 주를 읽고 남기는 확인. 기록은 쌓기만 하고(수정·삭제 없음) 같은 주의 가장 나중 확인이 유효하다.
export const WEEK_REVIEW_VALUES = ['same_as_usual', 'changed', 'not_observed'] as const
export type WeekReviewValue = typeof WEEK_REVIEW_VALUES[number]
export const WEEK_REVIEW_LABELS: Record<WeekReviewValue, string> = { same_as_usual: '평소와 같음', changed: '변화 있음', not_observed: '확인 못함' }
export interface WeekReviewInput { id: string; weekStart: string; value: WeekReviewValue; areas: StateChangeCheckKey[]; note: string; digest: string; documentId: string | null; batch: boolean }
export interface StoredWeekReview extends WeekReviewInput { reviewer: string; at: string }
export interface PatientWeekReviews { patientId: string; version: number; entries: StoredWeekReview[] }
export interface WeekReviewsMonth { month: string; patients: PatientWeekReviews[] }
export interface WeekReviewMutation { requestId: string; patientId: string; expectedVersion: number; entries: WeekReviewInput[] }
export interface WeekReviewSaved { patientId: string; version: number; saved: StoredWeekReview[] }

const AREA_KEYS = STATE_CHANGE_CHECKS.map(c => c.key) as string[]
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('주별 확인 형식 오류'); return v as Record<string, unknown> }
function version(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) >= 2147483647) throw new Error('주별 확인 버전 오류'); return Number(v) }
function dateKey(v: unknown): string { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v || v < '2000-01-01' || v > '2199-12-31') throw new Error('확인할 주의 날짜 오류'); return v }
const INPUT_KEYS = ['id', 'weekStart', 'value', 'areas', 'note', 'digest', 'documentId', 'batch']

export function parseWeekReviewInput(value: unknown): WeekReviewInput {
  const v = object(value)
  if (Object.keys(v).some(k => !INPUT_KEYS.includes(k)) || INPUT_KEYS.some(k => !(k in v))) throw new Error('주별 확인 항목 오류')
  if (!WEEK_REVIEW_VALUES.includes(v.value as WeekReviewValue)) throw new Error('확인 값을 고르세요.')
  const areas = v.areas, value_ = v.value as WeekReviewValue
  if (!Array.isArray(areas) || areas.length > 6 || new Set(areas).size !== areas.length || areas.some(a => typeof a !== 'string' || !AREA_KEYS.includes(a)) || (value_ !== 'changed' && areas.length)) throw new Error('변화 영역은 "변화 있음"일 때만 고를 수 있습니다.')
  if (typeof v.note !== 'string' || v.note.length > 500 || v.note.includes('\0')) throw new Error('메모는 500자 이내로 입력하세요.')
  if (typeof v.digest !== 'string' || (v.digest !== '' && !/^[0-9a-f]{64}$/i.test(v.digest))) throw new Error('확인한 기록의 지문 오류')
  if (v.digest === '' && value_ !== 'not_observed') throw new Error('기록이 없는 주는 "확인 못함"만 남길 수 있습니다.')
  if (v.documentId !== null && typeof v.documentId !== 'string') throw new Error('문서 연결 오류')
  if (typeof v.batch !== 'boolean') throw new Error('일괄 표시 오류')
  return { id: assignmentId(v.id), weekStart: dateKey(v.weekStart), value: value_, areas: areas as StateChangeCheckKey[], note: v.note, digest: v.digest, documentId: v.documentId === null ? null : assignmentId(v.documentId), batch: v.batch }
}
export function parseWeekReviewMutation(value: unknown): WeekReviewMutation {
  const v = object(value)
  if (Object.keys(v).some(k => !['requestId', 'patientId', 'expectedVersion', 'entries'].includes(k)) || !Array.isArray(v.entries) || v.entries.length < 1 || v.entries.length > 6) throw new Error('주별 확인 요청 오류')
  const entries = v.entries.map(parseWeekReviewInput)
  if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('주별 확인 번호가 겹칩니다.')
  return { requestId: assignmentId(v.requestId), patientId: assignmentId(v.patientId), expectedVersion: version(v.expectedVersion), entries }
}
function storedEntry(raw: unknown): StoredWeekReview {
  const r = object(raw), { reviewer, at, ...rest } = r
  if (typeof reviewer !== 'string' || !reviewer.trim() || reviewer.length > 200 || reviewer.includes('\0') || typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at)) throw new Error('주별 확인 작성자·시각 오류')
  return { ...parseWeekReviewInput(rest), reviewer, at }
}
export function parseWeekReviewsMonth(value: unknown): WeekReviewsMonth {
  const v = object(value)
  if (Object.keys(v).some(k => !['month', 'patients'].includes(k)) || typeof v.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month) || !Array.isArray(v.patients) || v.patients.length > 5000) throw new Error('주별 확인 조회 실패')
  const patients = v.patients.map(raw => { const p = object(raw); if (Object.keys(p).some(k => !['patientId', 'version', 'entries'].includes(k)) || !Array.isArray(p.entries) || p.entries.length > 2000) throw new Error('주별 확인 조회 실패'); return { patientId: assignmentId(p.patientId), version: version(p.version), entries: p.entries.map(storedEntry) } })
  if (new Set(patients.map(p => p.patientId)).size !== patients.length) throw new Error('주별 확인 대상이 겹칩니다.')
  return { month: v.month, patients }
}
export function checkedWeekReviewSaved(value: unknown, input: WeekReviewMutation): WeekReviewSaved {
  const v = object(value)
  if (Object.keys(v).some(k => !['patientId', 'version', 'saved'].includes(k)) || assignmentId(v.patientId) !== input.patientId || version(v.version) !== input.expectedVersion + 1 || !Array.isArray(v.saved)) throw new Error('주별 확인 저장 응답 불일치 · 같은 요청으로 재시도하세요.')
  const saved = v.saved.map(storedEntry)
  if (saved.length !== input.entries.length || saved.some((s, i) => { const { reviewer: _r, at: _a, ...fields } = s; return JSON.stringify(fields) !== JSON.stringify(input.entries[i]) })) throw new Error('주별 확인 저장 내용 불일치')
  return { patientId: input.patientId, version: input.expectedVersion + 1, saved }
}

/** 같은 주를 여러 번 확인했으면 가장 나중 것이 유효하다(기록은 저장 순서대로 쌓인다). */
export function latestWeekReviews(entries: readonly StoredWeekReview[]): Map<string, StoredWeekReview> { const map = new Map<string, StoredWeekReview>(); for (const e of entries) map.set(e.weekStart, e); return map }

/** 확인할 때의 기록 내용을 나타내는 지문. 기록의 날짜·체크·특이사항·급여제공결과가 바뀌면 달라진다. 기록이 없으면 ''. */
export function weekContentDigest(weeks: readonly StateChangeWeek[]): string {
  if (!weeks.length) return ''
  const canonical = [...weeks].sort((a, b) => a.date.localeCompare(b.date)).map(w => [w.date, STATE_CHANGE_CHECKS.filter(c => w.checks[c.key]).map(c => c.key), w.remarks.trim(), w.result.trim()])
  return sha256Hex(JSON.stringify(canonical))
}

// 동기 SHA-256(브라우저·서버 공용). 표준 구현이며 아래 시험에서 알려진 값과 맞춘다.
const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text), length = data.length, padded = new Uint8Array(((length + 9 + 63) >> 6) << 6)
  padded.set(data); padded[length] = 0x80
  const view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32)); view.setUint32(padded.length - 4, (length * 8) >>> 0)
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0 }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0, t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('')
}
