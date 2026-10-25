import { useEffect, useMemo, useRef, useState } from 'react'
import type { CenterPerson } from '../../shared/centerOperations'
import type { PatientRecognition, PatientRecognitionsState, PatientRecognitionMutation } from '../../shared/centerPatientRecognitions'
import { createDemoPatientRecognitionsRepository, serverPatientRecognitionsRepository } from './patientRecognitionsRepo'
type Fields<T> = T extends unknown ? Omit<T, 'requestId'> : never
export function CenterPatientRecognitions({ patient, preview, onChanged }: { patient: CenterPerson; preview: boolean; onChanged(): void }) {
  const repo = useMemo(() => preview ? createDemoPatientRecognitionsRepository(window.localStorage) : serverPatientRecognitionsRepository, [preview])
  const [state, setState] = useState<PatientRecognitionsState | null>(null), [form, setForm] = useState<PatientRecognition | null>(null)
  const [pending, setPending] = useState<{ action: 'apply' | 'archive'; id: string; expectedVersion: number; expectedPersonVersion: number } | null>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [showArchived, setShowArchived] = useState(false)
  const epoch = useRef<object>({}), lock = useRef(false), retry = useRef<{ signature: string; id: string } | null>(null)
  useEffect(() => { const token = {}; epoch.current = token; repo.inspect(patient.id).then(s => { if (epoch.current === token) setState(s) }).catch(e => { if (epoch.current === token) setError(e instanceof Error ? e.message : '인정이력 조회 실패') }).finally(() => { if (epoch.current === token) setLoading(false) }); return () => { epoch.current = {} } }, [repo, patient.id])
  async function reload() {
    if (lock.current) return; const token = {}; epoch.current = token; setLoading(true); setError(''); setNotice('')
    try { const s = await repo.inspect(patient.id); if (epoch.current === token) { setState(s); retry.current = null; onChanged() } }
    catch (e) { if (epoch.current === token) { setState(null); setError(e instanceof Error ? e.message : '조회 실패') } }
    finally { if (epoch.current === token) setLoading(false) }
  }
  async function save(fields: Fields<PatientRecognitionMutation>) {
    if (lock.current || loading) return
    const signature = JSON.stringify(fields)
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() }
    lock.current = true; setBusy(true); setError(''); setNotice(''); const token = epoch.current
    try {
      const result = await repo.save({ ...fields, requestId: retry.current.id })
      if (epoch.current === token) { setState(result.state); setForm(null); setPending(null); retry.current = null; setNotice(fields.action === 'apply' ? '선택 이력의 등급을 기본정보에 적용했습니다. 인정번호·기간은 마지막 적용 이력에서 확인하세요. 공단 조회·등록은 별도입니다.' : fields.action === 'archive' ? '인정이력을 보관했습니다.' : '인정이력을 저장했습니다. 현재 기본정보는 바뀌지 않았습니다.'); if (result.person) onChanged() }
    } catch (e) { if (epoch.current === token) setError(e instanceof Error ? e.message : '저장 응답 미확인 · 입력은 유지됩니다.') }
    finally { lock.current = false; if (epoch.current === token) setBusy(false) }
  }
  const selected = state?.entries.find(e => e.id === state.activeId), editing = Boolean(form || pending), pendingEntry = state?.entries.find(e => e.id === pending?.id)
  const mismatch = selected && selected.grade !== patient.category
  function cancel() { setForm(null); setPending(null); retry.current = null; setError('') }
  return <section aria-label="수급자 등급 인정이력"><h3>{patient.name} 등급·인정기간 이력</h3><p>인정서에 기재된 등급·번호·확장값·유효기간을 입력합니다. 번호 형식 검사는 공단 유효성·급여 자격 확인이 아닙니다. 저장과 적용은 별도이며 계약일·계약기간·기존 일정·과거 청구는 바꾸지 않습니다.</p>
    <p>현재 기본정보 등급: {patient.category || '미입력'}</p>{selected && <p>마지막 적용 인정정보: {selected.grade} · {selected.number}-{selected.sequence} · {selected.periodStart}–{selected.periodEnd}</p>}{mismatch && <p role="status">기본정보 등급이 마지막 적용 이력과 다릅니다. 수동 변경 여부를 확인하세요.</p>}
    {loading && <p role="status">인정이력 조회 중…</p>}{error && <p className="cd-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="cd-visit-actions"><button disabled={loading || busy || editing} onClick={() => void reload()}>인정이력 다시 조회</button><button disabled={!state || loading || busy || editing} onClick={() => { setError(''); setForm({ id: crypto.randomUUID(), grade: '', number: '', sequence: '', periodStart: '', periodEnd: '', note: '' }) }}>인정이력 추가</button></div>
    {state && <><p>인정이력 버전 {state.version}</p><label><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />보관된 인정이력 보기</label><div className="cd-table-wrap"><table><thead><tr>{['상태', '등급', '인정기간', '인정번호·확장', '비고', '작업'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{state.entries.filter(e => showArchived || !e.archived).sort((a, b) => Number(b.sequence) - Number(a.sequence) || b.periodStart.localeCompare(a.periodStart) || a.id.localeCompare(b.id)).map(e => <tr key={e.id}><td>{e.archived ? '보관' : e.id === state.activeId ? '마지막 적용' : '이력'}</td><td>{e.grade}</td><td>{e.periodStart}–{e.periodEnd}</td><td>{e.number}-{e.sequence}</td><td>{e.note}</td><td><button disabled={busy || editing || e.archived || e.id === state.activeId} onClick={() => { const { archived: _a, ...fields } = e; setForm(structuredClone(fields)); setError('') }}>인정이력 수정</button><button disabled={busy || editing || e.archived || (e.id === state.activeId && !mismatch) || !patient.version} onClick={() => { setPending({ action: 'apply', id: e.id, expectedVersion: state.version, expectedPersonVersion: patient.version ?? 0 }); setError('') }}>등급 정보에 적용</button><button disabled={busy || editing || e.archived || e.id === state.activeId} onClick={() => { setPending({ action: 'archive', id: e.id, expectedVersion: state.version, expectedPersonVersion: patient.version ?? 0 }); setError('') }}>인정이력 보관</button></td></tr>)}</tbody></table></div>
      {!state.entries.length && <p>등록된 인정이력이 없습니다.</p>}
      {form && <form onSubmit={event => { event.preventDefault(); void save({ action: 'save', patientId: patient.id, expectedVersion: state.version, recognition: form }) }}><fieldset disabled={busy}><legend>등급·인정기간 입력</legend><div className="cd-visit-fields"><label>인정서 등급<input required maxLength={100} value={form.grade} placeholder="인정서에 기재된 등급" onChange={e => setForm({ ...form, grade: e.target.value })} /></label><label>장기요양 인정번호<input required maxLength={21} value={form.number} placeholder="L로 시작하는 번호" onChange={e => setForm({ ...form, number: e.target.value })} /></label><label>인정번호 확장값<input required maxLength={10} inputMode="numeric" value={form.sequence} placeholder="예: 001 · 앞자리 0 유지" onChange={e => setForm({ ...form, sequence: e.target.value })} /></label>{(['periodStart', 'periodEnd'] as const).map(key => <label key={key}>{key === 'periodStart' ? '인정기간 시작일' : '인정기간 종료일'}<input type="date" required value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}<label>인정이력 비고<textarea maxLength={2000} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label></div><button type="submit">인정이력 저장</button><button type="button" onClick={cancel}>취소</button></fieldset></form>}
      {pending && pendingEntry && <div role="group" aria-label="인정이력 변경 확인"><p>{pending.action === 'apply' ? `${pendingEntry.grade} / ${pendingEntry.number}-${pendingEntry.sequence} / ${pendingEntry.periodStart}–${pendingEntry.periodEnd} 이력을 적용할까요? 기본정보 등급만 바뀌며 공단에서 검증한 결과는 아닙니다.` : '선택 이력을 활성 목록에서 보관할까요? 보관 기록은 남습니다.'}</p><button disabled={busy} onClick={() => { const base = { patientId: patient.id, expectedVersion: pending.expectedVersion, id: pending.id }; void save(pending.action === 'apply' ? { ...base, action: 'apply', expectedPersonVersion: pending.expectedPersonVersion } : { ...base, action: 'archive' }) }}>변경 확인</button><button disabled={busy} onClick={cancel}>취소</button></div>}
      <p>마지막 적용 이력은 직접 수정·보관하지 않습니다. 변경된 인정서는 새 이력으로 등록해 적용하세요. 인정서 파일 첨부·공단 자동 대조는 아직 연결 전입니다.</p>
    </>}{busy && <p role="status">인정이력 저장 중…</p>}
  </section>
}
