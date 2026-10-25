import { useState } from 'react'
import type { Person } from './model'

export function CenterPersonNotes({ person, tab, save }: { person: Person; tab: string; save(person: Person): Promise<unknown> }) {
  const [text, setText] = useState(person.notes[tab] || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  async function submit() {
    setBusy(true); setError(''); setSaved(false)
    try { await save({ ...person, notes: { ...person.notes, [tab]: text } }); setSaved(true) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '메모를 저장하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <section aria-label={`${tab} 업무 메모`}><h3>{tab} 업무 메모</h3>
    <p>메모를 저장할 수 있습니다. 이 탭의 전용 업무 양식·계산은 별도로 연결해야 합니다.</p>
    <textarea aria-label={`${tab} 업무 메모 입력`} value={text} disabled={busy} onChange={event => { setText(event.target.value); setSaved(false) }} />
    <button disabled={busy} onClick={() => void submit()}>{busy ? '저장 중…' : '메모 저장'}</button>
    {error && <p className="cd-error" role="alert">{error}</p>}{saved && <p role="status">메모를 저장했습니다.</p>}
  </section>
}
