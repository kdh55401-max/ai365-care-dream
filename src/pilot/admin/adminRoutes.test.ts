import { describe, expect, it } from 'vitest'
import { adminUrl, parseAdminPath } from './adminRoutes'

describe('admin routes', () => {
  it('새로고침·직접 주소로 같은 화면을 복원한다', () => {
    expect(parseAdminPath('/admin')).toEqual({ kind: 'dashboard' })
    expect(parseAdminPath('/admin/')).toEqual({ kind: 'dashboard' })
    expect(parseAdminPath('/admin/org/gadream365/recipients')).toEqual({ kind: 'recipients', orgId: 'gadream365' })
    expect(parseAdminPath('/admin/org/gadream365/recipients/A01')).toEqual({ kind: 'recipient', orgId: 'gadream365', code: 'A01' })
    expect(parseAdminPath('/admin/reports/abc-1')).toEqual({ kind: 'report', id: 'abc-1' })
    expect(parseAdminPath('/admin/reports')).toEqual({ kind: 'reports' })
    expect(parseAdminPath('/admin/participants')).toEqual({ kind: 'participants' })
    expect(parseAdminPath('/admin/presentation')).toEqual({ kind: 'presentation' })
    expect(parseAdminPath('/admin/quality')).toEqual({ kind: 'quality' })
    expect(adminUrl({ kind: 'quality' }, '?demo=1')).toBe('/admin/quality?demo=1')
    expect(parseAdminPath('/admin/unknown')).toEqual({ kind: 'dashboard' })
  })

  it('다른 기관 주소도 그대로 해석한다 — 차단은 화면이 아니라 서버(세션 기관 대조)가 한다', () => {
    expect(parseAdminPath('/admin/org/other-center/recipients/A01')).toEqual({ kind: 'recipient', orgId: 'other-center', code: 'A01' })
  })

  it('데모 표시(demo=1)만 이어 붙이고 나머지 쿼리는 넘긴 것만 쓴다', () => {
    expect(adminUrl({ kind: 'reports' }, '?demo=1&x=1')).toBe('/admin/reports?demo=1')
    expect(adminUrl({ kind: 'recipient', orgId: 'gadream365', code: 'A01' }, '', { period: '7' })).toBe(
      '/admin/org/gadream365/recipients/A01?period=7',
    )
  })
})
