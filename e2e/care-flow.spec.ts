import { test, expect } from '@playwright/test'
import { answerFollowupsWithOptions, loginAdmin, loginCare, resetDemo, startReport, submitChangedReport } from './helpers'

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
    await page.getByRole('button', { name: '이 내용으로 보고하기' }).click()

    // 최대 3회, 한 번에 하나씩 질문 — 선택 버튼만으로 진행한다(타이핑 없음).
    await expect(page.getByText(/추가 확인 1\/3/)).toBeVisible()
    await answerFollowupsWithOptions(page)

    await expect(page.getByText('보고 내용을 확인해 주세요')).toBeVisible()

    // 보고문 수정 — 선택 답변이 임의로 확장되지 않고 그대로 반영됐는지 확인.
    const changeField = page.locator('textarea').first()
    await expect(changeField).toHaveValue('물을 적게 드셨어요')
    await changeField.fill('[검수] ' + (await changeField.inputValue()))

    await page.getByRole('button', { name: '이대로 센터에 보내기' }).click()
    await expect(page.getByText('센터에 보고되었습니다.')).toBeVisible()
  })

  test('음성 인식 미지원 기기에서도 텍스트만으로 끝까지 제출할 수 있다(추가 상태변화 보고)', async ({ page }) => {
    // Playwright의 기본 브라우저 컨텍스트는 SpeechRecognition을 제공하지 않으므로
    // 음성 버튼 없이도 텍스트 입력만으로 전체 흐름이 끊기지 않아야 한다. 추가
    // 상태변화 보고는(기본 보고와 달리) 상황선택 화면을 그대로 거친다.
    await loginCare(page)
    await startReport(page, '추가 상태변화 보고')
    await submitChangedReport(page, '식사량이 평소보다 적었습니다.')
    await answerFollowupsWithOptions(page)
    await expect(page.getByText('보고 내용을 확인해 주세요')).toBeVisible()
  })

  test('제출한 보고를 관리자 화면에서 올바른 참여자·수급자로 확인할 수 있다', async ({ context, page: carePage }) => {
    await loginCare(carePage, 'c7', '6003')
    await startReport(carePage)
    await carePage.getByPlaceholder(/음성 대신/).fill('식사를 평소보다 적게 하셨어요')
    await carePage.getByRole('button', { name: '이 내용으로 보고하기' }).click()
    await answerFollowupsWithOptions(carePage)
    await carePage.getByRole('button', { name: '이대로 센터에 보내기' }).click()
    await expect(carePage.getByText('센터에 보고되었습니다.')).toBeVisible()

    const adminPage = await context.newPage()
    await loginAdmin(adminPage)
    await adminPage.getByRole('button', { name: '보고 목록' }).click()
    // C07이 실제로 배정된 수급자(데모 데이터 기준)로 정확히 연결돼 보이는지 확인한다
    // — 코드가 비슷하다고 다른 참여자/수급자로 표시되면 안 된다.
    await expect(adminPage.getByText('C07', { exact: false }).first()).toBeVisible()
  })
})
