/**
 * 최소 사용 통계만 Google Analytics(GA4)로 보낸다. 사용자가 말하거나 입력한
 * 내용(상황 설명, AI 응답, 지시사항/조치 메모 등)은 절대 전송하지 않는다.
 * 화면 전환, 입력 수단, 위험도 분류 같은 구조적 신호만 이벤트로 남긴다.
 * 측정 ID가 설정되지 않으면 아무 것도 하지 않는다.
 */
const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() || undefined

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

let initialized = false

export function initAnalytics() {
  if (initialized || !MEASUREMENT_ID) return
  initialized = true

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(script)

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args)
  }
  window.gtag('js', new Date())
  // SPA라 화면 전환마다 URL이 안 바뀌므로 자동 page_view는 끄고 직접 screen_view를 보낸다.
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false })
}

export function trackEvent(name: string, params?: Record<string, string | number | boolean>) {
  if (!MEASUREMENT_ID || !window.gtag) return
  window.gtag('event', name, params)
}
