import { useState } from 'react'
import { CENTER_EVALUATION_24_CRITERIA, CENTER_EVIDENCE_CHECK_LABELS, evaluateCenterEvidence, type CenterEvaluationEvidence } from '../../shared/centerEvaluationEvidence'
import type { Person } from './model'
import type { CenterDocumentStart, CenterDocumentView } from './CenterDocuments'

type Scenario = 'unconnected' | 'missing' | 'draft' | 'checked' | 'changed' | 'withdrawn' | 'future'
const scenarios: { id: Scenario; label: string }[] = [
  { id: 'unconnected', label: '증빙 미연결' }, { id: 'missing', label: '증빙 부족' },
  { id: 'draft', label: 'AI 초안만 작성' }, { id: 'checked', label: '필수 증빙·검토 확인' },
  { id: 'changed', label: '확인 후 문서 개정' }, { id: 'withdrawn', label: '증빙 철회' }, { id: 'future', label: '미도래' },
]
export function CenterEvaluationEvidence({ preview, year, people, peopleLoading, peopleError, view, openDocuments }: {
  preview: boolean; year: number; people: Person[]; peopleLoading: boolean; peopleError: string;
  view: CenterDocumentView; openDocuments(start?: CenterDocumentStart): void;
}) {
  const [personId, setPersonId] = useState('')
  const [scenario, setScenario] = useState<Scenario>('unconnected')
  const patients = people.filter(p => p.kind === 'patient')
  const selected = patients.find(p => p.id === personId)
  const demo = preview && scenario !== 'unconnected'
  const scope = { organizationCode: demo ? 'SYNTHETIC-ONLY' : '', personId: demo ? 'synthetic-person' : selected?.id || '', period: `${year}-review-scope`, ruleVersion: demo ? 'synthetic-rule-v1' : '2026-manual-pending-qna' }
  const rows = CENTER_EVALUATION_24_CRITERIA.map(criterion => {
    // These fixtures never enter the institution repository or contain a signature image.
    const evidence: CenterEvaluationEvidence[] = demo && !['missing', 'future'].includes(scenario) ? [{
      id: `synthetic-${criterion.id}`, criterionId: criterion.id, scope, version: scenario === 'changed' ? 2 : 1,
      digest: (scenario === 'changed' ? 'b' : 'a').repeat(64), origin: scenario === 'draft' ? 'ai_draft' : 'human_record',
      state: scenario === 'draft' ? 'draft' : 'recorded', availability: scenario === 'withdrawn' ? 'withdrawn' : 'active',
      checks: Object.fromEntries(criterion.requiredChecks.map(key => [key, scenario === 'draft' ? 'unverified' as const : 'verified' as const])),
      review: scenario === 'draft' ? undefined : { reviewerId: 'synthetic-reviewer', evidenceVersion: 1, digest: 'a'.repeat(64), ruleVersion: scope.ruleVersion },
    }] : []
    return { criterion, result: evaluateCenterEvidence({ scope, criterionId: criterion.id, ruleVerified: demo,
      sourceState: demo ? 'loaded' : 'unavailable', dueState: demo ? scenario === 'future' ? 'future' : 'due' : 'unknown', evidence,
      dependencyState: criterion.dependsOn ? scenario === 'checked' ? 'satisfied' : scenario === 'missing' || scenario === 'withdrawn' ? 'missing' : scenario === 'draft' || scenario === 'changed' ? 'review_required' : 'unknown' : undefined }) }
  })
  const related = selected ? view.documents.filter(d => d.subjectKind === 'patient' && d.subjectId === selected.id && d.period.startsWith(`${year}-`)) : []
  return <section className="cd-evidence" aria-label="평가 기준별 증빙 준비">
    <header className="cd-card"><h2>{year}년 평가 기준별 증빙 준비</h2>
      <p>방문요양 24 · 급여제공 결과평가의 네 세부 항목부터 연결합니다.</p>
      <p className="cd-mode-note">현재는 기준·증빙 연결을 개발 중입니다. 공단 최신 개정·Q&A와 실제 증빙 저장소의 확인 전에는 운영 자료를 충족으로 판정하지 않습니다.</p>
      {year !== 2026 && <p role="status">선택 연도의 검증된 기준이 없습니다. 아래는 2026년 분석 참고이며 해당 연도 판정에 적용하지 않습니다.</p>}
      <div className="cd-evidence-legend"><span>● 빨강: 확인된 증빙 부족</span><span>● 검토 필요: 초안·서명·개정 확인</span><span>● 정상: 현재 증빙·검토 확인</span><span>● 확인 필요: 미연결·미검증</span></div>
      <label className="cd-evidence-person">증빙을 확인할 수급자<select aria-label="평가 증빙 수급자" value={selected?.id || ''} disabled={peopleLoading || Boolean(peopleError) || demo} onChange={e => setPersonId(e.target.value)}><option value="">수급자를 선택하세요</option>{patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {peopleLoading ? <p role="status">수급자 조회 중…</p> : peopleError ? <p role="alert" className="cd-error">수급자 조회 실패: {peopleError}</p> : !patients.length && <p>등록된 수급자가 없습니다. 수급자관리에서 등록한 뒤 연결할 수 있습니다.</p>}
      {preview && <fieldset className="cd-evidence-demo"><legend>가상 상태 변화 시연</legend><p>별도 가상 인물·기준으로 색상과 사유만 시연합니다. 실제 수급자, 문서, 서명, 승인에는 반영·저장되지 않습니다.</p><div>{scenarios.map(item => <button key={item.id} type="button" aria-pressed={scenario === item.id} onClick={() => setScenario(item.id)}>{item.label}</button>)}</div>{demo && <p role="status">가상 상태 시연 중 · 실제 기준 검증이나 증빙 확인 완료가 아닙니다.</p>}</fieldset>}
    </header>
    {rows.map(({ criterion, result }, index) => <article className={`cd-card cd-evidence-row cd-evidence-${result.tone}`} key={criterion.id} aria-label={`24-${index + 1} ${criterion.title}`}>
      <div className="cd-evidence-heading"><h3>24-{index + 1} {criterion.title}</h3><strong className="cd-evidence-status" data-status={result.status}>{demo ? '가상 · ' : ''}{result.label}</strong></div>
      <p>{criterion.summary}</p><p className="cd-muted">확인 방법: {criterion.methods.join(' · ')} · 기록은 종이 서류에만 한정하지 않습니다.</p>
      <ul className="cd-evidence-checks">{criterion.requiredChecks.map(key => <li key={key}>{CENTER_EVIDENCE_CHECK_LABELS[key]}</li>)}</ul>
      <ul>{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      <p className="cd-muted">분석 출처: 2026 방문요양 수정 매뉴얼 PDF 순서 {criterion.sourcePages.join('·')}쪽. 최신 Q&A 대조 중.</p>
      <button type="button" disabled={demo || !selected} onClick={() => openDocuments({ personId: selected!.id, templateId: index === 3 ? 'state-change-record' : index === 2 ? 'service-record' : 'service-result-evaluation' })}>대상 수급자 기록 작성 →</button>
    </article>)}
    <section className="cd-card"><h3>선택 수급자의 저장 문서</h3>
      <p>문서 확정과 평가 증빙 확인은 별개입니다. 제공 증빙·서명·공단 전송 확인은 아직 연결 전입니다.</p>
      {view.error ? <p role="alert" className="cd-error">문서 조회 실패: {view.error}</p> : view.loading ? <p role="status">문서 조회 중…</p> : !selected ? <p>수급자를 선택하면 해당 수급자의 저장 문서만 표시합니다.</p> : !related.length ? <p>선택한 수급자의 {year}년 저장 문서가 없습니다. 이 결과만으로 평가 미충족을 확정하지 않습니다.</p> : <ul>{related.map(d => <li key={d.id}>{d.title} · {d.period} · {d.status === 'confirmed' ? '문서 확정' : '초안'} · v{d.version}</li>)}</ul>}
      <a href="https://ezcare.easyms.co.kr/ASSM.ez?Y=2026&no=24" target="_blank" rel="noreferrer">이지케어 24번 연관메뉴·서식 참고</a>
    </section>
  </section>
}
