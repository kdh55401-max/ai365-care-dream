import { emptyStateChange, parseStateChange, serializeStateChange, STATE_CHANGE_CHECKS, stateChangeQualityWarnings, type StateChangeWeek } from '../../shared/centerStateChange'

export function CenterStateChangeForm({ content, disabled, onChange }: { content: string; disabled: boolean; onChange(content: string): void }) {
  const record = parseStateChange(content) ?? emptyStateChange()
  const warnings = stateChangeQualityWarnings(record)
  function patchWeek(index: number, patch: Partial<StateChangeWeek>) {
    onChange(serializeStateChange({ ...record, weeks: record.weeks.map((w, i) => i === index ? { ...w, ...patch } : w) }))
  }
  return <fieldset className="cd-state-change" disabled={disabled}>
    <legend>상태변화 기록지 (주 1회 이상 기록, 월 최대 5주차)</legend>
    {warnings.length > 0 && <ul className="cd-muted" role="status" aria-label="작성 경고">{warnings.map(w => <li key={w}>{w}</li>)}</ul>}
    {record.weeks.map((week, i) => <div className="cd-state-week" key={i} role="group" aria-label={`${i + 1}주차`}>
      <strong>{i + 1}주차</strong>
      <label>서비스 일자<input type="date" aria-label={`${i + 1}주차 서비스 일자`} value={week.date} onChange={e => patchWeek(i, { date: e.target.value })} /></label>
      <div className="cd-state-checks">{STATE_CHANGE_CHECKS.map(c => <label key={c.key} className="cd-inline-label" title={c.hint}>
        <input type="checkbox" aria-label={`${i + 1}주차 ${c.label}`} checked={week.checks[c.key]} onChange={e => patchWeek(i, { checks: { ...week.checks, [c.key]: e.target.checked } })} />{c.label}</label>)}</div>
      <label>특이사항 및 조치내용<textarea aria-label={`${i + 1}주차 특이사항 및 조치내용`} maxLength={2000} value={week.remarks} onChange={e => patchWeek(i, { remarks: e.target.value })} /></label>
      <label>급여제공결과<textarea aria-label={`${i + 1}주차 급여제공결과`} maxLength={2000} value={week.result} onChange={e => patchWeek(i, { result: e.target.value })} /></label>
    </div>)}
    <label>기타 사항<textarea aria-label="상태변화 기타 사항" maxLength={2000} value={record.etc} onChange={e => onChange(serializeStateChange({ ...record, etc: e.target.value }))} /></label>
    <details><summary>체크 항목 참고</summary><ul>{STATE_CHANGE_CHECKS.map(c => <li key={c.key}><strong>{c.label}</strong>: {c.hint}</li>)}</ul></details>
  </fieldset>
}
