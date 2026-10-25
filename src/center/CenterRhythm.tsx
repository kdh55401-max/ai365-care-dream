import { Fragment, useEffect, useMemo, useState } from 'react'
import type { CenterDocument } from '../../shared/centerDocuments'
import type { CenterVisit } from '../../shared/centerOperations'
import { buildCenterRhythm, matchesRhythmFilter, recognitionChip, RHYTHM_FILTERS, rhythmCsv, rhythmFilterCounts, rhythmPrintHtml, sortRhythmLanes, type RecognitionEndValue, type RhythmFilter, type RhythmLane, type RhythmResult, type RhythmService, type RhythmSortKey } from '../../shared/centerRhythm'
import type { StoredWeekReview, WeekReviewInput } from '../../shared/centerWeekReviews'
import type { Person } from './model'
import { BatchReview, WeekReviewPanel, type BatchTarget } from './CenterWeekReviews'
import { createDemoPatientRecognitionsRepository, serverPatientRecognitionsRepository } from './patientRecognitionsRepo'
import { createDemoWeekReviewsRepository, serverWeekReviewsRepository } from './weekReviewsRepo'
import './rhythm.css'

const EVAL_24_4 = '방문요양 평가 24번 ④: 급여제공직원은 수급자 상태변화를 주 1회 이상 충실하게 기록한다. 기록 주 수는 사실 숫자이며 공단의 평가 판정이 아닙니다.'
const SERVICES: RhythmService[] = ['', '요양', '목욕', '간호']
const COLUMNS: { key: RhythmSortKey; label: string; hint?: string }[] = [
  { key: 'name', label: '수급자' }, { key: 'worker', label: '담당' }, { key: 'visits', label: '방문' }, { key: 'weeks', label: '기록 주', hint: EVAL_24_4 }, { key: 'priority', label: '주별' },
  { key: 'review', label: '확인', hint: '센터장이 주별 기록을 읽고 남긴 확인(대기·유지·변화·확인 못함 주 수)' },
  { key: 'missing', label: '미작성 주' }, { key: 'lastRecord', label: '마지막 기록' }, { key: 'days', label: '경과일' }, { key: 'expression', label: '표현 점검', hint: "'특이사항 없음'만 적었거나 너무 짧은 기록의 수" }, { key: 'recognition', label: '인정 만료' },
]
const weekKind = (w: RhythmLane['weeks'][number]) => w.state === 'recorded'
  ? (w.review.status === 'confirmed' ? (w.review.value === 'same_as_usual' ? 'same' : w.review.value === 'changed' ? 'changed' : 'obs') : w.review.status === 'stale' ? 'stale' : w.review.status === 'unreviewed' ? 'wait' : 'recorded')
  : w.review.status === 'excused' ? 'obs' : w.state
const WEEK_LABEL: Record<string, string> = { same: '평소와 같음으로 확인', changed: '변화 있음으로 확인', obs: '확인 못함', stale: '확인 뒤 기록이 바뀜(다시 확인 필요)', wait: '기록 있음 · 센터장 확인 대기', recorded: '기록 있음', missing: '미작성', pending: '기록 대기', none: '방문 계획 없음' }
const WIDTH = 660
const todayKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())

function LaneChart({ lane, chart }: { lane: RhythmLane; chart: RhythmResult }) {
  const dw = (WIDTH - 8) / chart.daysInMonth; const x = (day: number) => 4 + (day - 0.5) * dw
  return <svg viewBox={`0 0 ${WIDTH} 54`} width="100%" role="img" aria-label={`${lane.name} 방문 ${lane.visits.length}회, 기록 ${lane.recordDays.length}건`}>
    {chart.weeks.map((week, i) => <g key={week.startDay}>
      {i > 0 && <line x1={4 + (week.startDay - 1) * dw} x2={4 + (week.startDay - 1) * dw} y1="2" y2="52" className="cr-weekline" />}
      {lane.weeks[i].state === 'missing' && <rect x={4 + (week.startDay - 1) * dw + 2} y="5" width={(week.endDay - week.startDay + 1) * dw - 4} height="44" rx="4" className="cr-missing"><title>{i + 1}주차 미작성</title></rect>}
      {lane.weeks[i].state === 'pending' && <rect x={4 + (week.startDay - 1) * dw + 2} y="5" width={(week.endDay - week.startDay + 1) * dw - 4} height="44" rx="4" className="cr-pending"><title>{i + 1}주차 기록 대기</title></rect>}
    </g>)}
    {lane.visits.map((v, i) => <circle key={i} cx={x(v.day)} cy="40" r={v.planned ? 3.6 : 2.8} className={v.planned ? 'cr-visit-planned' : 'cr-visit'}><title>{v.day}일 {v.planned ? '예정 방문' : '방문'}</title></circle>)}
    {lane.recordDays.map(day => <polygon key={day} points={`${x(day)},14 ${x(day) + 7},29 ${x(day) - 7},29`} className="cr-record"><title>{day}일 상태변화 기록</title></polygon>)}
    {chart.todayDay && <line x1={x(chart.todayDay)} x2={x(chart.todayDay)} y1="0" y2="54" className="cr-today"><title>오늘</title></line>}
  </svg>
}

export function CenterRhythm({ people, visits, documents, loading, blocked, preview }: { people: Person[]; visits: CenterVisit[]; documents: CenterDocument[]; loading: boolean; blocked: string; preview: boolean }) {
  const today = todayKey()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [monthNumber, setMonthNumber] = useState(Number(today.slice(5, 7)))
  const [service, setService] = useState<RhythmService>('')
  const [filter, setFilter] = useState<RhythmFilter>('all')
  const [sort, setSort] = useState<{ key: RhythmSortKey; direction: 'asc' | 'desc' }>({ key: 'priority', direction: 'asc' })
  const [open, setOpen] = useState('')
  const [message, setMessage] = useState('')
  const [recognitions, setRecognitions] = useState<Record<string, RecognitionEndValue>>({})
  const [reviews, setReviews] = useState<Record<string, { version: number; entries: StoredWeekReview[] }>>({})
  const [reviewState, setReviewState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchProgress, setBatchProgress] = useState('')
  const month = `${year}-${String(monthNumber).padStart(2, '0')}`
  const reviewRepo = useMemo(() => preview ? createDemoWeekReviewsRepository(window.localStorage) : serverWeekReviewsRepository, [preview])
  const reviewEntries = useMemo(() => Object.fromEntries(Object.entries(reviews).map(([id, v]) => [id, v.entries])), [reviews])
  const chart = useMemo(() => buildCenterRhythm({ people, visits, documents, month, today, service, reviews: reviewEntries, reviewsAvailable: reviewState === 'ready' }), [people, visits, documents, month, today, service, reviewEntries, reviewState])
  const patientKey = useMemo(() => people.filter(p => p.kind === 'patient').map(p => p.id).sort().join(','), [people])

  async function loadReviews(isActive: () => boolean = () => true) {
    try {
      const result = await reviewRepo.inspectMonth(month); if (!isActive()) return
      setReviews(Object.fromEntries(result.patients.map(p => [p.patientId, { version: p.version, entries: p.entries }]))); setReviewState('ready'); setReviewMessage('')
    } catch (failure) {
      if (!isActive()) return
      setReviews({}); setReviewState('unavailable')
      setReviewMessage(`주별 확인을 사용할 수 없습니다: ${failure instanceof Error ? failure.message : '조회 실패'} 확인 기능은 데이터베이스에 2026-10-25-center-week-reviews.sql을 적용한 뒤 쓸 수 있습니다.`)
    }
  }
  useEffect(() => { if (blocked) return; let active = true; setReviewState('loading'); void loadReviews(() => active); return () => { active = false } }, [month, reviewRepo, blocked]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (blocked || !patientKey) return
    let active = true; const ids = patientKey.split(','); const repo = preview ? createDemoPatientRecognitionsRepository(window.localStorage) : serverPatientRecognitionsRepository
    setRecognitions(Object.fromEntries(ids.map(id => [id, 'loading'])))
    const queue = [...ids]
    async function worker() {
      for (let id = queue.shift(); id; id = queue.shift()) {
        let value: RecognitionEndValue
        try { const state = await repo.inspect(id); value = state.entries.find(e => e.id === state.activeId && !e.archived)?.periodEnd || null } catch { value = 'error' }
        if (!active) return; const done = value; setRecognitions(previous => ({ ...previous, [id!]: done }))
      }
    }
    void Promise.all([worker(), worker(), worker(), worker()])
    return () => { active = false }
  }, [patientKey, preview, blocked])
  const counts = useMemo(() => rhythmFilterCounts(chart.lanes, recognitions, today), [chart.lanes, recognitions, today])
  const rows = useMemo(() => sortRhythmLanes(chart.lanes.filter(l => matchesRhythmFilter(l, filter, recognitions[l.patientId], today)), sort.key, sort.direction, recognitions), [chart.lanes, filter, recognitions, today, sort])
  const batchTargets: BatchTarget[] = useMemo(() => reviewState !== 'ready' ? [] : rows.filter(l => !l.missingWeeks.length && !l.expressionChecks).map(l => ({ lane: l, weeks: l.weeks.filter(w => w.review.status === 'unreviewed') })).filter(t => t.weeks.length), [rows, reviewState])

  function addSaved(patientId: string, version: number, saved: StoredWeekReview[]) { setReviews(previous => ({ ...previous, [patientId]: { version, entries: [...(previous[patientId]?.entries ?? []), ...saved] } })) }
  async function saveReview(patientId: string, entry: WeekReviewInput) {
    setReviewBusy(true); setMessage('')
    try { const result = await reviewRepo.save({ requestId: crypto.randomUUID(), patientId, expectedVersion: reviews[patientId]?.version ?? 0, entries: [entry] }); addSaved(patientId, result.version, result.saved); setMessage('주별 확인을 저장했습니다.') }
    catch (failure) { await loadReviews(); throw failure }
    finally { setReviewBusy(false) }
  }
  async function runBatch() {
    setReviewBusy(true); setMessage(''); let done = 0; const failures: string[] = []
    for (const target of batchTargets) {
      try {
        const patientId = target.lane.patientId
        const entries: WeekReviewInput[] = target.weeks.map(w => ({ id: crypto.randomUUID(), weekStart: w.weekStart, value: 'same_as_usual', areas: [], note: '', digest: w.digest, documentId: w.documentId, batch: true }))
        const result = await reviewRepo.save({ requestId: crypto.randomUUID(), patientId, expectedVersion: reviews[patientId]?.version ?? 0, entries }); addSaved(patientId, result.version, result.saved); done += entries.length
      } catch (failure) { failures.push(`${target.lane.name}: ${failure instanceof Error ? failure.message : '저장 실패'}`) }
      setBatchProgress(`${done}주 저장`)
    }
    if (failures.length) await loadReviews()
    setReviewBusy(false); setBatchOpen(false); setBatchProgress('')
    setMessage(failures.length ? `일괄 확인 중 ${done}주를 저장했고 ${failures.length}명은 저장하지 못했습니다(${failures.join('; ')}). 다시 조회했으니 남은 주를 확인하세요.` : `평소와 같음 ${done}주를 일괄 확인으로 저장했습니다.`)
  }
  function changeSort(key: RhythmSortKey) { setSort(previous => key === 'priority' ? { key, direction: 'asc' } : previous.key === key ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'name' || key === 'worker' ? 'asc' : 'desc' }) }
  function print() {
    const url = URL.createObjectURL(new Blob([rhythmPrintHtml(rows, month, service, preview)], { type: 'text/html;charset=utf-8' }))
    const win = window.open(url, '_blank'); if (!win) { URL.revokeObjectURL(url); setMessage('새 창을 열지 못했습니다. 팝업을 허용한 뒤 다시 누르세요.'); return }
    win.addEventListener('load', () => { win.print(); URL.revokeObjectURL(url) })
  }
  function download() {
    const url = URL.createObjectURL(new Blob([rhythmCsv(rows)], { type: 'text/csv;charset=utf-8' }))
    const link = window.document.createElement('a'); link.href = url; link.download = `방문기록현황-${month}.csv`; link.click(); URL.revokeObjectURL(url)
  }
  const ariaSort = (key: RhythmSortKey) => sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
  const reviewCell = (lane: RhythmLane) => reviewState === 'loading' ? '…' : reviewState === 'unavailable' ? '—' : [lane.reviewPending.length ? `대기 ${lane.reviewPending.length}` : '', lane.sameWeeks ? `유지 ${lane.sameWeeks}` : '', lane.changedWeeks.length ? `변화 ${lane.changedWeeks.length}` : '', lane.notObservedWeeks ? `확인 못함 ${lane.notObservedWeeks}` : ''].filter(Boolean).join(' · ')

  return <section className="cr-card" aria-label="한 달 방문·기록 현황">
    <div className="cr-head"><h2>한 달 방문·기록 현황</h2><select aria-label="연도" value={year} onChange={e => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map(y => <option key={y} value={y}>{y}년</option>)}</select></div>
    <div className="cr-months" role="group" aria-label="월 선택">{Array.from({ length: 12 }, (_, i) => i + 1).map(m => <button key={m} aria-pressed={m === monthNumber} onClick={() => setMonthNumber(m)}>{m}월</button>)}</div>
    <div className="cr-tools">
      <span className="cr-seg" role="group" aria-label="서비스">{SERVICES.map(s => <button key={s || 'all'} aria-pressed={service === s} onClick={() => setService(s)}>{s || '전체'}</button>)}</span>
      <button onClick={() => { setBatchOpen(true); setBatchProgress('') }} disabled={loading || reviewBusy || !batchTargets.length} title="미작성·표현 점검이 없는 수급자의 확인 대기 주를 평소와 같음으로 한 번에 확인">평소와 같음 일괄 확인 ({batchTargets.length}명 {batchTargets.reduce((n, t) => n + t.weeks.length, 0)}주)</button>
      <button onClick={print} disabled={loading || !rows.length}>출력(수급자 이름순)</button><button onClick={download} disabled={loading || !rows.length}>엑셀 다운로드(CSV)</button>
    </div>
    {message && <p className="cr-note" role="status">{message}</p>}
    {reviewState === 'unavailable' && <p className="cr-note cr-warn" role="alert">{reviewMessage}</p>}
    {batchOpen && <BatchReview targets={batchTargets} busy={reviewBusy} progress={batchProgress} onRun={() => void runBatch()} onCancel={() => setBatchOpen(false)} />}
    {blocked ? <p className="cr-note" role="alert">{blocked} 조회가 끝나기 전에는 미작성 여부를 표시하지 않습니다.</p> : loading ? <p className="cr-note" role="status">방문과 기록을 조회하고 있습니다.</p> : !chart.lanes.length ? <p className="cr-note">표시할 수급자가 없습니다. 수급자관리에서 수급자를 등록하세요.</p> : <>
      <div className="cr-filters" role="group" aria-label="보기 거르기">{RHYTHM_FILTERS.map(f => <button key={f.id} aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setOpen('') }}>{f.label}<b>{counts[f.id]}</b></button>)}</div>
      <p className="cr-summary" role="status">{RHYTHM_FILTERS.find(f => f.id === filter)!.label} {rows.length}명 <span>· 열 이름을 누르면 정렬, 줄을 누르면 한 달 타임라인과 주별 확인 창이 열립니다</span></p>
      <div className="cr-table-wrap"><table className="cr-table">
        <thead><tr>{COLUMNS.map(c => <th key={c.label} scope="col" aria-sort={c.label === '주별' ? undefined : ariaSort(c.key)} title={c.hint}><button onClick={() => changeSort(c.key)}>{c.label}{sort.key === c.key && c.key !== 'priority' ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>)}</tr></thead>
        <tbody>{rows.map(lane => {
          const chip = recognitionChip(recognitions[lane.patientId] ?? 'loading', today); const expanded = open === lane.patientId
          return <Fragment key={lane.patientId}>
            <tr className={expanded ? 'cr-open' : ''}>
              <th scope="row"><button className="cr-rowbtn" aria-expanded={expanded} onClick={() => setOpen(expanded ? '' : lane.patientId)}>{expanded ? '▾' : '▸'} {lane.name}</button></th>
              <td>{lane.workerName}</td><td className="cr-num">{lane.visits.length}</td>
              <td className="cr-num" title={EVAL_24_4}>{lane.recordedWeeks}/{lane.applicableWeeks}</td>
              <td><span className="cr-weeks" role="img" aria-label={lane.weeks.map((w, i) => `${i + 1}주차 ${WEEK_LABEL[weekKind(w)]}`).join(', ')}>{lane.weeks.map((w, i) => <i key={i} className={`cr-w cr-w-${weekKind(w)}`} title={`${i + 1}주차 ${WEEK_LABEL[weekKind(w)]}`} />)}</span></td>
              <td className={lane.reviewPending.length ? 'cr-warn' : ''} title={reviewState === 'unavailable' ? reviewMessage : undefined}>{reviewCell(lane)}</td>
              <td className={lane.missingWeeks.length ? 'cr-bad' : ''}>{lane.missingWeeks.map(n => `${n}주차`).join(', ')}</td>
              <td>{lane.lastRecord}</td><td className={`cr-num${lane.daysSinceLast !== null && lane.daysSinceLast > 7 ? ' cr-bad' : ''}`}>{lane.daysSinceLast ?? ''}</td>
              <td className={`cr-num${lane.expressionChecks ? ' cr-warn' : ''}`}>{lane.expressionChecks || ''}</td>
              <td className={chip.tone === 'danger' ? 'cr-bad' : chip.tone === 'warning' ? 'cr-warn' : ''}>{chip.label.replace('인정 만료 ', '').replace('인정 정보 ', '')}</td>
            </tr>
            {expanded && <tr className="cr-detail"><td colSpan={COLUMNS.length}><p>{lane.summary}</p><div className="cr-axis" aria-hidden="true">{chart.weeks.map((w, i) => <span key={w.startDay} title={`${w.startDay}~${w.endDay}일`} style={{ left: `${((w.startDay - 1) / chart.daysInMonth) * 100}%`, width: `${((w.endDay - w.startDay + 1) / chart.daysInMonth) * 100}%` }}>{i + 1}주차</span>)}</div><LaneChart lane={lane} chart={chart} />
              <WeekReviewPanel lane={lane} month={month} busy={reviewBusy} enabled={reviewState === 'ready'} reason={reviewState === 'loading' ? '주별 확인을 조회하고 있습니다.' : reviewMessage} onSave={saveReview} /></td></tr>}
          </Fragment>
        })}</tbody>
      </table></div>
      {!rows.length && <p className="cr-note">이 조건에 해당하는 수급자가 없습니다.</p>}
      <ul className="cr-legend" aria-label="범례">
        <li><i className="cr-w cr-w-wait" />기록 있음·확인 대기</li><li><i className="cr-w cr-w-same" />평소와 같음 확인</li><li><i className="cr-w cr-w-changed" />변화 있음 확인</li><li><i className="cr-w cr-w-stale" />확인 뒤 기록이 바뀜</li><li><i className="cr-w cr-w-obs" />확인 못함(사유)</li>
        <li><i className="cr-w cr-w-missing" />미작성 주</li><li><i className="cr-w cr-w-pending" />이번 주 기록 대기</li><li><i className="cr-w cr-w-none" />방문 계획 없음·아직 안 온 주</li>
        <li><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3" className="cr-visit" /></svg>방문(타임라인)</li><li><svg width="14" height="14" aria-hidden="true"><polygon points="7,2 12,12 2,12" className="cr-record" /></svg>상태변화 기록(타임라인)</li>
      </ul>
      <p className="cr-note">방문은 새 앱의 방문일정, 기록은 서류함의 상태변화기록지(일자가 입력된 주)를 반영합니다. 기록 주는 사실 숫자이고 공단의 평가 판정이 아니며, 기록이 없는 것은 '유지'가 아닙니다. '평소와 같음'·'변화 있음'은 센터장이 주별 기록을 읽고 확인한 주에만 표시하며, 요양보호사 개인 평가에 쓰지 않습니다. 인정 만료의 노랑은 90일 이내라는 임시 기준입니다.{preview ? ' 가상자료 시연 데이터입니다.' : ''}</p>
    </>}
  </section>
}
