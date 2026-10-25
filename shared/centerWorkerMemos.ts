import { assignmentId } from './centerAssignments.js'
import { isCenterDate } from './centerOperations.js'
export interface WorkerMemo { id: string; date: string; text: string }
export interface StoredWorkerMemo extends WorkerMemo { archived: boolean; writer: string }
export interface WorkerMemosState { workerId: string; version: number; entries: StoredWorkerMemo[] }
export type WorkerMemoMutation = { requestId: string; workerId: string; expectedVersion: number } & ({ action: 'save'; memo: WorkerMemo } | { action: 'archive'; id: string })
export interface WorkerMemoResult { state: WorkerMemosState }
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('관리기록 형식 오류'); return v as Record<string, unknown> }
function version(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) >= 2147483647) throw new Error('관리기록 버전 오류'); return Number(v) }
export function parseWorkerMemo(value: unknown): WorkerMemo {
 const v = object(value)
 if (Object.keys(v).some(k => !['id', 'date', 'text'].includes(k)) || typeof v.date !== 'string' || !isCenterDate(v.date) || typeof v.text !== 'string' || !v.text.trim() || v.text.length > 4000 || v.text.includes('\0')) throw new Error('관리기록 날짜와 내용을 확인하세요.')
 return { id: assignmentId(v.id), date: v.date, text: v.text }

}
export function parseWorkerMemosState(value: unknown): WorkerMemosState {
 const v = object(value)
 if (Object.keys(v).some(k => !['workerId', 'version', 'entries'].includes(k)) || !Array.isArray(v.entries) || v.entries.length > 500) throw new Error('관리기록 전체 조회 실패')
 const entries = v.entries.map(raw => { const r = object(raw); if (typeof r.archived !== 'boolean') throw new Error('관리기록 보관 상태 오류'); if (typeof r.writer !== 'string' || !r.writer.trim() || r.writer.length > 200 || r.writer.includes('\0')) throw new Error('관리기록 작성자 오류'); const { archived, writer, ...fields } = r; return { ...parseWorkerMemo(fields), archived, writer } })
 const n = version(v.version)
 if (new Set(entries.map(e => e.id)).size !== entries.length || (n === 0 && entries.length)) throw new Error('관리기록 연결 오류')
 return { workerId: assignmentId(v.workerId), version: n, entries }
}
export function parseWorkerMemoMutation(value: unknown): WorkerMemoMutation {
 const v = object(value), base = { requestId: assignmentId(v.requestId), workerId: assignmentId(v.workerId), expectedVersion: version(v.expectedVersion) }
 if (Object.keys(v).some(k => !['requestId', 'workerId', 'expectedVersion', 'action', ...(v.action === 'save' ? ['memo'] : ['id'])].includes(k))) throw new Error('관리기록 요청 필드 오류')
 if (v.action === 'save') return { ...base, action: 'save', memo: parseWorkerMemo(v.memo) }
 if (v.action === 'archive') return { ...base, action: 'archive', id: assignmentId(v.id) }
 throw new Error('관리기록 처리 구분 오류')
}
export function checkedWorkerMemoResult(value: unknown, input: WorkerMemoMutation): WorkerMemoResult {
 const v = object(value), state = parseWorkerMemosState(v.state)
 if (Object.keys(v).some(k => k !== 'state') || state.workerId !== input.workerId || state.version !== input.expectedVersion + 1) throw new Error('관리기록 저장 응답 불일치 · 같은 요청으로 재시도하세요.')
 const entry = state.entries.find(e => e.id === (input.action === 'save' ? input.memo.id : input.id))
 if (!entry || entry.archived !== (input.action === 'archive')) throw new Error('관리기록 저장 상태 불일치')
 if (input.action === 'save') { const { archived: _a, writer: _w, ...fields } = entry; if (JSON.stringify(fields) !== JSON.stringify(input.memo)) throw new Error('관리기록 저장 내용 불일치') }
 return { state }
}
