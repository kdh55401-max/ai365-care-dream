import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SafetyScannerApp from './safetyScanner/SafetyScannerApp.tsx'
import RoleGateway from './roles/RoleGateway.tsx'
import TeamWorkspace from './team/TeamWorkspace.tsx'
import CommunityWorkspace from './community/CommunityWorkspace.tsx'
import CareApp from './pilot/care/CareApp.tsx'
import AdminApp from './pilot/admin/AdminApp.tsx'

// react-router 등 별도 라우팅 라이브러리를 추가하지 않고, 역할별 업무공간과
// 생활안전스캐너를 경로(pathname)만으로 전환하는 최소 진입점 스위치.
// /            역할 선택(RoleGateway) — 기존 확장형 MVP, 보존
// /team        관리자(TEAM) — 기존 확장형 MVP, 보존
// /community   생활지원사(COMMUNITY) — 기존 App(현장 대응 도우미) 보존
// /safety-scanner  생활안전스캐너(기존 기능, COMMUNITY에서 진입)
//
// /care, /admin  60초 AI 돌봄보고(CARE REPORT) 실증 파일럿 (2026-09-07~09-18).
//   이 브랜치(claude/care-report-pilot-mvp-*)에서만 /care를 파일럿 화면으로 연결한다.
//   기존 확장형 MVP의 src/care/CareWorkspace.tsx 파일 자체는 삭제·수정하지 않고
//   그대로 보존했다 — 다른 브랜치/배포본(기존 서비스)은 이 변경의 영향을 받지 않는다.
function Root() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (pathname.startsWith('/safety-scanner')) return <SafetyScannerApp />
  if (pathname.startsWith('/team')) return <TeamWorkspace />
  if (pathname.startsWith('/admin')) return <AdminApp />
  if (pathname.startsWith('/care')) return <CareApp />
  if (pathname.startsWith('/community')) return <CommunityWorkspace />
  return <RoleGateway />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
