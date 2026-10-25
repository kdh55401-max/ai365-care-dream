import type { CenterDocument } from './centerDocuments.js'
import { parseStateChange, stateChangeProblems, stateChangeWeekFilled, STATE_CHANGE_WEEKS } from './centerStateChange.js'

export type CoverageState = 'missing' | 'draft' | 'confirmed' | 'review'
export interface DocumentCoverage { documents: CenterDocument[]; weeks: CoverageState[]; review: boolean }

/** 작성 사실만 표시한다. 캘린더 주·의무 이행·건강상태·평가 충족을 추정하지 않는다. */
export function stateChangeCoverage(documents: CenterDocument[], patientId: string, period: string): DocumentCoverage {
  const latest = new Map<string, CenterDocument>(), conflicts = new Set<string>()
  for (const d of documents) {
    const old = latest.get(d.id)
    if (!old || d.version > old.version) { latest.set(d.id, d); conflicts.delete(d.id) }
    else if (d.version === old.version && (d.content !== old.content || d.period !== old.period || d.subjectId !== old.subjectId || d.status !== old.status || d.templateId !== old.templateId || d.organizationCode !== old.organizationCode)) conflicts.add(d.id)
  }
  const matches = [...latest.values()].filter(d => d.templateId === 'state-change-record' && d.subjectKind === 'patient' && d.subjectId === patientId && d.period === period)
    .sort((a, b) => a.title.localeCompare(b.title, 'ko') || a.id.localeCompare(b.id))
  const weeks: CoverageState[] = Array.from({ length: STATE_CHANGE_WEEKS }, () => 'missing')
  let review = documents.some(d => conflicts.has(d.id) && d.templateId === 'state-change-record' && d.subjectKind === 'patient' && d.subjectId === patientId && d.period === period)
  let unmapped = review
  for (const d of matches) {
    const record = parseStateChange(d.content)
    if (!record || conflicts.has(d.id)) { review = true; unmapped = true; continue }
    record.weeks.forEach((week, i) => {
      if (!stateChangeWeekFilled(week)) return
      if (stateChangeProblems({ v: 1, weeks: [week], etc: '' }, period).length) {
        if (weeks[i] === 'missing') weeks[i] = 'review'
        review = true; return
      }
      if (d.status === 'confirmed') weeks[i] = 'confirmed'
      else if (weeks[i] !== 'confirmed') weeks[i] = 'draft'
    })
  }
  // 기존 자유서술은 주차를 판단할 수 없으므로 미작성으로 단정하지 않는다.
  if (unmapped) for (let i = 0; i < weeks.length; i++) if (weeks[i] === 'missing') weeks[i] = 'review'
  return { documents: matches, weeks, review }
}
