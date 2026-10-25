import { useEffect, useMemo, useRef, useState } from 'react'
import { contractServices, type PatientContract, type PatientContractsState, type PatientContractMutation } from '../../shared/centerPatientContracts'
import type { CenterPerson } from '../../shared/centerOperations'
import { createDemoPatientContractsRepository, serverPatientContractsRepository } from './patientContractsRepo'
export function CenterPatientContracts({ patient, preview, onChanged }: { patient: CenterPerson; preview: boolean; onChanged(): void }) {
  const repo = useMemo(() => preview ? createDemoPatientContractsRepository(window.localStorage) : serverPatientContractsRepository, [preview])
  const [state, setState] = useState<PatientContractsState | null>(null), [form, setForm] = useState<PatientContract | null>(null)
  const [pending, setPending] = useState<{ action: 'apply' | 'archive'; id: string; expectedVersion: number; expectedPersonVersion: number } | null>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [showArchived, setShowArchived] = useState(false)
  const epoch = useRef<object>({}), lock = useRef(false), retry = useRef<{ signature: string; id: string } | null>(null)
  useEffect(() => { const token = {}; epoch.current = token; repo.inspect(patient.id).then(s => { if (epoch.current === token) setState(s) }).catch(e => { if (epoch.current === token) setError(e instanceof Error ? e.message : '계약이력 조회 실패') }).finally(() => { if (epoch.current === token) setLoading(false) }); return () => { epoch.current = {} } }, [repo, patient.id])
  async function reload() {
    if (lock.current) return; const token = {}; epoch.current = token; setLoading(true); setError(''); setNotice('')
    try { const s = await repo.inspect(patient.id); if (epoch.current === token) { setState(s); retry.current = null; onChanged() } }
    catch (e) { if (epoch.current === token) { setState(null); setError(e instanceof Error ? e.message : '조회 실패') } }
    finally { if (epoch.current === token) setLoading(false) }
  }
  async function save(fields: Omit<PatientContractMutation, 'requestId'>) {
    if (lock.current || loading) return
    const signature = JSON.stringify(fields)
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() }
    lock.current = true; setBusy(true); setError(''); setNotice(''); const token = epoch.current
    try {
      const result = await repo.save({ ...fields, requestId: retry.current.id } as PatientContractMutation)
      if (epoch.current === token) { setState(result.state); setForm(null); setPending(null); retry.current = null; setNotice(fields.action === 'apply' ? '선택 계약의 계약일·만료일을 수급자 기본정보에 적용했습니다. 공단 등록·계약 서명은 별도입니다.' : fields.action === 'archive' ? '계약이력을 보관했습니다.' : '계약이력을 저장했습니다. 현재 기본정보는 바뀌지 않았습니다.'); if (result.person) onChanged() }
    } catch (e) { if (epoch.current === token) setError(e instanceof Error ? e.message : '저장 응답 미확인 · 입력을 유지합니다.') }
    finally { lock.current = false; if (epoch.current === token) setBusy(false) }
  }
  const selected = state?.entries.find(e => e.id === state.activeId), editing = Boolean(form || pending), pendingEntry = state?.entries.find(e => e.id === pending?.id)
  const mismatch = selected && (selected.contractDate !== patient.start || selected.periodEnd !== patient.end)
  function cancel() { setForm(null); setPending(null); retry.current = null; setError('') }
  return <section aria-label="수급자 계약기간 이력"><h3>{patient.name} 계약기간 이력</h3><p>이력 저장과 현재 정보 적용은 별도입니다. 적용은 기본정보의 계약일·만료일만 바꾸며, 계약기간 시작일과 급여구분은 이 화면에서 확인합니다. 기존 일정·문서·공단 자료는 바뀌지 않습니다.</p>
    <p>현재 기본정보: 계약일 {patient.start || '미입력'} · 만료일 {patient.end || '미입력'}</p>{mismatch && <p role="status">기본정보가 마지막 적용 이력과 다릅니다. 수동 변경 여부를 확인하세요.</p>}
    {loading && <p role="status">계약이력 조회 중…</p>}{error && <p className="cd-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="cd-visit-actions"><button disabled={loading || busy || editing} onClick={() => void reload()}>계약이력 다시 조회</button><button disabled={!state || loading || busy || editing} onClick={() => { setError(''); setForm({ id: crypto.randomUUID(), contractDate: '', periodStart: '', periodEnd: '', services: ['요양'], note: '' }) }}>계약이력 추가</button></div>
    {state && <><p>이력 버전 {state.version} · 마지막 적용 {selected ? `${selected.contractDate} / ${selected.periodStart}–${selected.periodEnd}` : '없음'}</p><label><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />보관된 계약이력 보기</label>
      <div className="cd-table-wrap"><table><thead><tr>{['상태', '급여구분', '계약일', '계약기간', '비고', '작업'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{state.entries.filter(e => showArchived || !e.archived).sort((a, b) => b.contractDate.localeCompare(a.contractDate) || a.id.localeCompare(b.id)).map(e => <tr key={e.id}><td>{e.archived ? '보관' : state.activeId === e.id ? '마지막 적용' : '이력'}</td><td>{e.services.join(', ')}</td><td>{e.contractDate}</td><td>{e.periodStart}–{e.periodEnd}</td><td>{e.note}</td><td><button disabled={busy || editing || e.archived || e.id === state.activeId} onClick={() => { const { archived: _a, ...fields } = e; setForm(structuredClone(fields)); setError('') }}>이력 수정</button><button disabled={busy || editing || e.archived || (e.id === state.activeId && !mismatch) || !patient.version} onClick={() => { setPending({ action: 'apply', id: e.id, expectedVersion: state.version, expectedPersonVersion: patient.version ?? 0 }); setError('') }}>현재 정보에 적용</button><button disabled={busy || editing || e.archived || e.id === state.activeId} onClick={() => { setPending({ action: 'archive', id: e.id, expectedVersion: state.version, expectedPersonVersion: patient.version ?? 0 }); setError('') }}>이력 보관</button></td></tr>)}</tbody></table></div>
      {!state.entries.length && <p>등록된 계약이력이 없습니다.</p>}
      {form && <form onSubmit={event => { event.preventDefault(); void save({ action: 'save', patientId: patient.id, expectedVersion: state.version, contract: form } as Omit<PatientContractMutation, 'requestId'>) }}><fieldset disabled={busy}><legend>계약이력 작성</legend><div className="cd-visit-fields">{(['contractDate', 'periodStart', 'periodEnd'] as const).map(key => <label key={key}>{{ contractDate: '이력 계약일', periodStart: '계약기간 시작일', periodEnd: '계약기간 종료일' }[key]}<input type="date" required value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}<div>급여구분{contractServices.map(service => <label key={service}><input type="checkbox" checked={form.services.includes(service)} onChange={e => setForm({ ...form, services: e.target.checked ? [...form.services, service] : form.services.filter(s => s !== service) })} />{service}</label>)}</div><label>계약 비고<textarea maxLength={2000} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label></div><button type="submit">계약이력 저장</button><button type="button" onClick={cancel}>취소</button></fieldset></form>}
      {pending && pendingEntry && <div role="group" aria-label="계약이력 변경 확인"><p>{pending.action === 'apply' ? `계약일 ${pendingEntry.contractDate}, 계약기간 ${pendingEntry.periodStart}–${pendingEntry.periodEnd}의 이력을 적용할까요? 기본정보가 변경되었으면 저장을 거절합니다.` : '이 이력을 활성 목록에서 보관할까요? 저장된 이력은 남습니다.'}</p><button disabled={busy} onClick={() => void save({ action: pending.action, patientId: patient.id, expectedVersion: pending.expectedVersion, id: pending.id, ...(pending.action === 'apply' ? { expectedPersonVersion: pending.expectedPersonVersion } : {}) } as Omit<PatientContractMutation, 'requestId'>)}>변경 확인</button><button disabled={busy} onClick={cancel}>취소</button></div>}
      <p>마지막 적용 이력은 직접 수정·보관할 수 없습니다. 변경 계약을 새 이력으로 저장한 뒤 적용하세요.</p>
    </>}{busy && <p role="status">계약이력 저장 중…</p>}
  </section>
}
