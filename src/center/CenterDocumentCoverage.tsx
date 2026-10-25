import { useState } from 'react'
import type { CenterDocument } from '../../shared/centerDocuments'
import { stateChangeCoverage, type CoverageState } from '../../shared/centerDocumentCoverage'
import './documentCoverage.css'

const labels: Record<CoverageState, string> = { missing: '미작성', draft: '초안 기록', confirmed: '확정 문서에 기록', review: '내용 검토' }
export function CenterDocumentCoverage({ documents, patients, loading, error, busy, onOpen }: {
  documents: CenterDocument[]; patients: { id: string; name: string }[]; loading: boolean; error: boolean; busy: boolean; onOpen(id: string): void
}) {
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()))
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  return <section className="cd-document-coverage" aria-label="상태변화 월별 작성현황">
    <details><summary>상태변화 월별 작성현황</summary>
      <label>조회월<input type="month" aria-label="작성현황 조회월" value={month} onChange={e => setMonth(e.target.value)} /></label>
      <p>서식의 1~5주차 입력 칸 기준입니다. 초안·확정은 문서 상태이며 실제 서명·제공·평가 충족을 뜻하지 않습니다. 작성 의무와 달력 주차는 별도 확인합니다.</p>
      {loading ? <p role="status">작성현황에 필요한 자료를 조회 중입니다.</p> : error ? <p role="status">자료 조회를 완료하지 못해 작성현황을 표시하지 않습니다. 미작성으로 집계하지 않았습니다.</p>
        : !validMonth ? <p role="status">조회월을 선택하세요.</p> : !patients.length ? <p>조회된 수급자가 없습니다.</p>
        : <div className="cd-coverage-scroll" role="region" aria-label="월별 작성현황 표" tabIndex={0}><table><caption>{month} 상태변화기록지 작성 여부</caption><thead><tr><th scope="col">수급자 · 원문 문서</th>{[1, 2, 3, 4, 5].map(n => <th key={n} scope="col">서식 {n}주차</th>)}</tr></thead>
          <tbody>{[...patients].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(p => {
            const coverage = stateChangeCoverage(documents, p.id, month)
            return <tr key={p.id}><th scope="row"><span>{p.name}</span><small>문서 {coverage.documents.length}건</small>{coverage.review && <small>주차 또는 버전 확인 필요</small>}{coverage.documents.map(d => <button key={d.id} disabled={busy} onClick={() => onOpen(d.id)} aria-label={`현황에서 ${d.title} 열기`}>{d.title} · {d.status === 'confirmed' ? '확정' : '초안'} v{d.version}</button>)}</th>
              {coverage.weeks.map((state, i) => <td key={i}><span className={`cd-coverage-state cd-coverage-${state}`}>{labels[state]}</span></td>)}</tr>
          })}</tbody></table></div>}
    </details>
  </section>
}
