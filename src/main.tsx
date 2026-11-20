import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import CareApp from './pilot/care/CareApp.tsx'
import ResearchCareApp from './pilot/care/ResearchCareApp.tsx'
import AdminApp from './pilot/admin/AdminApp.tsx'
import CenterWorkspace from './center/CenterWorkspace.tsx'
import Landing from './landing/Landing.tsx'
import OfficeApp from './office/OfficeApp.tsx'
import DemoApp from './demo/DemoApp.tsx'

// react-router 등 별도 라우팅 라이브러리를 추가하지 않고, 역할별 업무공간을
// 경로(pathname)만으로 전환하는 최소 진입점 스위치.
// /            첫 화면: 로그인 입구 3개만 (요양보호사 /care, 관리자 /admin, 센터 업무 지원 /office)
// /office      센터 업무 지원 시스템 — 센터 대표(master) 로그인 + 빈 대시보드 틀
// /center      기존 센터 ERP. 로그아웃 상태에서는 기존 회원 로그인·가입 화면이 뜬다.
// /team        기존 확장형 MVP는 로그인 없이 기능이 보여 연결을 끊었다(파일은 보존).
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

  if (pathname === '/center' || pathname.startsWith('/center/')) return <CenterWorkspace />
  // /demo  앱 소개·체험(시연용, 비밀번호는 서버 확인). 교수님 등 외부 설명용.
  if (pathname === '/demo' || pathname.startsWith('/demo/')) return <DemoApp />
  if (pathname === '/office' || pathname.startsWith('/office/')) return <OfficeApp />
  if (pathname.startsWith('/admin')) return <AdminApp />
  // /care = 연구용 요양보호사 화면. 기존 60초 돌봄보고는 /care/classic, 표준상황 연습은 /care/scenario에 보존.
  if (pathname.startsWith('/care/classic') || pathname.startsWith('/care/scenario')) return <CareApp />
  if (pathname.startsWith('/care')) return <ResearchCareApp />
  return <Landing />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
