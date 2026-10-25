import { useEffect, useMemo, useRef, useState } from 'react'
import type { CenterPerson } from '../../shared/centerOperations'
import { patientRateAt, patientRateLabels, type PatientRate, type PatientRatesState, type PatientRateMutation } from '../../shared/centerPatientRates'
import { createDemoPatientRatesRepository, serverPatientRatesRepository } from './patientRatesRepo'
type Fields<T> = T extends unknown ? Omit<T, 'requestId'> : never
function localDay() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export function CenterPatientRates({ patient, preview }: { patient: CenterPerson; preview: boolean }) {
 const repo = useMemo(() => preview ? createDemoPatientRatesRepository(window.localStorage) : serverPatientRatesRepository, [preview])
 const [state, setState] = useState<PatientRatesState | null>(null), [form, setForm] = useState<PatientRate | null>(null), [pending, setPending] = useState<{ id: string; version: number } | null>(null)
 const [day, setDay] = useState(localDay), [archived, setArchived] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
 const epoch = useRef<object>({}), lock = useRef(false), retry = useRef<{ signature: string; id: string } | null>(null)
 useEffect(() => { const token = {}; epoch.current = token; repo.inspect(patient.id).then(s => { if (epoch.current === token) setState(s) }).catch(e => { if (epoch.current === token) setError(e instanceof Error ? e.message : '조회 실패') }).finally(() => { if (epoch.current === token) setLoading(false) }); return () => { epoch.current = {} } }, [repo, patient.id])
 async function reload() {
  if (lock.current) return; const token = {}; epoch.current = token; setLoading(true); setError(''); setNotice('')
  try { const s = await repo.inspect(patient.id); if (epoch.current === token) { setState(s); retry.current = null } } catch (e) { if (epoch.current === token) { setState(null); setError(e instanceof Error ? e.message : '조회 실패') } } finally { if (epoch.current === token) setLoading(false) }
 }
 async function save(fields: Fields<PatientRateMutation>) {
  if (lock.current || loading) return
  const signature = JSON.stringify(fields); if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() }
  lock.current = true; setBusy(true); setError(''); setNotice(''); const token = epoch.current
  try { const result = await repo.save({ ...fields, requestId: retry.current.id }); if (epoch.current === token) { setState(result.state); setForm(null); setPending(null); retry.current = null; setNotice(fields.action === 'save' ? '부담률 이력을 저장했습니다. 기본정보·기존 일정·청구금액은 바뀌지 않았습니다.' : '부담률 이력을 보관했습니다. 과거 청구금액은 바뀌지 않았습니다.') } } catch (e) { if (epoch.current === token) setError(e instanceof Error ? e.message : '저장 응답 미확인 · 입력 유지') } finally { lock.current = false; if (epoch.current === token) setBusy(false) }
 }
 let current: ReturnType<typeof patientRateAt> = null, dayError = ''
 if (state) { try { current = patientRateAt(state, day) } catch { dayError = '올바른 기준일을 선택하세요.' } }
 const editing = Boolean(form || pending)
 function cancel() { setForm(null); setPending(null); retry.current = null; setError('') }
 return <section aria-label="수급자 본인부담률 이력"><h3>{patient.name} 본인부담률 적용일 이력</h3><p>확인한 자료의 적용일과 구분을 기록합니다. 표시 구분은 참고 원본 기준이며 자격·현행 공단 기준 확인을 대신하지 않습니다. 기본정보·기존 일정·과거 청구금액은 변경하지 않습니다.</p>
  <label>부담률 조회 기준일<input type="date" value={day} onChange={e => setDay(e.target.value)} /></label>{dayError ? <p role="status">{dayError}</p> : state && <p>기준일 이력: {current ? `${patientRateLabels[current.rateCode]} · 적용일 ${current.effectiveDate}` : '해당 기준일까지 등록된 이력 없음'}</p>}
  {loading && <p role="status">부담률 이력 조회 중…</p>}{error && <p className="cd-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  <div className="cd-visit-actions"><button disabled={loading || busy || editing} onClick={() => void reload()}>부담률 다시 조회</button><button disabled={!state || loading || busy || editing} onClick={() => { setError(''); setForm({ id: crypto.randomUUID(), effectiveDate: '', rateCode: '01', note: '' }) }}>부담률 이력 추가</button></div>
  {state && <><p>부담률 이력 버전 {state.version}</p><label><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />보관된 부담률 이력 보기</label><div className="cd-table-wrap"><table><thead><tr>{['상태', '적용일', '구분', '비고', '작업'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{state.entries.filter(e => archived || !e.archived).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)).map(e => <tr key={e.id}><td>{e.archived ? '보관' : e.id === current?.id ? '기준일 해당' : e.effectiveDate > day ? '향후 이력' : '이력'}</td><td>{e.effectiveDate}</td><td>{patientRateLabels[e.rateCode]}</td><td>{e.note}</td><td><button disabled={busy || editing || e.archived} onClick={() => { const { archived: _a, ...f } = e; setForm(f); setError('') }}>부담률 이력 수정</button><button disabled={busy || editing || e.archived} onClick={() => { setPending({ id: e.id, version: state.version }); setError('') }}>부담률 이력 보관</button></td></tr>)}</tbody></table></div>
  {!state.entries.length && <p>등록된 부담률 이력이 없습니다.</p>}
  {form && <form onSubmit={e => { e.preventDefault(); void save({ action: 'save', patientId: patient.id, expectedVersion: state.version, rate: form }) }}><fieldset disabled={busy}><legend>본인부담률 이력 입력</legend><label>부담률 적용일<input type="date" required value={form.effectiveDate} onChange={e => setForm({ ...form, effectiveDate: e.target.value })} /></label><label>본인부담 구분<select aria-label="본인부담 구분" value={form.rateCode} onChange={e => setForm({ ...form, rateCode: e.target.value as PatientRate['rateCode'] })}>{Object.entries(patientRateLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><label>부담률 비고<textarea maxLength={2000} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label><button type="submit">부담률 이력 저장</button><button type="button" onClick={cancel}>취소</button></fieldset></form>}
  {pending && <div role="group" aria-label="부담률 보관 확인"><p>선택 이력을 보관할까요? 기준일 조회 대상에서는 제외되며 기록은 남습니다. 기존 청구를 다시 계산하지 않습니다.</p><button disabled={busy} onClick={() => void save({ action: 'archive', patientId: patient.id, expectedVersion: pending.version, id: pending.id })}>보관 확인</button><button disabled={busy} onClick={cancel}>취소</button></div>}
  <p>같은 적용일의 중복 활성 이력은 막습니다. 이는 이 앱의 충돌 방지 규칙입니다. 공단 자료 자동 조회·청구 계산은 아직 연결 전입니다.</p></>}
 </section>
}
