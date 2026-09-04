import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PW_PORT ?? '5183'
const BASE_URL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // 사양서가 요구하는 두 모바일 뷰포트(390×844, 360×800)를 모두 Chromium
    // 엔진으로 검증한다. iPhone 프리셋(WebKit)은 이 환경에 브라우저 바이너리를
    // 추가로 내려받아야 해서, 검증 목적(뷰포트 크기)에는 영향이 없는 Chromium
    // 기반 모바일 에뮬레이션으로 통일했다.
    {
      name: 'mobile-390',
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'mobile-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 30_000,
      },
})
