import { useEffect, useMemo, useRef, useState } from 'react'
import { monthScheduleSnapshot, type MonthScheduleState } from '../../shared/centerMonthSchedule'
import { visitWorkerIds, type CenterOperationSnapshot } from '../../shared/centerOperations'
import { createDemoOperationsRepository, serverOperationsRepository } from './operationsRepo'
import { createDemoMonthlyScheduleRepository, serverMonthlyScheduleRepository } from './monthlyScheduleRepo'
export function CenterMonthSchedule({ month, preview, onSaved }: { month: string; preview: boolean; onSaved(): void }) {
  const repository = useMemo(() => preview ? createDemoMonthlyScheduleRepository(window.localStorage) : serverMonthlyScheduleRepository, [preview])
  const operations = useMemo(() => preview ? createDemoOperationsRepository(window.localStorage) : serverOperationsRepository, [preview])
  const [state, setState] = useState<MonthScheduleState | null>(null), [data, setData] = useState<CenterOperationSnapshot | null>(null)
  const [shown, setShown] = useState(100)
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [checked, setChecked] = useState(false), [phrase, setPhrase] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const alive = useRef(true), locked = useRef(false), retry = useRef<{ signature: string; id: string } | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function load() {
    if (locked.current) return; locked.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const [s, snapshot] = await Promise.all([repository.inspect(month), operations.list()])
      if (JSON.stringify(s.snapshot) !== JSON.stringify(monthScheduleSnapshot(snapshot.visits, month))) throw new Error('조회 중 일정이 변경되었습니다. 다시 조회하세요.')
      if (alive.current) { setState(s); setData(snapshot); setShown(100); setConfirm(false); setChecked(false); setPhrase(''); retry.current = null }
    } catch (e) { if (alive.current) { setState(null); setData(null); setError(e instanceof Error ? e.message : '월 검토 조회 실패') } }
    finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  async function save() {
    if (locked.current || !state || !checked || (state.locked && phrase !== '잠금해제')) return
    const fields = { month, expectedVersion: state.version, locked: !state.locked, snapshot: state.snapshot }, signature = JSON.stringify(fields)
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() }
    locked.current = true; setBusy(true); setError('')
    try {
      const result = await repository.save({ ...fields, requestId: retry.current.id })
      if (alive.current) { setState(result); setConfirm(false); setChecked(false); setPhrase(''); retry.current = null; setNotice(result.locked ? '센터 일정 잠금을 저장했습니다. 공단 확정·청구 완료는 아닙니다.' : '센터 일정 잠금을 해제했습니다.'); onSaved() }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '저장 응답 미확인 · 같은 요청으로 재시도하세요.') }
    finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  const visits = data?.visits.filter(v => state?.snapshot.some(r => r.id === v.id)) ?? []
  return <section className="cd-card" aria-label="센터 월 일정 검토"><h3>{month} 센터 월 일정 검토</h3><p>센터 내부 일정의 편집 잠금입니다. 공단 청구명세·RFID 비교 및 공단 확정은 아직 연결되지 않았습니다. 실제 제공·서명·수납을 완료로 처리하지 않습니다.</p>
    <p role="status">{state ? `${state.locked ? '센터 잠금됨' : '편집 가능'} · 검토 버전 ${state.version} · 관련 일정 ${state.snapshot.length}건` : '잠금 상태 미조회'}</p>
    <button disabled={busy} onClick={() => void load()}>월 일정 검토 새로 조회</button>
    {error && <p className="cd-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {state && data && <><p>전월에 시작해 이달에 끝나는 일정도 포함합니다. 조회 후 추가·수정·보관되면 저장을 거절합니다.</p><div className="cd-table-wrap"><table><thead><tr><th>날짜·시작</th><th>수급자</th><th>제공자</th><th>서비스·분량</th><th>버전</th></tr></thead><tbody>{visits.slice(0, shown).map(v => <tr key={v.id}><td>{v.date} {v.time}</td><td>{data.people.find(p => p.id === v.patientId)?.name ?? '목록에 없는 수급자'}</td><td>{visitWorkerIds(v).map(id => data.people.find(p => p.id === id)?.name ?? '목록에 없는 직원').join(', ')}</td><td>{v.service} {v.minutes}분</td><td>{v.version}</td></tr>)}</tbody></table></div>{visits.length > shown && <button disabled={busy} onClick={() => setShown(n => n + 100)}>일정 더 보기 ({shown}/{visits.length}건 표시)</button>}
      <button disabled={busy || (!state.locked && !state.snapshot.length)} onClick={() => { setConfirm(true); setChecked(false); setPhrase('') }}>{state.locked ? '센터 잠금 해제 검토' : '센터 일정 잠금 검토'}</button>
      {confirm && <div role="group" aria-label="센터 일정 잠금 변경 확인"><p>{state.locked ? '해제하면 관련 일정을 다시 수정할 수 있습니다.' : '잠그면 해당 월과 겹치는 일정의 추가·수정·보관을 차단합니다. 공단 확인은 별도입니다.'}</p><label><input type="checkbox" disabled={busy} checked={checked} onChange={e => setChecked(e.target.checked)} />이 월 전체 일정과 잠금 변경 내용을 직접 확인했습니다.</label>{state.locked && <label>해제 확인 문구<input disabled={busy} value={phrase} onChange={e => setPhrase(e.target.value)} placeholder="잠금해제" /></label>}<button disabled={busy || !checked || (state.locked && phrase !== '잠금해제')} onClick={() => void save()}>{state.locked ? '확인 후 잠금 해제' : '확인 후 센터 잠금'}</button><button disabled={busy} onClick={() => setConfirm(false)}>취소</button></div>}
    </>}{busy && <p role="status">월 일정 검토 처리 중…</p>}
  </section>
}
