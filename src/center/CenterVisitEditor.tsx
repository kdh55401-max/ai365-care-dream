import { useState, type FormEvent } from 'react'
import { requiredVisitProviderCount, type CenterPerson, type CenterVisit } from '../../shared/centerOperations'

export function CenterVisitEditor({ visit, people, preview, save, archive, close }: {
  visit: CenterVisit; people: CenterPerson[]; preview: boolean;
  save: (visit: CenterVisit) => Promise<unknown>;
  archive: (visit: CenterVisit) => Promise<unknown>;
  close: () => void;
}) {
  const [service, setService] = useState(visit.service)
  const [secondaryWorker, setSecondaryWorker] = useState(visit.workerIds?.[1] ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)
  const existing = (visit.version ?? 0) > 0
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || confirmArchive) return
    const data = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true); setError('')
    try {
      // Keep the version captured when editing began: a reload must not authorize a stale overwrite.
      await save({ ...visit, date: String(data.date), time: String(data.time), workerId: String(data.workerId), workerIds: requiredVisitProviderCount(String(data.service)) === 2 ? [String(data.workerId), secondaryWorker] : [String(data.workerId)], patientId: String(data.patientId), service: String(data.service), minutes: Number(data.minutes) })
      close()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '저장하지 못했습니다. 입력은 유지됩니다.') }
    finally { setBusy(false) }
  }
  async function archiveConfirmed() {
    if (busy) return
    setBusy(true); setError('')
    try { await archive(visit); close() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '일정을 보관하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <div className="cd-overlay"><section role="dialog" aria-modal="true" aria-labelledby="visit-title" className="cd-modal">
    <h2 id="visit-title">방문일정 {existing ? '수정' : '추가'}</h2>
    <form onSubmit={submit}>
      <fieldset disabled={busy || confirmArchive} className="cd-visit-fields">
        <label>날짜<input type="date" name="date" required defaultValue={visit.date} /></label>
        <label>방문시간<input type="time" name="time" required defaultValue={visit.time} /></label>
        {(['worker', 'patient'] as const).map(kind => <label key={kind}>{kind === 'worker' ? '직원' : '수급자'}<select name={kind === 'worker' ? 'workerId' : 'patientId'} required defaultValue={kind === 'worker' ? visit.workerId : visit.patientId}><option value="" disabled>선택하세요</option>{people.filter(person => person.kind === kind && !person.archived).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>)}
        <label>서비스<select name="service" value={service} onChange={event => setService(event.target.value)}>{Array.from(new Set(['요양', '목욕', '간호', visit.service])).map(service => <option key={service}>{service}</option>)}</select></label>
        {requiredVisitProviderCount(service) === 2 && <label>두 번째 제공자<select name="secondaryWorkerId" required value={secondaryWorker} onChange={event => setSecondaryWorker(event.target.value)}><option value="" disabled>다른 제공자를 선택하세요</option>{people.filter(person => person.kind === 'worker' && !person.archived).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
        {requiredVisitProviderCount(service) === 2 && <p>목욕 일정은 서로 다른 제공자 2명을 지정합니다. 기존 1인 일정도 조회·보관할 수 있으며, 수정 저장할 때 두 번째 제공자를 선택합니다.</p>}
        <label>제공시간(분)<input name="minutes" type="number" min="1" max="1440" required defaultValue={visit.minutes} /></label>
      </fieldset>
      {error && <p role="alert" className="cd-error">{error}</p>}
      {confirmArchive ? <div><p>이 일정을 보관하면 현재 일정 목록에서 제외됩니다. 공단 일정이나 청구는 변경하지 않습니다.</p><button type="button" disabled={busy} onClick={() => { setConfirmArchive(false); setError('') }}>편집으로 돌아가기</button><button type="button" disabled={busy} onClick={() => void archiveConfirmed()}>{busy ? '보관 중…' : '보관 확인'}</button></div> : <footer className="cd-visit-actions">
        <button type="button" disabled={busy} onClick={close}>취소</button>
        {existing && <button type="button" disabled={busy} onClick={() => { setError(''); setConfirmArchive(true) }}>일정 보관</button>}
        <button className="cd-primary" disabled={busy}>{busy ? '저장 중…' : preview ? '시연 세션에 반영' : '기관에 저장'}</button>
      </footer>}
    </form>
  </section></div>
}
