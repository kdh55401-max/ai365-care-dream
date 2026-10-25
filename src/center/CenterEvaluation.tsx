import { useState } from 'react'
import { CENTER_DOCUMENT_TEMPLATES, summarizeCenterDocuments } from '../../shared/centerDocuments'
import type { CenterDocumentStart, CenterDocumentView } from './CenterDocuments'
import type { Person } from './model'
import { CenterEvaluationEvidence } from './CenterEvaluationEvidence'

const tabs = ['평가서류 작성 현황', '서류함(평가서류 작성)', '의무교육 수료 현황', '평가매뉴얼&자가진단'] as const
export function CenterEvaluation({ view, openDocuments, preview = false, people = [], peopleLoading = false, peopleError = '' }: { view: CenterDocumentView; openDocuments(start?: CenterDocumentStart): void; preview?: boolean; people?: Person[]; peopleLoading?: boolean; peopleError?: string }) {
  const [tab, setTab] = useState<typeof tabs[number]>(tabs[0])
  const [year, setYear] = useState(() => Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date())))
  const summary = summarizeCenterDocuments(view.documents, year)
  const rows = view.documents.filter(d => d.period.startsWith(`${year}-`))
  return <section aria-label="기관평가 문서 관리">
    <div className="cd-toolbar"><label>조회 연도 <input aria-label="평가 조회 연도" type="number" min="1900" max="9999" value={year} onChange={e => { if (Number(e.target.value) >= 1900 && Number(e.target.value) <= 9999) setYear(Number(e.target.value)) }} /></label>
      <button onClick={() => void view.reload()} disabled={view.loading}>새로 조회</button></div>
    <div className="cd-tabs" role="tablist" aria-label="기관평가 업무">{tabs.map((name, i) => <button key={name} id={`evaluation-tab-${i}`} role="tab" aria-selected={tab === name} aria-controls={`evaluation-panel-${i}`} onClick={() => setTab(name)}>{name}</button>)}</div>
    <section role="tabpanel" id={`evaluation-panel-${tabs.indexOf(tab)}`} aria-labelledby={`evaluation-tab-${tabs.indexOf(tab)}`} className="cd-tab-panel">
      {tab === tabs[0] && <>
        <p>작성 현황과 확정 상태를 구분합니다. 평가 적합성이나 점수를 판정하지 않습니다.</p>
        {view.error ? <p role="alert" className="cd-error">자료를 조회하지 못했습니다. {view.error}</p> : view.loading ? <p role="status">작성 현황 조회 중…</p> : <>
          <div className="cd-summary-counts"><span>전체 문서 <strong>{rows.length}건</strong></span><span>확정 <strong>{rows.filter(d => d.status === 'confirmed').length}건</strong></span><span>초안 <strong>{rows.filter(d => d.status === 'draft').length}건</strong></span></div>
          {summary.filter(row => CENTER_DOCUMENT_TEMPLATES.find(t => t.id === row.templateId)?.subjectKinds.includes('agency')).map(row => <section className="cd-card cd-evaluation-row" key={row.templateId}>
            <h2>{CENTER_DOCUMENT_TEMPLATES.find(t => t.id === row.templateId)?.label}</h2>
            {row.templateId === 'case-management' && <p className="cd-muted">결과평가 작성 여부가 확인된 문서만 반기 현황에 포함합니다. 초안·확정 건수가 모두 포함됩니다.</p>}
            <div className="cd-periods">{row.periods.map(p => <button key={p.key} onClick={() => openDocuments()}><span>{p.label}</span><b>{p.count ? `${p.count}건` : '미작성'}</b></button>)}</div>
          </section>)}
        </>}
      </>}
      {tab === tabs[1] && <section className="cd-card"><h2>{year}년 기관 서류함</h2><p>사례관리·직원회의록·교육일지를 작성하고 초안과 확정 상태를 관리합니다.</p><button onClick={() => openDocuments()}>문서 작성·조회 열기 →</button></section>}
      {tab === tabs[2] && <section className="cd-card"><h2>의무교육 수료 현황</h2><p>교육일지 작성과 직원별 수료 여부는 별도 기록입니다.</p><p className="cd-muted">직원별 교육일·수료증·수료일 저장소를 아직 연결하지 않았습니다. 교육일지 수를 수료 인원으로 표시하지 않습니다.</p></section>}
      {tab === tabs[3] && <CenterEvaluationEvidence key={`${preview}:${year}`} preview={preview} year={year} people={people} peopleLoading={peopleLoading} peopleError={peopleError} view={view} openDocuments={openDocuments} />}
    </section>
  </section>
}
