import { WORK_CARDS, type WorkCard } from './adminFormat'

/** /admin 화면 주소 규칙. 새로고침·직접 주소 입력·뒤로가기가 같은 화면으로 돌아오도록
 * 화면 상태를 주소(pathname)에 담는다. 라우팅 라이브러리는 쓰지 않는다(main.tsx와 동일).
 *
 * /admin                                  기관 첫 화면(검토할 보고 + 기존 대시보드)
 * /admin/org/:orgId/recipients            수급자 목록
 * /admin/org/:orgId/recipients/:code      수급자 상세(보고 타임라인)
 * /admin/reports                          전체 보고 목록(기존)
 * /admin/reports/:id                      보고 상세 · 승인/반려(기존)
 * /admin/work/:card                       업무 카드 전체 목록(safety|reports|overdue|today)
 * /admin/actions?filter=&recipient=       조치 목록
 * /admin/actions/:id                      조치 상세
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
  | { kind: 'work'; card: WorkCard }
  | { kind: 'actions' }
  | { kind: 'action'; id: string }
  | { kind: 'participants' }
  | { kind: 'presentation' }

export function parseAdminPath(pathname: string): AdminRoute {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] !== 'admin') return { kind: 'dashboard' }
  const [, section, a, b, c] = parts
  if (section === 'presentation') return { kind: 'presentation' }
  if (section === 'participants') return { kind: 'participants' }
  if (section === 'reports') return a ? { kind: 'report', id: a } : { kind: 'reports' }
  if (section === 'actions') return a ? { kind: 'action', id: a } : { kind: 'actions' }
  if (section === 'work' && a && (WORK_CARDS as string[]).includes(a)) return { kind: 'work', card: a as WorkCard }
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
    case 'work':
      return `/admin/work/${route.card}`
    case 'actions':
      return '/admin/actions'
    case 'action':
      return `/admin/actions/${encodeURIComponent(route.id)}`
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
  const current = new URLSearchParams(currentSearch)
  if (current.get('demo') === '1') params.set('demo', '1')
  // 데모 전용: 'DB 적용 전' 상태 흉내(off: 2~4단계 미적용, stage2: 3·4단계 미적용, stage3: 4단계만 미적용)도 데모 안에서는 이어 붙인다.
  const sim = current.get('demo_workflow')
  if (current.get('demo') === '1' && (sim === 'off' || sim === 'stage2' || sim === 'stage3')) params.set('demo_workflow', sim)
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
  const qs = params.toString()
  return `${adminPath(route)}${qs ? `?${qs}` : ''}`
}
