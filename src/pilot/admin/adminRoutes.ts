/** /admin 화면 주소 규칙. 새로고침·직접 주소 입력·뒤로가기가 같은 화면으로 돌아오도록
 * 화면 상태를 주소(pathname)에 담는다. 라우팅 라이브러리는 쓰지 않는다(main.tsx와 동일).
 *
 * /admin                                  기관 첫 화면(검토할 보고 + 기존 대시보드)
 * /admin/org/:orgId/recipients            수급자 목록
 * /admin/org/:orgId/recipients/:code      수급자 상세(보고 타임라인)
 * /admin/reports                          전체 보고 목록(기존)
 * /admin/reports/:id                      보고 상세 · 승인/반려(기존)
 * /admin/participants                     참여자 관리(기존)
 * /admin/presentation                     피칭 화면(기존)
 *
 * 수급자 주소에 기관 ID를 넣는 이유: 앞으로 기관이 늘어도 다른 기관의 같은 수급자
 * 코드를 잘못 열지 않게 하기 위함이다. 권한 판단은 서버가 세션 기관으로 한다. */
export type AdminRoute =
  | { kind: 'dashboard' }
  | { kind: 'recipients'; orgId: string }
  | { kind: 'recipient'; orgId: string; code: string }
  | { kind: 'reports' }
  | { kind: 'report'; id: string }
  | { kind: 'participants' }
  | { kind: 'presentation' }

export function parseAdminPath(pathname: string): AdminRoute {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] !== 'admin') return { kind: 'dashboard' }
  const [, section, a, b, c] = parts
  if (section === 'presentation') return { kind: 'presentation' }
  if (section === 'participants') return { kind: 'participants' }
  if (section === 'reports') return a ? { kind: 'report', id: a } : { kind: 'reports' }
  if (section === 'org' && a && b === 'recipients') {
    return c ? { kind: 'recipient', orgId: a, code: c } : { kind: 'recipients', orgId: a }
  }
  return { kind: 'dashboard' }
}

export function adminPath(route: AdminRoute): string {
  switch (route.kind) {
    case 'dashboard':
      return '/admin'
    case 'recipients':
      return `/admin/org/${encodeURIComponent(route.orgId)}/recipients`
    case 'recipient':
      return `/admin/org/${encodeURIComponent(route.orgId)}/recipients/${encodeURIComponent(route.code)}`
    case 'reports':
      return '/admin/reports'
    case 'report':
      return `/admin/reports/${encodeURIComponent(route.id)}`
    case 'participants':
      return '/admin/participants'
    case 'presentation':
      return '/admin/presentation'
  }
}

/** 주소를 바꿀 때 데모 표시(demo=1)는 항상 이어 붙인다 — 빠지면 데모 중에 실제
 * 로그인 화면으로 넘어간다(DEP-01과 같은 문제). 나머지 쿼리는 extra로만 넘긴다. */
export function adminUrl(route: AdminRoute, currentSearch: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams()
  if (new URLSearchParams(currentSearch).get('demo') === '1') params.set('demo', '1')
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
  const qs = params.toString()
  return `${adminPath(route)}${qs ? `?${qs}` : ''}`
}
