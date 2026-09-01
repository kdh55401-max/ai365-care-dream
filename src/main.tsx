import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import SafetyScannerApp from './safetyScanner/SafetyScannerApp.tsx'

// react-router 등 별도 라우팅 라이브러리를 추가하지 않고, 생활안전스캐너만
// 신규 경로(/safety-scanner)로 분리하기 위한 최소 진입점 스위치.
function Root() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (pathname.startsWith('/safety-scanner')) {
    return <SafetyScannerApp />
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
