import { test, expect } from '@playwright/test'
import { DEMO_SUBMITTED_TEXT, answerFollowupsWithOptions, loginCare, resetDemo, startReport, switchRecipient } from './helpers'

/** 설계 검토 결정 D3 회귀 테스트: "오늘 기본보고 제출 여부"와 "기본보고 시작 가능
 * 여부"는 요양보호사 전체가 아니라 지금 선택된 수급자 기준이어야 한다. 데모 배정
 * (demoStore.ts DEMO_ASSIGNMENTS)에서 C01은 A01·A02 두 명에게 배정돼 있어 이
 * 시나리오를 그대로 재현할 수 있다. */
test.describe('multi-recipient-flow: 대상자별 기본보고 완료 상태 분리 (D3)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('A02 기본보고 제출 후에도 A01은 미제출로 남고, 두 수급자 모두 각자 기본보고를 낼 수 있다', async ({ page }) => {
    test.setTimeout(60_000)
    await loginCare(page, 'c1', '6003')
    await expect(page.getByText('A01 어르신', { exact: true })).toBeVisible()
    await expect(page.getByText('이야기할 준비가 됐어요', { exact: true })).toBeVisible()

    // 대상자를 A02로 바꾼다 — 아직 아무 것도 제출하지 않았으므로 A02도 미제출이어야 한다.
    await switchRecipient(page, 'A02')
    await expect(page.getByText('A02 어르신', { exact: true })).toBeVisible()
    await expect(page.getByText('이야기할 준비가 됐어요', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '이야기 시작' })).toBeVisible()

    // A02의 기본보고를 먼저 제출한다.
    await startReport(page)
    await page.getByPlaceholder(/음성 대신/).fill('A02 어르신은 오늘 식사를 잘 하셨어요')
    await page.getByRole('button', { name: '이야기 전달하기' }).click()
    await answerFollowupsWithOptions(page)
    if (await page.getByText('말씀해주신 내용을 정리했어요.').isVisible().catch(() => false)) {
      await page.getByRole('button', { name: '센터에 보고하기' }).click()
    }
    await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
    await page.getByRole('button', { name: '홈으로' }).click()

    // A02는 완료로 보여야 한다.
    await expect(page.getByText('A02 어르신', { exact: true })).toBeVisible()
    await expect(page.getByText('오늘 돌봄기록을 남겼어요')).toBeVisible()

    // 대상자를 A01로 되돌리면 — A02 제출과 무관하게 A01은 여전히 미제출이어야
    // 하고, "이야기 시작" 시작 경로가 숨어 있으면 안 된다(설계 검토 결정 D3의
    // 핵심 회귀 조건).
    await switchRecipient(page, 'A01')
    await expect(page.getByText('A01 어르신', { exact: true })).toBeVisible()
    await expect(page.getByText('이야기할 준비가 됐어요', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '이야기 시작' })).toBeVisible()

    // A01의 기본보고도 별도로 정상 제출할 수 있어야 한다(다른 수급자 제출
    // 때문에 "이미 제출했습니다" 오류가 나면 안 된다).
    await startReport(page)
    await page.getByPlaceholder(/음성 대신/).fill('A01 어르신은 오늘 산책을 하셨어요')
    await page.getByRole('button', { name: '이야기 전달하기' }).click()
    await answerFollowupsWithOptions(page)
    if (await page.getByText('말씀해주신 내용을 정리했어요.').isVisible().catch(() => false)) {
      await page.getByRole('button', { name: '센터에 보고하기' }).click()
    }
    await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
    await page.getByRole('button', { name: '홈으로' }).click()

    // 이제 두 수급자 모두 완료 상태여야 하고, 서로의 상태가 섞이지 않아야 한다.
    await expect(page.getByText('A01 어르신', { exact: true })).toBeVisible()
    await expect(page.getByText('오늘 돌봄기록을 남겼어요')).toBeVisible()
    await switchRecipient(page, 'A02')
    await expect(page.getByText('A02 어르신', { exact: true })).toBeVisible()
    await expect(page.getByText('오늘 돌봄기록을 남겼어요')).toBeVisible()
  })
})
