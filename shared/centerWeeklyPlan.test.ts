import { describe, expect, it } from 'vitest'
import { buildWeeklyPlanPreview, checkWeeklyPlanChange, parseWeeklyPlanDraft, parseWeeklyPlanEntry, weeklyPlanMinutes } from './centerWeeklyPlan.js'
const patientId = '00000000-0000-4000-8000-000000000001', worker = '00000000-0000-4000-8000-000000000002', another = '00000000-0000-4000-8000-000000000003'
const entry = { id: '00000000-0000-4000-8000-000000000004', service: '요양', weekdays: [1, 3, 5], start: '09:00', end: '10:00', workerIds: [worker], nursingDual: false }
const other = { ...entry, id: '00000000-0000-4000-8000-000000000005', workerIds: [another] }
describe('수급자 주간계획 계약', () => {
  it('요일·제공자·시간·중복 항목·알 수 없는 필드를 검사한다', () => {
    for (const patch of [{ weekdays: [] }, { weekdays: [1, 1] }, { weekdays: [7] }, { start: '24:00' }, { end: '09:60' }, { end: '09:00' }, { workerIds: [] }, { workerIds: [worker, another] }, { extra: true }]) expect(() => parseWeeklyPlanEntry({ ...entry, ...patch })).toThrow()
    expect(() => parseWeeklyPlanDraft({ patientId, month: '2026-10', entries: [entry, entry] })).toThrow()
    expect(() => parseWeeklyPlanDraft({ patientId, month: '2026-13', entries: [] })).toThrow()
    expect(() => parseWeeklyPlanDraft({ patientId, month: '2026-10', entries: [], organizationCode: 'OTHER' })).toThrow()
  })
  it('목욕은 서로 다른 두 명, 간호는 한 명이며 D 선택은 간호만 허용한다', () => {
    expect(parseWeeklyPlanEntry({ ...entry, service: '목욕', workerIds: [worker, another] }).workerIds).toEqual([worker, another])
    expect(() => parseWeeklyPlanEntry({ ...entry, service: '목욕', workerIds: [worker, worker] })).toThrow()
    expect(() => parseWeeklyPlanEntry({ ...entry, nursingDual: true })).toThrow()
    expect(parseWeeklyPlanEntry({ ...entry, service: '간호', nursingDual: true }).nursingDual).toBe(true)
  })
  it('서로 다른 제공자라도 같은 서비스/요일이 겹치면 차단 후보다', () => {
    expect(checkWeeklyPlanChange({ ...entry, start: '09:30', end: '10:30' }, [other])).toEqual([{ otherEntryId: other.id, weekdays: [1, 3, 5], type: 'overlap', blocksSave: true }])
    expect(checkWeeklyPlanChange(entry, [entry, { ...other, weekdays: [2] }, { ...other, service: '간호' }])).toEqual([])
  })
  it('끝=시작은 중복이 아니며 요양2시간 미만은 저장 차단과 구분한다', () => {
    expect(checkWeeklyPlanChange({ ...entry, start: '10:00', end: '11:00' }, [other])[0]).toMatchObject({ type: 'short_gap', blocksSave: false })
    expect(checkWeeklyPlanChange({ ...entry, start: '12:00', end: '13:00' }, [other])).toEqual([])
  })
  it('새 간호 D 선택만 검사를 건너뛰는 원본의 방향성을 보존한다', () => {
    expect(checkWeeklyPlanChange({ ...entry, service: '간호', nursingDual: true }, [{ ...other, service: '간호' }])).toEqual([])
    expect(checkWeeklyPlanChange({ ...entry, service: '간호' }, [{ ...other, service: '간호', nursingDual: true }])[0].type).toBe('overlap')
  })
  it('익일 종료는 양수 분량이며 같은 요일 기존 야간 계획도 보정한다', () => {
    expect(weeklyPlanMinutes({ start: '23:00', end: '01:00' })).toBe(120)
    expect(checkWeeklyPlanChange({ ...entry, start: '23:30', end: '00:30' }, [{ ...other, start: '23:00', end: '01:00' }])[0].type).toBe('overlap')
  })
})
describe('월별 미저장 일정 미리보기', () => {
  it('해당 월의 선택 요일만 생성하고 입력·기존 일정을 변경하지 않는다', () => {
    const plan = { patientId, month: '2026-10', entries: [entry] }, original = JSON.stringify(plan), rows = buildWeeklyPlanPreview(plan)
    expect(rows).toHaveLength(13)
    expect(rows[0]).toMatchObject({ date: '2026-10-02', time: '09:00', endTime: '10:00', minutes: 60, state: 'unsaved_preview' })
    expect(rows.every(row => row.date.startsWith('2026-10'))).toBe(true)
    expect(rows[0]).not.toHaveProperty('id')
    rows[0].workerIds.push(another)
    expect(JSON.stringify(plan)).toBe(original)
  })
  it('월말 야간 종료를 익월로 표시하고 익월 시작 일정을 생성하지 않는다', () => {
    const rows = buildWeeklyPlanPreview({ patientId, month: '2026-10', entries: [{ ...entry, weekdays: [6], start: '23:00', end: '01:00' }] })
    expect(rows).toHaveLength(5)
    expect(rows.at(-1)).toMatchObject({ date: '2026-10-31', endDate: '2026-11-01', endTime: '01:00', minutes: 120 })
  })
  it('윤년과 빈 초안을 처리하며 순수 계획으로 기관·인물 자격을 확정하지 않는다', () => {
    expect(buildWeeklyPlanPreview({ patientId, month: '2024-02', entries: [{ ...entry, weekdays: [4] }] }).at(-1)?.date).toBe('2024-02-29')
    expect(buildWeeklyPlanPreview({ patientId, month: '2026-10', entries: [] })).toEqual([])
  })
})
