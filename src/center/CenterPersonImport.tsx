import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

interface ImportResult {
  id?: string
  kind?: 'worker' | 'patient'
  status: string
  personId?: string | null
  fields?: Record<string, unknown>
  evidence?: unknown
  sourceText?: string
  reasons?: string[]
}

export function CenterPersonImport({ kind, onSaved, onClose, onOpenPerson }: {
  kind: 'worker' | 'patient'
  onSaved(): Promise<void>
  onClose(): void
  onOpenPerson?(id: string): void
}) {
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [consent, setConsent] = useState(false)
  const [history, setHistory] = useState<ImportResult[]>([])
  const [historyError, setHistoryError] = useState('')
  const requestId = useRef(crypto.randomUUID())
  const loadHistory = useCallback(async () => {
    const response = await fetch('/api/center/imports', { credentials: 'same-origin' })
    const body = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(body?.imports)) throw new Error(body?.error || '이전 처리 자료를 조회하지 못했습니다.')
    return body.imports.filter((record: ImportResult) => record.kind === kind) as ImportResult[]
  }, [kind])
  useEffect(() => {
    let active = true
    void loadHistory().then(records => { if (active) { setHistory(records); setHistoryError('') } }).catch(failure => { if (active) setHistoryError(failure.message) })
    return () => { active = false }
  }, [loadHistory])
  function change(value: string) {
    setSource(value); setResult(null); setError(''); requestId.current = crypto.randomUUID()
  }
  async function fileInput(file?: File) {
    if (!file) return
    try {
      if (!/\.(txt|md)$/i.test(file.name) || file.size > 100_000) throw new Error('UTF-8 TXT·Markdown 파일(100KB 이하)을 선택하세요.')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (text.length > 20_000) throw new Error('입력 자료는 20,000자 이하여야 합니다.')
      change(text)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '파일을 읽지 못했습니다.') }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!consent || busy || !source.trim()) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/center/imports', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, sourceText: source, requestId: requestId.current }) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || '자료 추출·저장을 완료하지 못했습니다. 같은 요청으로 다시 시도할 수 있습니다.')
      if (!body?.import || !['saved', 'review_required'].includes(body.import.status)) throw new Error('저장 결과를 확인하지 못했습니다. 입력은 유지됩니다.')
      setResult(body.import)
      await onSaved()
      try { setHistory(await loadHistory()); setHistoryError('') } catch { setHistoryError('저장은 완료됐으나 이전 처리 목록을 다시 조회하지 못했습니다.') }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '자료를 처리하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <section className="cd-card" aria-label="인물 자료 AI 입력">
    <div className="cd-document-heading"><h2>{kind === 'worker' ? '직원' : '수급자'} 자료에서 정보 가져오기</h2><button disabled={busy} onClick={onClose}>닫기</button></div>
    <p>명확한 정보는 기관 기록으로 저장하고, 동명이인·기존 정보 충돌은 검토 대상으로 남깁니다. 기존 인물의 값은 자동 덮어쓰지 않습니다.</p>
    <p>현재 지원: 붙여넣기, UTF-8 TXT·Markdown. 날짜는 원문에 YYYY-MM-DD로 명시된 값만 추출합니다. HWPX·PDF·스캔 이미지 읽기는 아직 연결 전입니다.</p>
    <form className="cd-document-form" onSubmit={submit}>
      <label>자료 파일<input type="file" accept=".txt,.md,text/plain,text/markdown" disabled={busy} onChange={event => { void fileInput(event.target.files?.[0]); event.target.value = '' }} /></label>
      <label>원본 자료<textarea required maxLength={20_000} value={source} disabled={busy} onChange={event => change(event.target.value)} placeholder="한 사람의 자료를 입력하세요. 다른 사람의 정보가 섞이면 검토가 필요합니다." /></label>
      <label className="cd-inline-label"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />이 자료를 기관에 설정된 AI API로 보내 정보 추출에 사용하는 것을 확인했습니다.</label>
      <p>자료와 추출 근거는 기관별 저장소에 보관됩니다. 외부 AI 처리 설정이 없으면 전송·저장을 실행하지 않습니다. 최종 업무문서 승인과는 별개입니다.</p>
      <button className="cd-primary" disabled={busy || !consent || !source.trim()}>{busy ? '정보 추출·저장 확인 중…' : 'AI로 정보 추출하고 저장'}</button>
    </form>
    {error && <p className="cd-error" role="alert">{error}</p>}
    <h3>이전 자료 처리 · 기관 저장소 재조회</h3>
    {historyError && <p className="cd-error" role="alert">{historyError}</p>}
    <button disabled={busy} onClick={() => void loadHistory().then(records => { setHistory(records); setHistoryError('') }).catch(failure => setHistoryError(failure.message))}>처리 목록 다시 조회</button>
    {history.map(item => <button key={item.id} disabled={busy} onClick={() => setResult(item)}>{String(item.fields?.name || '이름 미확인')} · {({saved:'인물 저장',review_required:'검토 필요',processing:'처리 중',failed:'실패'} as Record<string,string>)[item.status] || item.status}</button>)}
    {result && <section aria-label="AI 자료 처리 결과"><h3>{({saved:'인물 기록에 저장했습니다',review_required:'기존 정보는 보존하고 검토 대상으로 저장했습니다',processing:'자료 처리가 아직 완료되지 않았습니다',failed:'자료 처리에 실패했습니다. 인물 저장 완료가 아닙니다'} as Record<string,string>)[result.status] || '처리 상태를 확인해 주세요'}</h3>
      <p>처리번호: {result.id || '응답에서 확인하지 못함'}</p>
      {result.personId && onOpenPerson && <button onClick={() => onOpenPerson(result.personId!)}>저장한 인물 열기·수정</button>}
      {result.reasons?.map((reason, index) => <p key={index}>{reason}</p>)}
      <h3>추출 정보 · 확인되지 않은 값은 미확인</h3><pre className="cd-document-content">{JSON.stringify(result.fields ?? {}, null, 2)}</pre>
      <h3>원문 근거</h3><pre className="cd-document-content">{JSON.stringify(result.evidence ?? {}, null, 2)}</pre>
      {result.sourceText && <><h3>저장된 원본 자료</h3><pre className="cd-document-content">{result.sourceText}</pre></>}
    </section>}
  </section>
}
