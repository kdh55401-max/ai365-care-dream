import { test, expect } from '@playwright/test'
import {
  DEMO_SUBMITTED_TEXT,
  answerFollowupsWithOptions,
  completeDailyReport,
  loginAdmin,
  loginCare,
  resetDemo,
  startReport,
  submitChangedReport,
} from './helpers'

test.describe('care-flow: /care?demo=1 골든 패스', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('로그인 → 기본 돌봄보고 → 선택형 추가질문 → 초안 확인·수정 → 저장', async ({ page }) => {
    await loginCare(page, 'c1', '6003')
    // 기본 돌봄보고는 상황선택 화면 없이 곧바로 입력 화면으로 간다("버튼 한 번 →
    // AI와 대화"가 핵심 동선).
    await startReport(page)

    await page.getByPlaceholder(/음성 대신/).fill('물을 적게 드셨어요')
    await page.getByRole('button', { name: '이야기 전달하기' }).click()

    // 최대 3회, 한 번에 하나씩 질문 — 선택 버튼만으로 진행한다(타이핑 없음).
    await expect(page.getByText(/추가 확인 1\/3/)).toBeVisible()
    await answerFollowupsWithOptions(page)

    await expect(page.getByText('말씀해주신 내용을 정리했어요.')).toBeVisible()

    // 보고문 수정 — 선택 답변이 임의로 확장되지 않고 그대로 반영됐는지 확인.
    const changeField = page.locator('textarea').first()
    await expect(changeField).toHaveValue('물을 적게 드셨어요')
    await changeField.fill('[검수] ' + (await changeField.inputValue()))

    await page.getByRole('button', { name: '센터에 보고하기' }).click()
    await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
  })

  test('음성 인식 미지원 기기에서도 텍스트만으로 끝까지 제출할 수 있다(추가 상태변화 기록하기)', async ({ page }) => {
    // Playwright의 기본 브라우저 컨텍스트는 SpeechRecognition을 제공하지 않으므로
    // 음성 버튼 없이도 텍스트 입력만으로 전체 흐름이 끊기지 않아야 한다. 추가
    // 상태변화 기록하기는(기본 보고와 달리) 상황선택 화면을 그대로 거치며, 오늘
    // 기본 돌봄보고를 먼저 제출해야 홈 화면에 나타난다.
    await loginCare(page)
    await completeDailyReport(page)
    await startReport(page, '추가 상태변화 기록하기')
    await submitChangedReport(page, '식사량이 평소보다 적었습니다.')
    await answerFollowupsWithOptions(page)
    await expect(page.getByText('말씀해주신 내용을 정리했어요.')).toBeVisible()
  })

  test('제출한 보고를 관리자 화면에서 올바른 참여자·수급자로 확인할 수 있다', async ({ context, page: carePage }) => {
    await loginCare(carePage, 'c7', '6003')
    await startReport(carePage)
    await carePage.getByPlaceholder(/음성 대신/).fill('식사를 평소보다 적게 하셨어요')
    await carePage.getByRole('button', { name: '이야기 전달하기' }).click()
    await answerFollowupsWithOptions(carePage)
    await carePage.getByRole('button', { name: '센터에 보고하기' }).click()
    await expect(carePage.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()

    const adminPage = await context.newPage()
    await loginAdmin(adminPage)
    await adminPage.getByRole('button', { name: '보고 목록' }).click()
    // C07이 실제로 배정된 수급자(데모 데이터 기준)로 정확히 연결돼 보이는지 확인한다
    // — 코드가 비슷하다고 다른 참여자/수급자로 표시되면 안 된다.
    await expect(adminPage.getByText('C07', { exact: false }).first()).toBeVisible()
  })

  test('회귀: AI 응답이 지연돼도 질문 전환 중 대화 영역이 비어 보이지 않는다', async ({ page }) => {
    // 데모 엔진은 로컬 계산이라 원래는 즉시 응답한다. 실 운영(Gemini)의 네트워크
    // 지연 구간에서만 드러나던 버그(답변 제출 시 currentQuestion을 먼저 비우고,
    // 다음 질문/보고는 비동기 응답이 온 뒤에야 채워져 그 사이 대화 영역 전체가
    // 빈 화면으로 보임)를 이 쿼리 파라미터로 재현한다.
    await page.goto('/care?demo=1&e2eAiDelayMs=1500')
    await page.getByPlaceholder('예: c1').fill('c1')
    await page.getByPlaceholder('숫자 4자리').fill('6003')
    await page.getByRole('button', { name: '로그인' }).click()
    await startReport(page)

    await page.getByPlaceholder(/음성 대신/).fill('물을 적게 드셨어요')
    await page.getByRole('button', { name: '이야기 전달하기' }).click()
    await expect(page.getByText(/추가 확인 1\/3/)).toBeVisible()

    await page.locator('button[type="button"]').first().click()
    // 지연 구간 동안에도 로딩 안내가 보여야 한다 — 상단 전화 버튼/하단 안전고지만
    // 남고 대화 영역이 완전히 비면 안 된다.
    await expect(page.getByText('말씀하신 내용을 확인하고 있어요')).toBeVisible()
    // 지연이 끝나면 다음 질문으로 정상 이어진다.
    await expect(page.getByText(/추가 확인 2\/3/)).toBeVisible()
  })
})
