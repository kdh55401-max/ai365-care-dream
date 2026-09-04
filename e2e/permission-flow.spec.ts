import { test, expect } from '@playwright/test'
import { answerAllFollowups, loginCare, resetDemo, startReport, submitChangedReport } from './helpers'

test.describe('permission-flow: 참여자 간 격리, 로그인/로그아웃 보호', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('잘못된 PIN은 거부된다', async ({ page }) => {
    await page.goto('/care?demo=1')
    await page.getByPlaceholder('예: C01').fill('C01')
    await page.getByPlaceholder('숫자 4자리').fill('0000')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByText('참여자 코드 또는 PIN이 올바르지 않습니다.')).toBeVisible()
  })

  test('C01이 작성한 보고는 C02의 "최근 본인 보고 목록"에 보이지 않는다', async ({ context, browser }) => {
    // 세션은 브라우저 프로필(=localStorage) 단위로 유지되므로, 같은 컨텍스트의
    // 두 탭은 실제 쿠키 기반 로그인과 마찬가지로 항상 "같은 로그인 상태"를
    // 공유한다(둘 다 C01로 남는다). 서로 다른 참여자로 각각 로그인하려면
    // 별도 브라우저 프로필, 즉 Playwright의 별도 context가 필요하다 — 새
    // context는 storage가 완전히 분리되므로 C02는 깨끗한 상태에서 로그인한다.
    const p1 = await context.newPage()
    await loginCare(p1, 'C01', '1234')
    await startReport(p1, 'A01', '오늘 돌봄보고 시작')
    await submitChangedReport(p1, 'C01의 보고입니다.')
    await answerAllFollowups(p1, ['오전 9시입니다', '확인했습니다', '지금은 괜찮습니다'])
    await p1.getByRole('button', { name: '이 내용으로 제출하기' }).click()
    await expect(p1.getByText('센터에 보고되었습니다.')).toBeVisible()

    const context2 = await browser.newContext()
    const p2 = await context2.newPage()
    await loginCare(p2, 'C02', '1234')
    await p2.getByRole('button', { name: '최근 본인 보고 목록' }).click()
    await expect(p2.getByText('아직 작성한 보고가 없습니다.')).toBeVisible()
    await context2.close()
  })

  test('로그아웃 후에는 다시 로그인 화면으로 돌아간다', async ({ page }) => {
    await loginCare(page)
    await page.getByRole('button', { name: '로그아웃' }).click()
    await expect(page.getByText('참여자 코드')).toBeVisible()
    await expect(page.getByText('오늘 돌봄보고 시작')).not.toBeVisible()
  })
})
