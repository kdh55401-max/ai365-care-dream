import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SafetyScannerApp from './safetyScanner/SafetyScannerApp.tsx'
import RoleGateway from './roles/RoleGateway.tsx'
import TeamWorkspace from './team/TeamWorkspace.tsx'
import CareWorkspace from './care/CareWorkspace.tsx'
import CommunityWorkspace from './community/CommunityWorkspace.tsx'

// react-router 등 별도 라우팅 라이브러리를 추가하지 않고, 역할별 업무공간과
// 생활안전스캐너를 경로(pathname)만으로 전환하는 최소 진입점 스위치.
// /            역할 선택(RoleGateway)
// /team        관리자(TEAM)
// /care        요양보호사(CARE)
// /community   생활지원사(COMMUNITY) — 기존 App(현장 대응 도우미) 보존
// /safety-scanner  생활안전스캐너(기존 기능, COMMUNITY에서 진입)
function Root() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (pathname.startsWith('/safety-scanner')) return <SafetyScannerApp />
  if (pathname.startsWith('/team')) return <TeamWorkspace />
  if (pathname.startsWith('/care')) return <CareWorkspace />
  if (pathname.startsWith('/community')) return <CommunityWorkspace />
  return <RoleGateway />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
