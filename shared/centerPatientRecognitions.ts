import { assignmentId } from './centerAssignments.js'
import { isCenterDate, parseCenterOperationMutation, type CenterPerson } from './centerOperations.js'
export interface PatientRecognition { id: string; grade: string; number: string; sequence: string; periodStart: string; periodEnd: string; note: string }
export interface StoredPatientRecognition extends PatientRecognition { archived: boolean }
export interface PatientRecognitionsState { patientId: string; version: number; activeId: string | null; entries: StoredPatientRecognition[] }
interface Base { requestId: string; patientId: string; expectedVersion: number }
export type PatientRecognitionMutation = Base & ({ action: 'save'; recognition: PatientRecognition } | { action: 'archive'; id: string } | { action: 'apply'; id: string; expectedPersonVersion: number })
export interface PatientRecognitionResult { state: PatientRecognitionsState; person?: CenterPerson }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('등급·인정이력 형식 오류'); return value as Record<string, unknown> }
function version(value: unknown, minimum = 0): number { if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error('등급·인정이력 버전을 확인하세요.'); return Number(value) }
export function parsePatientRecognition(value: unknown): PatientRecognition {
  const v = object(value)
  if (Object.keys(v).some(k => !['id', 'grade', 'number', 'sequence', 'periodStart', 'periodEnd', 'note'].includes(k))) throw new Error('등급·인정이력 입력 항목 오류')
  for (const field of ['periodStart', 'periodEnd']) if (typeof v[field] !== 'string' || !isCenterDate(v[field] as string)) throw new Error('등급·인정일·등급·인정기간을 정확한 날짜로 입력하세요.')
  if (String(v.periodStart) > String(v.periodEnd)) throw new Error('등급·인정기간 종료일은 시작일보다 빠를 수 없습니다.')
  if (typeof v.grade !== 'string' || !v.grade.trim() || v.grade.trim().length > 100 || v.grade.includes('\0') || typeof v.number !== 'string' || !/^L[0-9]{1,20}$/.test(v.number) || typeof v.sequence !== 'string' || !/^[0-9]{1,10}$/.test(v.sequence) || typeof v.note !== 'string' || v.note.length > 2000 || v.note.includes('\0')) throw new Error('등급·인정번호·확장값·비고를 확인하세요.')
  return { id: assignmentId(v.id), grade: v.grade.trim(), number: v.number, sequence: v.sequence, periodStart: String(v.periodStart), periodEnd: String(v.periodEnd), note: v.note }
}
export function parsePatientRecognitionsState(value: unknown): PatientRecognitionsState {
  const v = object(value)
  if (!Array.isArray(v.entries) || v.entries.length > 500) throw new Error('등급·인정이력 전체를 조회하지 못했습니다.')
  const entries = v.entries.map(raw => { const r = object(raw); if (typeof r.archived !== 'boolean') throw new Error('등급·인정이력 보관 상태 오류'); const { archived, ...fields } = r; return { ...parsePatientRecognition(fields), archived } })
  const activeId = v.activeId === null ? null : assignmentId(v.activeId), n = version(v.version)
  if (new Set(entries.map(r => r.id)).size !== entries.length || (activeId !== null && !entries.some(r => r.id === activeId && !r.archived)) || (n === 0 && (entries.length || activeId))) throw new Error('등급·인정이력 연결 상태 오류')
  return { patientId: assignmentId(v.patientId), version: n, activeId, entries }
}
export function parsePatientRecognitionMutation(value: unknown): PatientRecognitionMutation {
  const v = object(value), base = { requestId: assignmentId(v.requestId), patientId: assignmentId(v.patientId), expectedVersion: version(v.expectedVersion) }
  const allowed = ['requestId', 'patientId', 'expectedVersion', 'action', ...(v.action === 'save' ? ['recognition'] : v.action === 'apply' ? ['id', 'expectedPersonVersion'] : ['id'])]
  if (Object.keys(v).some(k => !allowed.includes(k))) throw new Error('등급·인정이력 요청 필드 오류')
  if (v.action === 'save') return { ...base, action: 'save', recognition: parsePatientRecognition(v.recognition) }
  if (v.action === 'archive') return { ...base, action: 'archive', id: assignmentId(v.id) }
  if (v.action === 'apply') return { ...base, action: 'apply', id: assignmentId(v.id), expectedPersonVersion: version(v.expectedPersonVersion, 1) }
  throw new Error('등급·인정이력 처리 구분 오류')
}
export function checkedPatientRecognitionResult(value: unknown, mutation: PatientRecognitionMutation): PatientRecognitionResult {
  const v = object(value), state = parsePatientRecognitionsState(v.state)
  if (state.patientId !== mutation.patientId || state.version !== mutation.expectedVersion + 1) throw new Error('등급·인정이력 저장 응답 불일치 · 같은 요청으로 다시 시도하세요.')
  const id = mutation.action === 'save' ? mutation.recognition.id : mutation.id, entry = state.entries.find(r => r.id === id)
  if (!entry || (mutation.action === 'archive' ? !entry.archived || state.activeId === id : entry.archived)) throw new Error('등급·인정이력 저장 상태 불일치')
  if (mutation.action === 'save') { const { archived: _archived, ...fields } = entry; if (JSON.stringify(fields) !== JSON.stringify(mutation.recognition)) throw new Error('등급·인정이력 저장 내용 불일치') }
  if (mutation.action !== 'apply') { if (v.person !== undefined) throw new Error('예상하지 않은 기본정보 변경'); return { state } }
  const person = object(v.person)
  parseCenterOperationMutation({ action: 'upsertPerson', person, requestId: mutation.requestId, expectedVersion: mutation.expectedPersonVersion })
  if (state.activeId !== id || person.id !== state.patientId || person.kind !== 'patient' || person.version !== mutation.expectedPersonVersion + 1 || person.archived !== false || person.category !== entry.grade) throw new Error('등급·인정 적용 응답 불일치 · 기본정보를 다시 조회하세요.')
  return { state, person: person as unknown as CenterPerson }
}
