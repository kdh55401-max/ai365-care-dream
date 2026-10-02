import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE } from './recipientAdmin.js'
import { applyExtraction, mergeExtractions, normalizeDateText, normalizeGradeText, sanitizeExtraction, storedDocType } from './profileExtraction.js'

const raw = (over: Record<string, string> = {}) => ({
  docKind: 'ltc_certificate', fullName: '가상인', birthDate: '1950.01.01', ltcNumber: 'l0000000099001', ltcGrade: '4', ltcValidFrom: '2025년 2월 25일', ltcValidTo: '2029-02-24', address: '', phone: '', ...over,
})

describe('서류 읽기 결과 검증', () => {
  it('날짜·등급·인정번호를 표준 모양으로 바꿔 채운다', () => {
    expect(normalizeDateText('2025.2.5')).toBe('2025-02-05')
    expect(normalizeGradeText('인지지원')).toBe('인지지원등급')
    const r = sanitizeExtraction(raw(), '인정서.png', { promptTokens: 10, outputTokens: 5 })
    expect(r.fields).toEqual({ fullName: '가상인', birthDate: '1950-01-01', ltcNumber: 'L0000000099-001', ltcGrade: '4등급', ltcValidFrom: '2025-02-25', ltcValidTo: '2029-02-24' })
    expect(r.rejected).toEqual([])
    expect(r.docKind).toBe('ltc_certificate')
    expect(r.usage).toEqual({ promptTokens: 10, outputTokens: 5 })
  })

  it('형식이 틀린 값은 채우지 않고 사유와 함께 따로 알린다(고쳐 넣지 않는다)', () => {
    const r = sanitizeExtraction(raw({ ltcNumber: 'L123', ltcGrade: '9등급', birthDate: '1950-13-40' }), 'x.png')
    expect(r.fields.ltcNumber).toBeUndefined()
    expect(r.fields.ltcGrade).toBeUndefined()
    expect(r.fields.birthDate).toBeUndefined()
    expect(r.rejected.map((x) => x.field).sort()).toEqual(['birthDate', 'ltcGrade', 'ltcNumber'])
    expect(r.rejected.find((x) => x.field === 'ltcNumber')?.value).toBe('L123')
    expect(r.fields.fullName).toBe('가상인')
  })

  it('유효기간 시작이 종료보다 늦으면 두 칸 모두 채우지 않는다', () => {
    const r = sanitizeExtraction(raw({ ltcValidFrom: '2030-01-01', ltcValidTo: '2029-02-24' }), 'x.png')
    expect(r.fields.ltcValidFrom).toBeUndefined()
    expect(r.fields.ltcValidTo).toBeUndefined()
    expect(r.rejected).toHaveLength(2)
  })

  it('AI 응답이 객체가 아니거나 알 수 없는 종류면 아무것도 채우지 않고 기타로 둔다', () => {
    expect(sanitizeExtraction('이상한 응답', 'x.png').fields).toEqual({})
    expect(sanitizeExtraction({ docKind: '???', fullName: 12345 }, 'x.png')).toMatchObject({ docKind: 'other', fields: { fullName: '12345' } })
  })
})

describe('여러 서류 합치기', () => {
  const certificate = sanitizeExtraction(raw(), '인정서.png')
  const plan = sanitizeExtraction(raw({ docKind: 'ltc_use_plan', ltcNumber: '' }), '이용계획서.png')

  it('같은 값이면 출처를 모두 남기고 채운다', () => {
    const m = mergeExtractions([certificate, plan])
    expect(m.fields.ltcGrade).toBe('4등급')
    expect(m.sources.ltcGrade).toContain('장기요양인정서')
    expect(m.sources.ltcGrade).toContain('개인별장기요양이용계획서')
    expect(m.conflicts).toEqual([])
  })

  it('서류마다 다른 값은 어느 쪽도 고르지 않고 충돌로 둔다', () => {
    const other = sanitizeExtraction(raw({ docKind: 'ltc_use_plan', ltcGrade: '3등급' }), '이용계획서.png')
    const m = mergeExtractions([certificate, other])
    expect(m.fields.ltcGrade).toBeUndefined()
    expect(m.conflicts).toHaveLength(1)
    expect(m.conflicts[0]).toMatchObject({ field: 'ltcGrade', identity: false })
    expect(m.conflicts[0].values.map((v) => v.value)).toEqual(['4등급', '3등급'])
  })

  it('이름·인정번호가 서로 다르면 다른 사람의 서류가 섞인 것으로 표시한다', () => {
    const stranger = sanitizeExtraction(raw({ fullName: '다른사람', ltcNumber: 'L0000000100-001' }), '다른서류.png')
    const m = mergeExtractions([certificate, stranger])
    expect(m.conflicts.filter((c) => c.identity).map((c) => c.field).sort()).toEqual(['fullName', 'ltcNumber'])
    expect(m.fields.fullName).toBeUndefined()
  })
})

describe('입력 반영', () => {
  const merged = mergeExtractions([sanitizeExtraction(raw(), '인정서.png')])

  it('비어 있는 칸만 채우고, 어떤 칸을 채웠는지 알려 준다', () => {
    const a = applyExtraction({ ...EMPTY_PROFILE }, merged)
    expect(a.profile.ltcNumber).toBe('L0000000099-001')
    expect(a.filled).toEqual(['fullName', 'birthDate', 'ltcNumber', 'ltcGrade', 'ltcValidFrom', 'ltcValidTo'])
    expect(a.keptDifferent).toEqual([])
  })

  it('이미 입력한 값은 덮어쓰지 않고, 다르면 알리기만 한다', () => {
    const a = applyExtraction({ ...EMPTY_PROFILE, fullName: '직접입력', ltcGrade: '4등급' }, merged)
    expect(a.profile.fullName).toBe('직접입력')
    expect(a.filled).not.toContain('fullName')
    expect(a.filled).not.toContain('ltcGrade') // 같은 값이라 채울 것도 알릴 것도 없다
    expect(a.keptDifferent).toEqual([{ field: 'fullName', label: '이름', entered: '직접입력', suggested: '가상인' }])
  })

  it('서류 종류에 따라 4단계 원본 보관 유형을 고른다', () => {
    expect(storedDocType('ltc_use_plan')).toBe('ltc_use_plan')
    expect(storedDocType('care_plan')).toBe('care_plan')
    expect(storedDocType('ltc_certificate')).toBe('other')
  })
})
