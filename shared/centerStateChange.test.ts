import { describe, expect, it } from 'vitest'
import { emptyStateChange, formatStateChangeText, parseStateChange, serializeStateChange, stateChangeProblems } from './centerStateChange.js'

describe('상태변화 기록지 서식', () => {
  it('저장 문자열에서 같은 값을 복원하고 예전 자유 텍스트는 null', () => {
    const record = emptyStateChange()
    record.weeks[0] = { ...record.weeks[0], date: '2026-10-06', remarks: '보행 시 부축', result: '이동 지원' }
    record.weeks[0].checks.safety = true
    expect(parseStateChange(serializeStateChange(record))).toEqual(record)
    expect(parseStateChange('자유 본문')).toBeNull()
    expect(parseStateChange('{깨진')).toBeNull()
  })
  it('빈 서식·월 밖 날짜·내용 누락을 막는다', () => {
    const record = emptyStateChange()
    expect(stateChangeProblems(record, '2026-10')).toHaveLength(1)
    record.weeks[1].date = '2026-09-30'
    expect(stateChangeProblems(record, '2026-10')).toEqual(['2주차 일자가 기준월(2026-10)이 아닙니다.', '2주차 특이사항 또는 급여제공결과를 입력하세요.'])
    record.weeks[1] = { ...record.weeks[1], date: '2026-10-13', result: '식사 지원' }
    expect(stateChangeProblems(record, '2026-10')).toEqual([])
  })
  it('읽기용 본문에는 입력한 주차만 나온다', () => {
    const record = emptyStateChange()
    record.weeks[2] = { ...record.weeks[2], date: '2026-10-20', remarks: '하지부종 관찰', result: '걷기 격려' }
    record.weeks[2].checks.body = true
    const text = formatStateChangeText(record)
    expect(text).toContain('[3주차] 2026-10-20'); expect(text).toContain('상태변화 체크: 신체'); expect(text).not.toContain('[1주차]')
  })
})

describe('매뉴얼 기준 작성 경고', () => {
  it("'특이사항없음' 같은 기록과 너무 짧은 기록은 경고하고 구체적 기록은 통과", async () => {
    const { stateChangeQualityWarnings } = await import('./centerStateChange.js')
    const record = emptyStateChange()
    record.weeks[0] = { ...record.weeks[0], date: '2026-10-06', remarks: '특이사항 없음', result: '지원' }
    record.weeks[1] = { ...record.weeks[1], date: '2026-10-13', remarks: '양호함', result: '지원' }
    record.weeks[2] = { ...record.weeks[2], date: '2026-10-20', remarks: '하지부종이 남아 있어 다리 상태와 배뇨 양상을 관찰하고 걷기를 격려함', result: '지원' }
    const warnings = stateChangeQualityWarnings(record)
    expect(warnings).toHaveLength(2); expect(warnings[0]).toContain('1주차'); expect(warnings[1]).toContain('2주차')
  })
})


describe('실제 서비스 날짜 검증', () => {
  it.each(['2026-02-29', '2026-10-32', '2026-1001', '2026-10-01extra', '2026-13-01', '1899-10-01'])('잘못된 날짜 %s는 기준월 접두사가 같아도 저장 전 차단', date => {
    const record = emptyStateChange()
    record.weeks[0] = { ...record.weeks[0], date, remarks: '가상 관찰', result: '가상 조치' }
    expect(stateChangeProblems(record, date.slice(0, 7))).toContain('1주차 서비스 일자가 올바른 날짜가 아닙니다.')
  })
  it('윤년 날짜를 허용하고 기준월 변경은 차단', () => {
    const record = emptyStateChange()
    record.weeks[0] = { ...record.weeks[0], date: '2024-02-29', remarks: '가상 관찰', result: '가상 조치' }
    expect(stateChangeProblems(record, '2024-02')).toEqual([])
    expect(stateChangeProblems(record, '2024-03')).toContain('1주차 일자가 기준월(2024-03)이 아닙니다.')
  })
})
