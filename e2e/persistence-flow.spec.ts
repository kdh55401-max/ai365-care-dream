import { test, expect } from '@playwright/test'
import { DEMO_SUBMITTED_TEXT, answerAllFollowups, loginAdmin, loginCare, resetDemo, startReport } from './helpers'

test.describe('persistence-flow: 새로고침 후에도 제출·평가 데이터 유지', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('보고 제출 후 새로고침해도 "오늘 돌봄기록을 남겼어요"가 유지된다', async ({ page }) => {
    await loginCare(page)
    await startReport(page)
    await page.getByPlaceholder(/음성 대신/).fill('오늘 어르신 컨디션이 평소와 달랐어요.')
    await page.getByRole('button', { name: '이 내용으로 보고하기' }).click()
    await answerAllFollowups(page, ['오전입니다', '확인했습니다', '지금은 괜찮습니다'])
    await page.getByRole('button', { name: '이대로 센터에 보내기' }).click()
    await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()

    await page.getByRole('button', { name: '홈으로' }).click()
    await page.reload()
    await expect(page.getByText('오늘 돌봄기록을 남겼어요')).toBeVisible()
  })

  test('입력 중 새로고침해도 작성하던 내용이 복구된다', async ({ page }) => {
    await loginCare(page)
    await startReport(page)
    await page.getByPlaceholder(/음성 대신/).fill('작성 중이던 관찰 내용입니다.')

    await page.reload()
    await expect(page.getByPlaceholder(/음성 대신/)).toHaveValue('작성 중이던 관찰 내용입니다.')
  })

  test('관리자 평가를 저장한 뒤 새로고침해도 평가 결과가 유지된다', async ({ context }) => {
    const carePage = await context.newPage()
    // 이후 관리자 화면에서 'A01'을 찾으므로, C01(→A01)로 명시해 로그인한다.
    await loginCare(carePage, 'c1', '6003')
    await startReport(carePage)
    await carePage.getByPlaceholder(/음성 대신/).fill('평가 유지 테스트용 보고입니다.')
    await carePage.getByRole('button', { name: '이 내용으로 보고하기' }).click()
    await answerAllFollowups(carePage, ['오전입니다', '확인했습니다', '지금은 괜찮습니다'])
    await carePage.getByRole('button', { name: '이대로 센터에 보내기' }).click()
    await expect(carePage.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()

    const adminPage = await context.newPage()
    await loginAdmin(adminPage)
    await adminPage.getByRole('button', { name: '보고 목록' }).click()
    await adminPage.getByText('A01').first().click()
    await adminPage.getByText('원문만으로 바로 판단 가능한가').locator('..').getByRole('button', { name: '예' }).click()
    await adminPage.getByText('추가 질문이 필요한가').first().locator('..').getByRole('button', { name: '아니오' }).click()
    await adminPage.getByRole('button', { name: '원문 평가 저장' }).click()
    await expect(adminPage.getByText(/저장됨/)).toBeVisible()

    // 보고 상세 화면은 URL이 아니라 React 상태이므로, 새로고침 후에는 목록에서
    // 같은 보고를 다시 열어 "데이터가 서버(데모 스토어)에 남아있는지"를 확인한다.
    await adminPage.reload()
    await adminPage.getByRole('button', { name: '보고 목록' }).click()
    await adminPage.getByText('A01').first().click()
    await expect(adminPage.getByText(/저장됨/)).toBeVisible()
    await expect(adminPage.getByRole('button', { name: '원문 평가 다시 저장' })).toBeVisible()
  })
})
