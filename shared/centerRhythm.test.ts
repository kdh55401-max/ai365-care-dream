import { describe, expect, it } from 'vitest'
import type { CenterDocument } from './centerDocuments.js'
import type { CenterPerson, CenterVisit } from './centerOperations.js'
import { emptyStateChange, serializeStateChange } from './centerStateChange.js'
import type { StoredWeekReview } from './centerWeekReviews.js'
import { buildCenterRhythm, matchesRhythmFilter, monthWeeks, recognitionChip, rhythmCsv, rhythmFilterCounts, rhythmPrintHtml, sortRhythmLanes } from './centerRhythm.js'

const person = (id: string, name: string, kind: 'worker' | 'patient', status = ''): CenterPerson => ({ id, kind, name, status, category: '', start: '', end: '', examination: '', notes: {} })
const visit = (id: string, patientId: string, date: string, service = '요양', workerId = 'w1'): CenterVisit => ({ id, date, time: '09:00', workerId, patientId, service, minutes: 60 })
function stateDoc(subjectId: string, dates: string[]): CenterDocument {
  const record = emptyStateChange(); dates.forEach((date, i) => { record.weeks[i] = { ...record.weeks[i], date, remarks: '관찰함', result: '지원' } })
  return { id: 'd-' + subjectId, organizationCode: 'o', status: 'draft', version: 1, createdAt: '', updatedAt: '', confirmedAt: null, templateId: 'state-change-record', title: '상태변화기록지', subjectKind: 'patient', subjectId, period: '2026-10', content: serializeStateChange(record), resultEvaluationCompleted: false }
}
const people = [person('w1', '요양보호사 가', 'worker'), person('a', '수급자 가', 'patient'), person('b', '수급자 나', 'patient'), person('c', '수급자 다', 'patient', '계약해지')]
const visits = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-22', '2026-10-27'].map((d, i) => visit('a' + i, 'a', d)).concat([visit('b1', 'b', '2026-10-06', '목욕')])
const documents = [stateDoc('a', ['2026-10-06', '2026-10-13'])]

describe('센터장 대시보드 리듬 타임라인(읽기 전용)', () => {
  it('월요일 시작 주 구간으로 자른다', () => {
    expect(monthWeeks('2026-10')).toEqual([{ startDay: 1, endDay: 4 }, { startDay: 5, endDay: 11 }, { startDay: 12, endDay: 18 }, { startDay: 19, endDay: 25 }, { startDay: 26, endDay: 31 }])
  })
  it('기록 있는 주, 이번 주 대기, 지난 주 미작성을 구분하고 해지 수급자는 뺀다', () => {
    const result = buildCenterRhythm({ people, visits, documents, month: '2026-10', today: '2026-10-24', service: '' })
    expect(result.todayDay).toBe(24); expect(result.lanes.map(l => l.name)).toEqual(['수급자 나', '수급자 가'])
    const [b, a] = result.lanes
    expect(b.missingWeeks).toEqual([2]); expect(b.summary).toContain('2주차 상태변화 기록 미작성'); expect(b.workerName).toBe('요양보호사 가')
    expect(a.weeks.map(w => w.state)).toEqual(['none', 'recorded', 'recorded', 'pending', 'none'])
    expect(a.pending).toBe(true); expect(a.summary).toContain('이번 주'); expect(a.lastRecord).toBe('10/13')
    expect(a.visits.filter(v => v.planned).map(v => v.day)).toEqual([27])
  })
  it('서비스 필터가 방문만 거른다', () => {
    const result = buildCenterRhythm({ people, visits, documents, month: '2026-10', today: '2026-10-24', service: '목욕' })
    expect(result.lanes.find(l => l.name === '수급자 가')!.visits).toHaveLength(0); expect(result.lanes.find(l => l.name === '수급자 나')!.visits).toHaveLength(1)
  })
  it('다른 달은 오늘 표시가 없고 지난 달은 방문 있는 빈 주를 미작성으로 본다', () => {
    const september = buildCenterRhythm({ people, visits: [visit('s', 'a', '2026-09-08')], documents: [], month: '2026-09', today: '2026-10-24', service: '' })
    expect(september.todayDay).toBeNull(); expect(september.lanes.find(l => l.name === '수급자 가')!.missingWeeks).toEqual([2])
    const november = buildCenterRhythm({ people, visits: [visit('n', 'a', '2026-11-03')], documents: [], month: '2026-11', today: '2026-10-24', service: '' })
    expect(november.lanes.find(l => l.name === '수급자 가')!.weeks.every(w => w.state === 'none')).toBe(true)
  })
  it('인쇄 표와 CSV는 이름순이며 입력을 이스케이프하고 수식 시작 문자를 막는다', () => {
    const { lanes } = buildCenterRhythm({ people: [...people, person('d', '=SUM(A1)', 'patient')], visits, documents, month: '2026-10', today: '2026-10-24', service: '' })
    const html = rhythmPrintHtml(lanes, '2026-10', '', true)
    expect(html).toContain('가상자료 시연'); expect(html.indexOf('수급자 가')).toBeLessThan(html.indexOf('수급자 나'))
    const csv = rhythmCsv(lanes)
    expect(csv.startsWith('﻿수급자,담당')).toBe(true); expect(csv).toContain(`"'=SUM(A1)"`)
  })

  it('주 1회 기록 참고 숫자, 경과 일수, 표현 점검, 예전 형식 기록을 문장에 담는다', () => {
    const vague = emptyStateChange(); vague.weeks[0] = { ...vague.weeks[0], date: '2026-10-06', remarks: '특이사항 없음', result: '지원' }
    const docs: CenterDocument[] = [{ ...stateDoc('a', ['2026-10-06']), content: serializeStateChange(vague) }, { ...stateDoc('b', []), id: 'legacy-b', content: '자유 텍스트 예전 기록' }]
    const { lanes } = buildCenterRhythm({ people, visits, documents: docs, month: '2026-10', today: '2026-10-24', service: '' })
    const a = lanes.find(l => l.name === '수급자 가')!; const b = lanes.find(l => l.name === '수급자 나')!
    expect(a.applicableWeeks).toBe(3); expect(a.recordedWeeks).toBe(1); expect(a.daysSinceLast).toBe(18)
    expect(a.summary).toContain('마지막 기록 후 18일'); expect(a.summary).toContain('특이사항 표현 점검이 필요한 기록 1건')
    expect(b.legacyDocs).toBe(1); expect(b.summary).toContain('일자 없는 예전 형식 기록 1건')
  })
  it('인정 만료 칩은 임박·지남·없음·조회 실패를 구분한다', () => {
    expect(recognitionChip('2027-01-16', '2026-10-24')).toEqual({ label: '인정 만료 2027-01-16 (D-84)', tone: 'warning' })
    expect(recognitionChip('2029-02-24', '2026-10-24').tone).toBe('neutral')
    expect(recognitionChip('2026-10-20', '2026-10-24')).toEqual({ label: '인정 만료 2026-10-20 (4일 지남)', tone: 'danger' })
    expect(recognitionChip(null, '2026-10-24').label).toBe('인정 정보 없음'); expect(recognitionChip('error', '2026-10-24').label).toBe('인정 정보 미조회')
  })

  it('버튼별 해당 수급자 건수와 거르기, 열 정렬', () => {
    const vague = emptyStateChange(); vague.weeks[0] = { ...vague.weeks[0], date: '2026-10-06', remarks: '특이사항 없음', result: '지원' }
    const docs: CenterDocument[] = [{ ...stateDoc('a', ['2026-10-06']), content: serializeStateChange(vague) }]
    const { lanes } = buildCenterRhythm({ people, visits, documents: docs, month: '2026-10', today: '2026-10-24', service: '' })
    const ends = { a: '2027-01-16', b: '2026-10-20' }
    expect(rhythmFilterCounts(lanes, ends, '2026-10-24')).toEqual({ all: 2, review: 1, changed: 0, missing: 2, pending: 1, stale: 1, expression: 1, legacy: 0, recognition: 2 })
    expect(lanes.filter(l => matchesRhythmFilter(l, 'missing', ends[l.patientId as 'a' | 'b'], '2026-10-24')).map(l => l.name)).toEqual(['수급자 가', '수급자 나'])
    expect(lanes.filter(l => matchesRhythmFilter(l, 'stale', undefined, '2026-10-24')).map(l => l.name)).toEqual(['수급자 가'])
    expect(rhythmFilterCounts(lanes, { a: 'loading', b: 'error' }, '2026-10-24').recognition).toBe(0)
    expect(sortRhythmLanes(lanes, 'name', 'desc', ends).map(l => l.name)).toEqual(['수급자 나', '수급자 가'])
    expect(sortRhythmLanes(lanes, 'days', 'desc', ends)[0].name).toBe('수급자 가')
    expect(sortRhythmLanes(lanes, 'recognition', 'asc', ends)[0].name).toBe('수급자 나')
  })
  it('CSV에는 기록 주·경과일·표현 점검 열이 있다', () => {
    const { lanes } = buildCenterRhythm({ people, visits, documents, month: '2026-10', today: '2026-10-24', service: '' })
    expect(rhythmCsv(lanes).split(String.fromCharCode(13, 10))[0]).toBe(String.fromCharCode(0xfeff) + '수급자,담당,방문 계획 수,기록 건수,기록 주,미작성 주,마지막 기록,경과일,표현 점검,확인 대기 주,변화 확인 주,유지 확인 주')
  })

  it('센터장 확인이 있는 주만 확인됨·다시 확인 필요·확인 못함으로 나뉜다', () => {
    const base = { people, visits, documents, month: '2026-10', today: '2026-10-24', service: '' as const }
    const plain = buildCenterRhythm(base).lanes.find(l => l.name === '수급자 가')!
    expect(plain.weeks[1].review.status).toBe('unreviewed'); expect(plain.reviewPending).toEqual([2, 3]); expect(plain.weeks[1].digest).toMatch(/^[0-9a-f]{64}$/); expect(plain.weeks[1].documentId).toBe('d-a')
    const at = '2026-10-25T01:00:00Z', mk = (weekStart: string, value: StoredWeekReview['value'], digest: string, areas: StoredWeekReview['areas'] = []): StoredWeekReview => ({ id: weekStart + value, weekStart, value, areas, note: '메모', digest, documentId: null, batch: false, reviewer: '센터장', at })
    const reviews = { a: [mk('2026-10-05', 'same_as_usual', plain.weeks[1].digest), mk('2026-10-12', 'changed', 'f'.repeat(64), ['body'])], b: [mk('2026-10-05', 'not_observed', '')] }
    const lanes = buildCenterRhythm({ ...base, reviews }).lanes, a = lanes.find(l => l.name === '수급자 가')!, b = lanes.find(l => l.name === '수급자 나')!
    expect(a.weeks.map(w => w.review.status)).toEqual(['none', 'confirmed', 'stale', 'none', 'none']); expect(a.weeks[1].review.value).toBe('same_as_usual')
    expect(a.reviewPending).toEqual([3]); expect(a.sameWeeks).toBe(1); expect(a.changedWeeks).toEqual([]); expect(a.summary).toContain('확인 뒤 기록이 바뀐 주 포함')
    expect(b.weeks[1].review.status).toBe('excused'); expect(b.notObservedWeeks).toBe(1); expect(b.reviewPending).toEqual([])
    const changed = buildCenterRhythm({ ...base, reviews: { a: [mk('2026-10-12', 'changed', plain.weeks[2].digest, ['body', 'safety'])] } }).lanes.find(l => l.name === '수급자 가')!
    expect(changed.changedWeeks).toEqual([3]); expect(changed.summary).toContain('3주차에 변화 있음으로 확인'); expect(matchesRhythmFilter(changed, 'changed', undefined, '2026-10-24')).toBe(true)
    expect(rhythmFilterCounts(lanes, {}, '2026-10-24').review).toBe(1)
  })
})
