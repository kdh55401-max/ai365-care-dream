import { useState } from 'react'
import { STATE_CHANGE_CHECKS, type StateChangeCheckKey } from '../../shared/centerStateChange'
import type { RhythmLane, RhythmWeek } from '../../shared/centerRhythm'
import { WEEK_REVIEW_LABELS, WEEK_REVIEW_VALUES, type WeekReviewInput, type WeekReviewValue } from '../../shared/centerWeekReviews'

export const REVIEW_STATUS_LABEL = { confirmed: '확인됨', stale: '다시 확인 필요', unreviewed: '확인 대기', excused: '확인 못함(사유)', none: '' } as const
const dateLabel = (week: RhythmWeek, month: string) => `${Number(month.slice(5))}/${week.startDay}~${Number(month.slice(5))}/${week.endDay}`
const checksOf = (checks: Record<StateChangeCheckKey, boolean>) => STATE_CHANGE_CHECKS.filter(c => checks[c.key]).map(c => c.label).join(', ') || '체크 없음'

function WeekReviewRow({ week, index, month, busy, onSave }: { week: RhythmWeek; index: number; month: string; busy: boolean; onSave(entry: WeekReviewInput): Promise<void> }) {
  const recorded = week.state === 'recorded'
  const [value, setValue] = useState<WeekReviewValue>(week.review.value ?? (recorded ? 'same_as_usual' : 'not_observed'))
  const [areas, setAreas] = useState<StateChangeCheckKey[]>((week.review.areas as StateChangeCheckKey[]) ?? [])
  const [note, setNote] = useState(week.review.note)
  const [error, setError] = useState('')
  const allowed = recorded ? WEEK_REVIEW_VALUES : (['not_observed'] as const)
  async function save() {
    setError('')
    if (value === 'changed' && !areas.length) { setError('변화 있음은 변화가 있었던 영역을 하나 이상 고르세요.'); return }
    if (value === 'not_observed' && !note.trim()) { setError('확인 못함은 사유를 메모에 남기세요. 예: 입원, 부재'); return }
    try { await onSave({ id: crypto.randomUUID(), weekStart: week.weekStart, value, areas: value === 'changed' ? areas : [], note: note.trim(), digest: recorded ? week.digest : '', documentId: week.documentId, batch: false }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '저장하지 못했습니다.') }
  }
  return <div className="cr-review-week" role="group" aria-label={`${index + 1}주차 확인`}>
    <div className="cr-review-head"><strong>{index + 1}주차 · {dateLabel(week, month)}</strong>{week.review.status !== 'none' && <span className={`cr-status cr-status-${week.review.status}`}>{REVIEW_STATUS_LABEL[week.review.status]}{week.review.value ? ` · ${WEEK_REVIEW_LABELS[week.review.value]}` : ''}</span>}</div>
    {recorded ? week.records.map((record, i) => <div key={i} className="cr-record-text"><span>{record.date.slice(5).replace('-', '/')} · 체크: {checksOf(record.checks)}</span><p>특이사항 및 조치: {record.remarks.trim() || '-'}</p><p>급여제공결과: {record.result.trim() || '-'}</p></div>) : <p className="cr-record-text">이 주에는 상태변화 기록이 없습니다. 입원·부재 등 사유가 있으면 남길 수 있습니다.</p>}
    {week.review.status === 'stale' && <p className="cr-warn">확인한 뒤 기록 내용이 바뀌었습니다. 다시 읽고 확인하세요.</p>}
    {week.review.at && <p className="cr-note">마지막 확인 {week.review.reviewer} · {new Date(week.review.at).toLocaleDateString('ko-KR')}{week.review.note ? ` · ${week.review.note}` : ''}</p>}
    <div className="cr-review-values" role="radiogroup" aria-label="확인 값">{allowed.map(v => <label key={v}><input type="radio" name={`rv-${week.weekStart}`} checked={value === v} disabled={busy} onChange={() => setValue(v)} />{WEEK_REVIEW_LABELS[v]}</label>)}</div>
    {value === 'changed' && <div className="cr-review-areas" role="group" aria-label="변화가 있었던 영역">{STATE_CHANGE_CHECKS.map(c => <label key={c.key}><input type="checkbox" checked={areas.includes(c.key)} disabled={busy} onChange={e => setAreas(previous => e.target.checked ? [...previous, c.key] : previous.filter(k => k !== c.key))} />{c.label}</label>)}</div>}
    <label className="cr-review-note">메모 (500자 이내){value === 'not_observed' ? ' · 사유 필수' : ''}<input maxLength={500} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
    {error && <p className="cr-error" role="alert">{error}</p>}
    <button className="cr-save" disabled={busy} onClick={() => void save()}>{recorded ? '이 주 확인 저장' : '사유 남기기'}</button>
  </div>
}

/** 한 수급자의 주별 확인 창. 확인은 기록처럼 쌓이며 수정·삭제하지 않고, 다시 저장하면 가장 나중 확인이 유효하다. */
export function WeekReviewPanel({ lane, month, busy, enabled, reason, onSave }: { lane: RhythmLane; month: string; busy: boolean; enabled: boolean; reason: string; onSave(patientId: string, entry: WeekReviewInput): Promise<void> }) {
  if (!enabled) return <p className="cr-note">{reason}</p>
  const weeks = lane.weeks.map((week, index) => ({ week, index })).filter(({ week }) => week.state === 'recorded' || week.state === 'missing')
  if (!weeks.length) return <p className="cr-note">이 달에는 확인할 주가 없습니다.</p>
  return <div className="cr-review">{weeks.map(({ week, index }) => <WeekReviewRow key={week.weekStart + week.review.at + week.digest} week={week} index={index} month={month} busy={busy} onSave={entry => onSave(lane.patientId, entry)} />)}</div>
}

export interface BatchTarget { lane: RhythmLane; weeks: RhythmWeek[] }
/** 평소와 같음 일괄 확인: 미작성·표현 점검이 없는 수급자의 '확인 대기' 주만. 실행 전에 대상 목록을 보여 준다. */
export function BatchReview({ targets, busy, progress, onRun, onCancel }: { targets: BatchTarget[]; busy: boolean; progress: string; onRun(): void; onCancel(): void }) {
  const weeks = targets.reduce((n, t) => n + t.weeks.length, 0)
  return <div className="cr-batch" role="dialog" aria-label="평소와 같음 일괄 확인">
    <h3>평소와 같음으로 일괄 확인</h3>
    <p>미작성이나 표현 점검이 없는 수급자 {targets.length}명, {weeks}주입니다. 기록을 읽고 모두 평소와 같다고 판단할 때만 실행하세요. 확인 기록에 "일괄"로 남습니다.</p>
    <ul>{targets.map(t => <li key={t.lane.patientId}>{t.lane.name} · {t.weeks.map(w => `${Number(w.weekStart.slice(5, 7))}/${Number(w.weekStart.slice(8, 10))} 시작 주`).join(', ')}</li>)}</ul>
    {progress && <p className="cr-note" role="status">{progress}</p>}
    <div className="cr-batch-actions"><button onClick={onCancel} disabled={busy}>취소</button><button className="cr-save" onClick={onRun} disabled={busy || !targets.length}>{busy ? '저장 중…' : `${weeks}주를 평소와 같음으로 확인`}</button></div>
  </div>
}
