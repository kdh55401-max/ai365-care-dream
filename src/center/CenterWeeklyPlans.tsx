import { useEffect, useMemo, useRef, useState } from 'react'
import { buildWeeklyPlanPreview, type WeeklyPlanEntry } from '../../shared/centerWeeklyPlan'
import { checkWeeklyPlanTransition, parseWeeklyPlanFields, weeklyPlanFields, type StoredWeeklyPlan, type WeeklyPlanFields, type WeeklyPlanMutation } from '../../shared/centerWeeklyPlanStore'
import { createDemoWeeklyPlansRepository, serverWeeklyPlansRepository } from './weeklyPlansRepo'
import type { Person } from './model'

import { CenterPlanApplication } from './CenterPlanApplication'
const days = ['일', '월', '화', '수', '목', '금', '토']
export function CenterWeeklyPlans({ patient, people, preview, onApplied }: { patient: Person; people: Person[]; preview: boolean; onApplied(): void }) {
  const repo = useMemo(() => preview ? createDemoWeeklyPlansRepository(window.localStorage) : serverWeeklyPlansRepository, [preview])
  const [plans, setPlans] = useState<StoredWeeklyPlan[]>([]), [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [metadata, setMetadata] = useState<WeeklyPlanFields | null>(null), [entry, setEntry] = useState<WeeklyPlanEntry | null>(null)
  const [confirmation, setConfirmation] = useState<{ kind: 'entry' | 'plan'; id: string } | null>(null)
  const epoch = useRef<object>({}), lock = useRef(false), retry = useRef<{ signature: string; requestId: string } | null>(null)
  const plan = plans.find(p => p.id === selected), workers = people.filter(p => p.kind === 'worker')
  const editing = Boolean(metadata || entry || confirmation)
  useEffect(() => {
    const run = {}; epoch.current = run
    repo.list(patient.id).then(result => { if (epoch.current === run) { setPlans(result); setSelected(result[0]?.id ?? '') } }).catch(e => { if (epoch.current === run) setError(e instanceof Error ? e.message : '계획 조회 실패') }).finally(() => { if (epoch.current === run) setLoading(false) })
    return () => { epoch.current = {} }
  }, [repo, patient.id])
  async function reload() {
    if (lock.current) return
    const run = {}; epoch.current = run; setLoading(true); setError(''); setNotice('')
    try { const result = await repo.list(patient.id); if (epoch.current === run) { setPlans(result); setSelected(result.some(p => p.id === selected) ? selected : result[0]?.id ?? ''); retry.current = null } }
    catch (e) { if (epoch.current === run) setError(e instanceof Error ? e.message : '계획 조회 실패') }
    finally { if (epoch.current === run) setLoading(false) }
  }
  async function save(fields?: WeeklyPlanFields, archive = false) {
    if (lock.current || loading) return
    let mutation: WeeklyPlanMutation
    try {
      let warnings = ''
      if (archive) { if (!plan) return; mutation = { action: 'archive', id: plan.id, expectedVersion: plan.version, requestId: '' } }
      else {
        if (!fields) return
        const parsed = parseWeeklyPlanFields(fields), previous = plans.find(p => p.id === parsed.id)
        warnings = checkWeeklyPlanTransition(previous, parsed).length ? ' 요양 간격이 120분 미만인 항목이 있으니 확인하세요.' : ''
        mutation = { action: 'save', plan: parsed, expectedVersion: previous?.version ?? 0, requestId: '' }
      }
      const signature = JSON.stringify(mutation)
      if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() }
      mutation.requestId = retry.current.requestId
      lock.current = true; setBusy(true); setError(''); setNotice('')
      const run = epoch.current
      try {
        const saved = await repo.mutate(mutation)
        if (epoch.current !== run) return
        setPlans(old => saved.archived ? old.filter(p => p.id !== saved.id) : [saved, ...old.filter(p => p.id !== saved.id)])
        setSelected(saved.archived ? '' : saved.id); setMetadata(null); setEntry(null); setConfirmation(null); retry.current = null
        setNotice(`${preview ? '가상 ' : ''}계획을 ${saved.archived ? '보관' : '저장'}했습니다.${warnings}`)
      } catch (e) { if (epoch.current === run) setError(e instanceof Error ? e.message : '저장 실패 · 입력은 유지됩니다.') }
      finally { lock.current = false; if (epoch.current === run) setBusy(false) }
    } catch (e) { setError(e instanceof Error ? e.message : '계획 입력을 확인하세요.') }
  }
  function cancel() { setMetadata(null); setEntry(null); setConfirmation(null); setError(''); retry.current = null }
  const name = (id: string) => workers.find(p => p.id === id)?.name ?? '현재 목록에 없는 제공자'
  const monthly = plan ? buildWeeklyPlanPreview({ patientId: plan.patientId, month: plan.month, entries: plan.entries }) : []
  return <section aria-label="주간 급여계획"><h3>{patient.name} 주간 급여계획</h3>
    <p>적용월과 참고사항을 먼저 저장한 뒤 방문 항목을 하나씩 추가합니다. 실제 방문일정·일정확정·공단 전송은 별도입니다.</p>
    {loading && <p role="status">계획 조회 중…</p>}
    {error && <p role="alert" className="cd-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="cd-visit-actions"><button disabled={loading || busy || editing} onClick={() => { setError(''); setMetadata({ id: crypto.randomUUID(), patientId: patient.id, month: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7), note: '', entries: [] }) }}>새 주간 계획</button><button disabled={loading || busy || editing} onClick={() => void reload()}>계획 다시 조회</button></div>
    <label>저장된 계획<select aria-label="저장된 계획" disabled={loading || busy || editing} value={selected} onChange={e => { setSelected(e.target.value); setNotice(''); setError('') }}><option value="">계획 선택</option>{plans.map(p => <option key={p.id} value={p.id}>{p.month} · {p.note.slice(0, 30) || '참고사항 없음'} · v{p.version}</option>)}</select></label>
    {!loading && !plans.length && <p>저장된 주간 계획이 없습니다.</p>}
    {metadata && <form onSubmit={e => { e.preventDefault(); void save(metadata) }}><fieldset disabled={busy}><legend>계획 적용월·참고사항</legend><label>적용월<input type="month" required value={metadata.month} onChange={e => setMetadata({ ...metadata, month: e.target.value })} /></label><label>계획 참고사항<textarea maxLength={2000} value={metadata.note} onChange={e => setMetadata({ ...metadata, note: e.target.value })} /></label><button type="submit">계획 정보 저장</button><button type="button" onClick={cancel}>취소</button></fieldset></form>}
    {plan && <><p>적용월 {plan.month} · 저장 버전 {plan.version} · {plan.note || '참고사항 없음'}</p><div className="cd-visit-actions"><button disabled={busy || editing} onClick={() => setMetadata(weeklyPlanFields(plan))}>계획 정보 수정</button><button disabled={busy || editing} onClick={() => setEntry({ id: crypto.randomUUID(), service: '요양', weekdays: [1], start: '09:00', end: '10:00', workerIds: [''], nursingDual: false })}>방문 항목 추가</button><button disabled={busy || editing} onClick={() => setConfirmation({ kind: 'plan', id: plan.id })}>계획 보관</button></div>
      <ul>{plan.entries.map(item => <li key={item.id}>{item.service} · {item.weekdays.map(d => days[d]).join('·')} · {item.start}–{item.end}{item.end < item.start ? ' (다음 날 종료)' : ''} · {item.workerIds.map(name).join(', ')}{item.nursingDual ? ' · 간호 중복 예외' : ''} <button disabled={busy || editing} onClick={() => setEntry(structuredClone(item))}>항목 수정</button><button disabled={busy || editing} onClick={() => setConfirmation({ kind: 'entry', id: item.id })}>항목 삭제</button></li>)}</ul>
      {entry && <form onSubmit={e => { e.preventDefault(); void save({ ...weeklyPlanFields(plan), entries: [...plan.entries.filter(item => item.id !== entry.id), entry] }) }}><fieldset disabled={busy}><legend>방문계획 항목</legend><div className="cd-visit-fields"><label>서비스<select value={entry.service} onChange={e => { const service = e.target.value as WeeklyPlanEntry['service']; setEntry({ ...entry, service, workerIds: service === '목욕' ? [entry.workerIds[0], entry.workerIds[1] ?? ''] : [entry.workerIds[0]], nursingDual: service === '간호' && entry.nursingDual }) }}>{['요양', '간호', '목욕'].map(s => <option key={s}>{s}</option>)}</select></label><div>방문요일{days.map((d, i) => <label key={d}><input type="checkbox" checked={entry.weekdays.includes(i)} onChange={e => setEntry({ ...entry, weekdays: e.target.checked ? [...entry.weekdays, i].sort() : entry.weekdays.filter(day => day !== i) })} />{d}요일</label>)}</div><label>시작 시간<input type="time" required value={entry.start} onChange={e => setEntry({ ...entry, start: e.target.value })} /></label><label>종료 시간<input type="time" required value={entry.end} onChange={e => setEntry({ ...entry, end: e.target.value })} /></label>{entry.workerIds.map((id, index) => <label key={index}>제공자 {index + 1}<select required value={id} onChange={e => setEntry({ ...entry, workerIds: entry.workerIds.map((old, n) => n === index ? e.target.value : old) })}><option value="">직원 선택</option>{workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>)}{entry.service === '간호' && <label><input type="checkbox" checked={entry.nursingDual} onChange={e => setEntry({ ...entry, nursingDual: e.target.checked })} />간호 중복 예외 적용 · 적용 근거는 별도 확인</label>}</div><button type="submit">방문 항목 저장</button><button type="button" onClick={cancel}>취소</button></fieldset></form>}
      {confirmation && <div role="group" aria-label="계획 변경 확인"><p>{confirmation.kind === 'plan' ? '이 주간 계획을 보관할까요? 기존 방문일정은 변경되지 않습니다.' : '선택한 방문 항목을 계획에서 삭제할까요?'}</p><button disabled={busy} onClick={() => confirmation.kind === 'plan' ? void save(undefined, true) : void save({ ...weeklyPlanFields(plan), entries: plan.entries.filter(item => item.id !== confirmation.id) })}>변경 확인</button><button disabled={busy} onClick={cancel}>취소</button></div>}
      {!editing && <CenterPlanApplication key={plan.id + plan.version} plan={plan} preview={preview} onApplied={onApplied} />}<h4>저장된 계획의 월 예상 일정 · 실제 방문일정 아님</h4><p>{monthly.length}건 · 계획 기준 예상 내역이며 실제 반영 여부는 위에서 조회하세요.</p><div className="cd-table-wrap"><table><thead><tr>{['날짜', '시간', '서비스', '제공자'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{monthly.slice(0, 100).map(item => <tr key={`${item.sourceEntryId}:${item.date}`}><td>{item.date}</td><td>{item.time}–{item.endDate !== item.date ? `${item.endDate} ` : ''}{item.endTime}</td><td>{item.service}</td><td>{item.workerIds.map(name).join(', ')}</td></tr>)}</tbody></table></div>{monthly.length > 100 && <p>총 {monthly.length}건 중 처음 100건을 표시합니다.</p>}
    </>}{busy && <p role="status">계획 저장 중…</p>}
  </section>
}
