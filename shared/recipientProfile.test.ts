import { describe, expect, it } from 'vitest'
import { cleanProfile, ltcValidity, normalizeLtcNumber, validateProfile } from './recipientAdmin.js'

describe('수급자 인적사항 규칙', () => {
  it('장기요양인정번호의 공백·소문자·하이픈 누락을 바로잡는다', () => {
    expect(normalizeLtcNumber(' l0011097739103 ')).toBe('L0011097739-103')
    expect(normalizeLtcNumber('L0011097739-103')).toBe('L0011097739-103')
    expect(normalizeLtcNumber('123')).toBe('123')
  })

  it('이름은 등록할 때 필수이고, 형식이 틀린 값은 이유를 알려 준다', () => {
    expect(validateProfile({}, true)).toContain('이름')
    expect(validateProfile({ fullName: '가나다' }, true)).toBeNull()
    expect(validateProfile({ fullName: '가나다', ltcNumber: 'L123' }, true)).toContain('장기요양인정번호')
    expect(validateProfile({ fullName: '가나다', ltcGrade: '9등급' }, true)).toContain('등급')
    expect(validateProfile({ fullName: '가나다', birthDate: '1956-02-30' }, true)).toContain('생년월일')
    expect(validateProfile({ fullName: '가나다', ltcValidFrom: '2029-02-24', ltcValidTo: '2025-02-25' }, true)).toContain('시작일')
    expect(validateProfile({ fullName: '가나다', phone: '전화' }, true)).toContain('전화번호')
  })

  it('인정번호를 하이픈 없이 넣어도 저장 모양으로 정리된다', () => {
    const cleaned = cleanProfile({ fullName: ' 가나다 ', ltcNumber: 'l0011097739103', ltcGrade: '4등급' })
    expect(cleaned).toMatchObject({ fullName: '가나다', ltcNumber: 'L0011097739-103', ltcGrade: '4등급', phone: '' })
    expect(validateProfile(cleaned, true)).toBeNull()
  })

  it('인정 유효기간 상태: 90일 이내는 갱신 시기, 지나면 만료, 입력이 없으면 판단하지 않는다', () => {
    expect(ltcValidity('', '2026-10-03')).toBe('none')
    expect(ltcValidity('2029-02-24', '2026-10-03')).toBe('valid')
    expect(ltcValidity('2026-12-01', '2026-10-03')).toBe('expiring')
    expect(ltcValidity('2026-10-02', '2026-10-03')).toBe('expired')
    expect(ltcValidity('2026-10-03', '2026-10-03')).toBe('expiring')
  })
})
