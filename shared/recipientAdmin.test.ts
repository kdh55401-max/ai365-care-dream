import { describe, expect, it } from 'vitest'
import { nextRecipientCode, normalizeCaregiverCodes, validateDisplayName, validateRecipientCode } from './recipientAdmin.js'

describe('수급자 등록 입력 규칙', () => {
  it('표시명은 비어 있거나 너무 길거나 식별번호처럼 보이면 거부한다', () => {
    expect(validateDisplayName('햇살 어르신')).toBeNull()
    expect(validateDisplayName('   ')).not.toBeNull()
    expect(validateDisplayName('ㄱ'.repeat(31))).not.toBeNull()
    expect(validateDisplayName('900101-1234567')).not.toBeNull()
    expect(validateDisplayName('010 1234 5678')).not.toBeNull()
    expect(validateDisplayName('2호실 어르신')).toBeNull()
  })

  it('코드는 A 계열만 직접 지정할 수 있고 비우면 자동이다', () => {
    expect(validateRecipientCode('')).toBeNull()
    expect(validateRecipientCode(undefined)).toBeNull()
    expect(validateRecipientCode('a10')).toBeNull()
    expect(validateRecipientCode('B10')).not.toBeNull()
    expect(validateRecipientCode('A1')).not.toBeNull()
  })

  it('다음 코드는 가장 큰 A 번호 다음이다(빈 번호를 재사용하지 않는다)', () => {
    expect(nextRecipientCode(['A01', 'A02', 'A09'])).toBe('A10')
    expect(nextRecipientCode(['A01', 'A03'])).toBe('A04')
    expect(nextRecipientCode([])).toBe('A01')
    expect(nextRecipientCode(['A99'])).toBe('A100')
  })

  it('요양보호사 코드 목록은 공백·중복·소문자를 정리한다', () => {
    expect(normalizeCaregiverCodes([' c01', 'C01', 'C02', ''])).toEqual(['C01', 'C02'])
    expect(normalizeCaregiverCodes('C01')).toEqual([])
  })
})
