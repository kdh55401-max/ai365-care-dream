import { CenterDocumentCoverage } from './CenterDocumentCoverage'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CENTER_DOCUMENT_TEMPLATES, type CenterDocument, type CenterDocumentFields } from '../../shared/centerDocuments'
import { createCenterPatientDraft, type CenterPatientDraftTemplateId } from '../../shared/centerPatientDraft'
import { emptyStateChange, formatStateChangeText, parseStateChange, stateChangeProblems } from '../../shared/centerStateChange'
import { stateChangeHml, type StateChangeOrientation } from '../../shared/centerStateChangeHml'
import { stateChangePrintHtml } from '../../shared/centerStateChangePrint'
import { CenterStateChangeForm } from './CenterStateChangeForm'
import type { Person } from './model'
import type { DocumentRepository } from './documentRepo'
import './documents.css'

export interface CenterDocumentView {
  documents: CenterDocument[]
  loading: boolean
  error: string
  reload(): Promise<void>
  saved(document: CenterDocument): void
  repository: DocumentRepository
}

function currentMonth() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date())
}
export interface CenterDocumentStart { templateId: string; personId: string }

function blank(templateId = 'case-management'): CenterDocumentFields {
  const template = CENTER_DOCUMENT_TEMPLATES.find(t => t.id === templateId)!
  return { templateId, title: template.label, subjectKind: template.subjectKinds[0], subjectId: null,
    period: currentMonth(), content: '', resultEvaluationCompleted: false }
}

export function CenterDocuments({ view, preview, people = [], start, registryUnavailable = false }: { view: CenterDocumentView; preview: boolean; people?: Person[]; start?: CenterDocumentStart; registryUnavailable?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(Boolean(start))
  const [fields, setFields] = useState<CenterDocumentFields>(() => start ? { ...blank(start.templateId), subjectId: start.personId } : blank())
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null)
  const [source, setSource] = useState('')
  const [subjectFilter, setSubjectFilter] = useState(start?.personId || '')
  const [filter, setFilter] = useState('')
  const [period, setPeriod] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const confirmId = useRef(crypto.randomUUID())
  const document = view.documents.find(d => d.id === selected)
  const templates = CENTER_DOCUMENT_TEMPLATES
  const patients = people.filter(p => p.kind === 'patient')
  const subjectLabel = (kind: string, id: string | null) => kind === 'agency' ? '기관 공통' : patients.find(p => p.id === id)?.name || `수급자 (${id || '미선택'})`
  const structured = fields.templateId === 'state-change-record' && (fields.content === '' || parseStateChange(fields.content) !== null)
  const readable = (d: CenterDocument) => { const record = d.templateId === 'state-change-record' ? parseStateChange(d.content) : null; return record ? formatStateChangeText(record) : d.content }
  const list = view.documents.filter(d => (!subjectFilter || d.subjectId === subjectFilter) && (!filter || d.title.includes(filter)) && (!period || d.period === period) && (!status || d.status === status))

  function openDocument(id: string) {
    if (editing && !window.confirm('저장하지 않은 입력을 닫고 목록의 문서를 열까요?')) return
    setSelected(id); setEditing(false); setConfirming(false); setError(''); setNotice('')
  }
  function edit(document?: CenterDocument) {
    if (editing && !window.confirm('저장하지 않은 입력을 닫고 다른 문서를 열까요?')) return
    setSelected(document?.id ?? null)
    setFields(document ? { templateId: document.templateId, title: document.title, subjectKind: document.subjectKind,
      subjectId: document.subjectId, period: document.period, content: document.content, resultEvaluationCompleted: document.resultEvaluationCompleted } : blank())
    setSource(''); setExpectedVersion(document?.version ?? null)
    setEditing(true); setConfirming(false); setError(''); setNotice(''); requestId.current = crypto.randomUUID()
  }
  function change(patch: Partial<CenterDocumentFields>) {
    setFields(previous => ({ ...previous, ...patch })); requestId.current = crypto.randomUUID(); setError('')
  }
  function changeTemplate(templateId: string) {
    if ((fields.content.trim() || source.trim()) && !window.confirm('양식을 바꾸면 입력한 본문과 작성틀 원문이 초기화됩니다. 바꿀까요?')) return
    change(blank(templateId)); setSource(''); setNotice('')
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; if (fields.subjectKind === 'patient' && !patients.some(p => p.id === fields.subjectId)) { setError('현재 기관의 수급자를 선택하세요.'); return }
    if (structured) { const problems = stateChangeProblems(parseStateChange(fields.content) ?? emptyStateChange(), fields.period); if (problems.length) { setError(problems.join(' ')); return } }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await view.repository.mutate(selected && expectedVersion !== null
        ? { action: 'revise', id: selected, expectedVersion, requestId: requestId.current, ...fields }
        : { action: 'create', requestId: requestId.current, ...fields })
      view.saved(result); setSelected(result.id); setExpectedVersion(result.version); setEditing(false)
      setNotice(`「${result.title}」 초안을 저장했습니다.`)
      requestId.current = crypto.randomUUID()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '저장하지 못했습니다. 입력은 보존했습니다.') }
    finally { setBusy(false) }
  }
  async function confirm() {
    if (!document) return
    setBusy(true); setError('')
    try {
      const result = await view.repository.mutate({ action: 'confirm', id: document.id,
        expectedVersion: document.version, requestId: confirmId.current })
      view.saved(result); setConfirming(false); setNotice('확정본으로 저장했습니다. 원래 작성일과 현재 버전을 보존합니다.')
      confirmId.current = crypto.randomUUID()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '확정하지 못했습니다.') }
    finally { setBusy(false) }
  }
  function stateChangeSource() {
    const record = document && document.templateId === 'state-change-record' ? parseStateChange(document.content) : null
    if (!document || !record) return null
    const patient = patients.find(p => p.id === document.subjectId)
    return { record, document, header: { centerName: '', patientName: patient?.name || '', grade: patient?.category || '', period: document.period, draft: document.status !== 'confirmed', preview } }
  }
  function downloadHml(orientation: StateChangeOrientation) {
    const source = stateChangeSource(); if (!source) return
    const url = URL.createObjectURL(new Blob([stateChangeHml(source.record, source.header, orientation)], { type: 'application/octet-stream' }))
    const link = window.document.createElement('a'); link.href = url
    link.download = `상태변화 기록지 ${source.header.patientName} ${source.document.period}${orientation === 'landscape' ? ' 가로' : ''}.hml`
    link.click(); URL.revokeObjectURL(url)
  }
  function printForm() {
    const source = stateChangeSource(); if (!source) return
    const html = stateChangePrintHtml(source.record, source.header)
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const win = window.open(url, '_blank')
    if (!win) { URL.revokeObjectURL(url); setError('새 창을 열지 못했습니다. 브라우저의 팝업 허용 후 다시 누르세요.'); return }
    win.addEventListener('load', () => { win.print(); URL.revokeObjectURL(url) })
  }
  function download() {
    if (!document) return
    // Plain text export only; never label these bytes as an official HWPX form.
    const text = `${preview ? '[가상자료 시연 · 실제 기관 기록 아님]\n' : ''}${document.title}\n대상: ${subjectLabel(document.subjectKind, document.subjectId)}\n기준월: ${document.period}\n상태: ${document.status === 'confirmed' ? '확정' : '초안'} · v${document.version}\n\n${readable(document)}`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = window.document.createElement('a'); link.href = url
    link.download = `센터문서-${document.id.slice(0, 8)}-v${document.version}.txt`
    link.click(); URL.revokeObjectURL(url)
  }

  return <section aria-label="기관 문서 업무" className="cd-documents">
    <div className="cd-toolbar"><h2>센터 문서</h2><button onClick={() => void view.reload()} disabled={busy || view.loading}>새로 조회</button>
      <button className="cd-primary" onClick={() => edit()} disabled={busy || view.loading || Boolean(view.error)}>+ 문서 작성</button></div>
    {preview && <p className="cd-mode-note">가상자료 시연 · 이 브라우저에만 보관됩니다. 기관 공동 저장이 아닙니다.</p>}
    {view.loading && <p role="status">문서 저장소를 조회하고 있습니다.</p>}
    {view.error && <div className="cd-error" role="alert"><strong>문서 저장소를 사용할 수 없습니다.</strong><p>{view.error}</p><p>저장소가 준비되기 전에는 새 문서를 등록하지 않습니다.</p></div>}
    {error && <p className="cd-error" role="alert">{error}</p>}
    {notice && <p className="cd-notice" role="status">{notice}</p>}
    <div className="cd-toolbar"><input aria-label="문서 제목 검색" placeholder="제목으로 검색" value={filter} onChange={e => setFilter(e.target.value)} />
      <select aria-label="문서 수급자 필터" value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)}><option value="">대상 전체</option>{patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input type="month" aria-label="문서 기준월 필터" value={period} onChange={e => setPeriod(e.target.value)} />
      <select aria-label="문서 상태 필터" value={status} onChange={e => setStatus(e.target.value)}><option value="">상태 전체</option><option value="draft">초안</option><option value="confirmed">확정</option></select></div>
    <CenterDocumentCoverage documents={view.documents} patients={patients} loading={view.loading} error={Boolean(view.error) || registryUnavailable} busy={busy} onOpen={openDocument} />
    <div className="cd-document-grid"><section className="cd-card">
      <div className="cd-table-wrap"><table><thead><tr><th>문서</th><th>대상</th><th>기준월</th><th>상태</th><th>버전</th></tr></thead>
        <tbody>{list.map(d => <tr key={d.id}><td><button onClick={() => openDocument(d.id)} disabled={busy}>{d.title}</button></td><td>{subjectLabel(d.subjectKind, d.subjectId)}</td><td>{d.period}</td><td>{d.status === 'confirmed' ? '확정' : '초안'}</td><td>v{d.version}</td></tr>)}</tbody></table></div>
      {!view.error && !view.loading && !list.length && <p className="cd-empty">조건에 맞는 문서가 없습니다.</p>}
    </section><section className="cd-card" aria-label="문서 상세">
      {editing ? <form className="cd-document-form" onSubmit={save}>
        <h2>{selected ? '초안 수정' : '새 문서 작성'}</h2>
        <label>양식<select aria-label="문서 양식" disabled={busy || Boolean(selected)} value={fields.templateId} onChange={e => changeTemplate(e.target.value)}>{templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <label>대상{fields.subjectKind === 'agency' ? <span>기관 공통</span> : <select aria-label="문서 수급자" required value={fields.subjectId || ''} disabled={busy || Boolean(selected)} onChange={e => change({ subjectId: e.target.value })}><option value="">수급자를 선택하세요</option>{patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</label>
        {fields.subjectKind === 'patient' && !patients.length && <p className="cd-mode-note" role="status" aria-label="문서 대상 안내">선택할 수급자가 없습니다. 수급자관리에서 등록·조회 상태를 확인한 뒤 서류함으로 돌아와 작성하세요. 대상이 준비되기 전에는 수급자 문서를 저장하지 않습니다.</p>}
        <label>제목<input aria-label="문서 제목" required maxLength={200} disabled={busy} value={fields.title} onChange={e => change({ title: e.target.value })} /></label>
        <label>기준월<input aria-label="문서 기준월" type="month" required disabled={busy} value={fields.period} onChange={e => change({ period: e.target.value })} /></label>
        {fields.subjectKind === 'patient' && <fieldset className="cd-evidence-demo"><legend>입력자료로 작성틀 준비</legend><label>관찰·기록 원문<textarea aria-label="작성틀 원문" maxLength={20000} disabled={busy} value={source} onChange={e => setSource(e.target.value)} /></label><p>원문을 보존하는 작성틀입니다. AI 분석·공단 등록·실제 서명은 실행하지 않습니다.</p><button type="button" disabled={busy || !source.trim() || !fields.subjectId} onClick={() => { try { if (fields.content && !window.confirm('현재 본문을 입력자료 작성틀로 바꿀까요?')) return; const patient = patients.find(p => p.id === fields.subjectId); if (!patient) throw new Error('수급자를 선택하세요.'); const draft = createCenterPatientDraft({ templateId: fields.templateId as CenterPatientDraftTemplateId, patientName: patient.name, sourceText: source }); change({ title: draft.title, content: draft.content }); setNotice(draft.notice) } catch (failure) { setError(failure instanceof Error ? failure.message : '작성틀을 준비하지 못했습니다.') } }}>원문을 보존한 작성틀 넣기</button></fieldset>}
        {structured ? <CenterStateChangeForm content={fields.content} disabled={busy} onChange={content => change({ content })} />
          : <label>본문<textarea aria-label="문서 본문" required maxLength={80000} disabled={busy} value={fields.content} onChange={e => change({ content: e.target.value })} /></label>}
        {fields.templateId === 'case-management' && <label className="cd-inline-label"><input type="checkbox" disabled={busy} checked={fields.resultEvaluationCompleted} onChange={e => change({ resultEvaluationCompleted: e.target.checked })} />결과평가 내용을 작성했습니다</label>}
        <p className="cd-muted">기준월은 보관·조회 단위이며 주별 기록·제공 요건의 충족 판정이 아닙니다. 초안 저장과 문서 확정·서명·제공은 별도입니다. 사례관리는 결과평가 작성 여부에 따라 반기 현황에 반영됩니다.</p>
        <footer><button type="button" disabled={busy} onClick={() => setEditing(false)}>입력 닫기</button><button className="cd-primary" disabled={busy || Boolean(view.error) || (fields.subjectKind === 'patient' && !patients.length)}>{busy ? '저장 중…' : '초안 저장'}</button></footer>
      </form> : document ? <>
        <div className="cd-document-heading"><h2>{document.title}</h2><span className="cd-badge">{document.status === 'confirmed' ? '확정' : '초안'} · v{document.version}</span></div>
        <dl><dt>대상</dt><dd>{subjectLabel(document.subjectKind, document.subjectId)}</dd><dt>기준월</dt><dd>{document.period}</dd><dt>결과평가</dt><dd>{document.templateId === 'case-management' ? document.resultEvaluationCompleted ? '작성됨' : '미작성' : '해당 없음'}</dd></dl>
        <pre className="cd-document-content">{readable(document)}</pre>
        <p className="cd-muted">최근 저장: {new Date(document.updatedAt).toLocaleString('ko-KR')}</p>
        <footer className="cd-document-actions"><button onClick={download}>내용 내려받기 (.txt)</button>{document.templateId === 'state-change-record' && parseStateChange(document.content) && <><button onClick={printForm}>서식 인쇄 (A4)</button><button onClick={() => downloadHml('landscape')}>한글 서식 내려받기 (가로 .hml)</button><button onClick={() => downloadHml('portrait')}>한글 서식 내려받기 (세로 .hml)</button></>}
          {document.status === 'draft' && <><button disabled={busy || Boolean(view.error)} onClick={() => edit(document)}>초안 수정</button><button className="cd-primary" disabled={busy || Boolean(view.error)} onClick={() => { setConfirming(true); confirmId.current = crypto.randomUUID() }}>확정 검토</button></>}
        </footer>
        {confirming && <div className="cd-confirm" role="region" aria-label="문서 확정 확인"><h3>v{document.version} 내용을 확인하셨나요?</h3><p>확정하면 이 문서의 본문을 수정할 수 없습니다. 문서 확정은 실제 서명·보호자 전달·공단 등록·평가기준 충족을 뜻하지 않습니다.</p><button disabled={busy} onClick={() => setConfirming(false)}>돌아가기</button><button disabled={busy} onClick={() => void confirm()}>내용 확인 후 확정</button></div>}
      </> : <p className="cd-empty">문서를 선택하거나 새로 작성하세요.</p>}
    </section></div>
  </section>
}
