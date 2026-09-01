/**
 * 별도 라우팅 라이브러리를 추가하지 않기 위한 최소 경로 전환 유틸.
 * History API로 주소만 바꾸고 popstate를 직접 발생시켜, main.tsx의 Root가
 * 새 경로에 맞는 화면(App 또는 SafetyScannerApp)을 다시 그리게 한다.
 */
export function navigate(path: string) {
  if (window.location.pathname === path) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
