import { useEffect, useMemo, useRef, useState } from 'react'
import type { CenterAssignment } from '../../shared/centerAssignments'
import type { Person } from './model'
import { createDemoAssignmentsRepository, serverAssignmentsRepository } from './assignmentsRepo'

export function CenterPatientAssignments({ patient, people, preview, startVisit }: { patient: Person; people: Person[]; preview: boolean; startVisit(assignment: CenterAssignment): void }) {
  const repository = useMemo(() => preview ? createDemoAssignmentsRepository(window.localStorage) : serverAssignmentsRepository, [preview])
  const [assignment, setAssignment] = useState<CenterAssignment | null>(null)
  const [draft, setDraft] = useState<string[]>([])
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('')
  const epoch = useRef<object>({})
  const locked = useRef(false), retry = useRef<{ signature: string; requestId: string } | null>(null)
  useEffect(() => {
    const run = {}; epoch.current = run
    repository.load(patient.id).then(result => { if (run === epoch.current) { setAssignment(result); setDraft(result.workerIds) } }).catch(failure => { if (run === epoch.current) setError(failure instanceof Error ? failure.message : '담당 배정을 조회하지 못했습니다.') }).finally(() => { if (run === epoch.current) setLoading(false) })
    return () => { epoch.current = {} }
  }, [repository, patient.id])
  async function reload() {
    if (locked.current) return
    const run = {}; epoch.current = run
    setLoading(true); setError(''); setNotice('')
    try { const result = await repository.load(patient.id); if (run === epoch.current) { setAssignment(result); setDraft(result.workerIds); retry.current = null } }
    catch (failure) { if (run === epoch.current) setError(failure instanceof Error ? failure.message : '다시 조회하지 못했습니다.') }
    finally { if (run === epoch.current) setLoading(false) }
  }
  async function save(next: string[]) {
    if (!assignment || loading || locked.current) return
    locked.current = true
    const run = epoch.current, fields = { patientId: patient.id, workerIds: next, expectedVersion: assignment.version }, signature = JSON.stringify(fields)
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() }
    setDraft(next); setBusy(true); setError(''); setNotice('')
    try {
      const result = await repository.save({ ...fields, requestId: retry.current.requestId })
      if (result.version !== fields.expectedVersion + 1 || JSON.stringify(result.workerIds) !== JSON.stringify(next)) throw new Error('배정 저장 결과가 다릅니다. 다시 조회하세요.')
      if (run === epoch.current) { setAssignment(result); setDraft(result.workerIds); retry.current = null; setNotice(preview ? '가상 담당 배정을 저장했습니다.' : '담당 배정을 저장했습니다.') }
    } catch (failure) { if (run === epoch.current) setError(failure instanceof Error ? failure.message : '배정을 저장하지 못했습니다. 선택은 유지됩니다.') }
    finally { locked.current = false; if (run === epoch.current) setBusy(false) }
  }
  const dirty = Boolean(assignment && JSON.stringify(assignment.workerIds) !== JSON.stringify(draft))
  const workers = people.filter(p => p.kind === 'worker')
  return <section aria-label="수급자 담당 배정"><h3>{patient.name} 담당 직원</h3>
    <p>체크를 선택하거나 해제하면 담당 배정을 저장합니다. 방문일정별 실제 제공자 지정은 별도입니다.</p>
    <label>담당 직원 검색<input aria-label="담당 직원 검색" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {loading ? <p role="status">담당 배정 조회 중…</p> : <>
      {assignment && <p>저장된 담당 {assignment.workerIds.length}명 · v{assignment.version}{dirty ? ' · 저장되지 않은 선택 있음' : ''}</p>}
      <div className="cd-assignment-workers">{workers.filter(worker => worker.name.includes(query.trim())).map(worker => <label key={worker.id}><input type="checkbox" aria-label={`${worker.name} 담당 배정`} checked={draft.includes(worker.id)} disabled={!assignment || busy || loading} onChange={event => void save(event.target.checked ? [...draft, worker.id] : draft.filter(id => id !== worker.id))} />{worker.name}{assignment?.workerIds.includes(worker.id) ? ' · 담당' : ''}</label>)}</div>
      {!workers.length && <p>직원관리에서 직원을 등록한 뒤 배정할 수 있습니다.</p>}
    </>}
    {error && <p role="alert" className="cd-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {busy && <p role="status">담당 배정 저장 중…</p>}
    <div className="cd-visit-actions"><button type="button" disabled={busy || loading} onClick={() => void reload()}>다시 조회 · 선택 초기화</button>
      {dirty && <button type="button" disabled={busy || loading} onClick={() => void save(draft)}>선택 내용 다시 저장</button>}
      <button type="button" disabled={!assignment || !assignment.workerIds.length || dirty || busy || loading || Boolean(error)} onClick={() => assignment && startVisit(assignment)}>배정 직원으로 방문일정 추가</button>
    </div>
  </section>
}
