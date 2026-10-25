import { describe, it, expect } from 'vitest'
import { stateChangeCoverage } from './centerDocumentCoverage.js'
import { emptyStateChange, serializeStateChange } from './centerStateChange.js'
import type { CenterDocument } from './centerDocuments.js'
const patient = 'p1', period = '2026-10'
function doc(patch: Partial<CenterDocument> = {}, week = 0): CenterDocument {
  const record = emptyStateChange()
  record.weeks[week] = { ...record.weeks[week], date: '2026-10-06', remarks: '가상 관찰: 부축 후 휴식함.' }
  return { id: 'd1', organizationCode: 'DEMO', templateId: 'state-change-record', title: '가상 기록', subjectKind: 'patient', subjectId: patient, period, content: serializeStateChange(record), resultEvaluationCompleted: false, status: 'draft', version: 1, createdAt: '', updatedAt: '', confirmedAt: null, ...patch }
}
describe('상태변화 월별 작성 여부', () => {
  it('기록 없는 다섯 칸을 미작성으로 구분하며 임상 상태를 추정하지 않는다', () => {
    expect(stateChangeCoverage([], patient, period)).toEqual({ documents: [], weeks: Array(5).fill('missing'), review: false })
  })
  it('서식 주차별 초안·확정 문서 기록을 구분하고 원문을 유지한다', () => {
    const draft = doc(), confirmed = doc({ id: 'd2', status: 'confirmed' }, 1)
    const result = stateChangeCoverage([draft, confirmed], patient, period)
    expect(result.weeks).toEqual(['draft', 'confirmed', 'missing', 'missing', 'missing'])
    expect(result.documents).toHaveLength(2)
  })
  it('ID별 최신 버전을 먼저 골라 과거 기준월이나 중복 기록을 세지 않는다', () => {
    const old = doc(), latest = doc({ version: 2, period: '2026-11' })
    expect(stateChangeCoverage([old, latest, latest], patient, period).documents).toHaveLength(0)
    expect(stateChangeCoverage([latest, old], patient, period).documents).toHaveLength(0)
    expect(stateChangeCoverage([old, old], patient, period).documents).toHaveLength(1)
    expect(stateChangeCoverage([doc({ subjectId: 'p2' }), doc({ templateId: 'service-record' })], patient, period).documents).toHaveLength(0)
  })
  it('기존 자유서술과 잘못된 날짜를 미작성이나 정상 작성으로 단정하지 않는다', () => {
    expect(stateChangeCoverage([doc({ content: '기존 자유서술 기록' })], patient, period).weeks).toEqual(Array(5).fill('review'))
    const record = emptyStateChange(); record.weeks[0].date = '2026-09-30'; record.weeks[0].remarks = '가상 관찰'
    expect(stateChangeCoverage([doc({ content: serializeStateChange(record) })], patient, period).weeks[0]).toBe('review')
  })
  it('같은 버전의 상충 내용은 확정 표시를 하지 않고 관련 월 모두 검토로 돌린다', () => {
    const a = doc({ status: 'confirmed' }), b = doc({ period: '2026-11' })
    expect(stateChangeCoverage([a, b], patient, period).weeks).toEqual(Array(5).fill('review'))
    expect(stateChangeCoverage([b, a], patient, period).weeks).toEqual(Array(5).fill('review'))
  })
})
