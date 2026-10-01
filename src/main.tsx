import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import RoleGateway from './roles/RoleGateway.tsx'
import CareApp from './pilot/care/CareApp.tsx'
import AdminApp from './pilot/admin/AdminApp.tsx'

// 별도 라우팅 라이브러리 없이 경로(pathname)만으로 화면을 고른다.
//
// 2026-10-01 전면 교체: 이 앱은 기관 내부 ERP(이지케어 대체)로 방향을 바꿨다.
//   /         시작 화면 — 요양보호사 / 관리자 두 가지 진입만 둔다
//   /care     요양보호사(돌봄기록 비서)
//   /admin    관리자(수급자·기록 관리)
// 생활지원사(/community·/support), 안전스캐너(/safety-scanner), 구 관리자 MVP(/team)는
// B2G 확장 때 다시 쓰기 위해 소스(src/community, src/safetyScanner, src/team, src/App.tsx)를
// 그대로 보관하되 진입 경로를 닫았다 — 열린 화면이 없으니 토큰도 쓰지 않는다.
// 되살리려면 이 파일에서 해당 import와 경로 분기를 복원하면 된다.
const RETIRED_PATHS = ['/team', '/community', '/support', '/safety-scanner']

function Root() {
  const [pathname, setPathname] = useState(window.location.pathname)
  const retired = RETIRED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  useEffect(() => {
    if (retired) window.history.replaceState({}, '', `/${window.location.search}`)
  }, [retired])

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (retired) return <RoleGateway />
  if (pathname.startsWith('/admin')) return <AdminApp />
  if (pathname.startsWith('/care')) return <CareApp />
  return <RoleGateway />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
