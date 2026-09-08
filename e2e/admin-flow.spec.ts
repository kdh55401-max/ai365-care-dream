import { test, expect } from '@playwright/test'
import { answerAllFollowups, loginAdmin, loginCare, resetDemo, startReport, submitChangedReport } from './helpers'

test.describe('admin-flow: /admin?demo=1 대시보드·평가·실시간 반영', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('비로그인 상태에서는 /admin 접근이 차단된다 (로그인 화면만 노출)', async ({ page }) => {
    await page.goto('/admin?demo=1')
    await expect(page.getByText('관리자 로그인')).toBeVisible()
    await expect(page.getByText('관리자 검증 화면')).not.toBeVisible()
  })

  test('잘못된 비밀번호는 거부되고, 정상 비밀번호로만 로그인된다', async ({ page }) => {
    await page.goto('/admin?demo=1')
    await page.getByPlaceholder('비밀번호').fill('wrong-password')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByText('비밀번호가 올바르지 않습니다.')).toBeVisible()
    await expect(page.getByText('관리자 검증 화면')).not.toBeVisible()

    await page.getByPlaceholder('비밀번호').fill('demo1234')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByText('관리자 검증 화면')).toBeVisible()
  })

  test('처음에는 실제 참여자 0명·누적 보고 0건이다', async ({ page }) => {
    await loginAdmin(page)
    await expect(page.getByText('0 / 9명')).toBeVisible()
    await expect(page.getByText('0 / 90건')).toBeVisible()
  })

  test('다른 탭에서 C01이 보고를 제출하면 관리자 화면에 참여자 1명·보고 1건이 반영되고, 평가 후 지표가 바뀐다', async ({ context, page: adminPage }) => {
    await loginAdmin(adminPage)

    const carePage = await context.newPage()
    await loginCare(carePage, 'C01', '1234')
    await startReport(carePage, 'A01', '오늘 돌봄보고 시작')
    await submitChangedReport(carePage, '오늘 어르신이 두 번 휘청거리셨어요.')
    await answerAllFollowups(carePage, ['오전 10시경입니다', '부축했습니다', '지금은 괜찮습니다'])
    await carePage.getByRole('button', { name: '이 내용으로 제출하기' }).click()
    await expect(carePage.getByText('센터에 보고되었습니다.')).toBeVisible()

    // 관리자는 재접속(새로고침)해서 최신 폴링 결과를 즉시 확인한다 (3초 폴링).
    await adminPage.reload()
    await expect(adminPage.getByText('1 / 9명')).toBeVisible()
    await expect(adminPage.getByText('1 / 90건')).toBeVisible()

    // C01이 두 번째 보고(추가) 제출 → 재사용 참여자 수 변경
    await carePage.goto('/care?demo=1')
    await startReport(carePage, 'A01', '추가 상태변화 보고')
    await submitChangedReport(carePage, '오늘 점심을 잘 안 드셨어요.')
    await answerAllFollowups(carePage, ['오늘 낮 12시경입니다', '조금 더 드시라고 권했습니다', '지금은 평소와 비슷합니다'])
    await carePage.getByRole('button', { name: '이 내용으로 제출하기' }).click()
    await expect(carePage.getByText('센터에 보고되었습니다.')).toBeVisible()

    await adminPage.reload()
    await expect(adminPage.getByText('실제 참여자 1명 중 1명이 2회 이상 사용')).toBeVisible()

    // 원문 평가 → AI 보고 평가 → 지표 변경
    await adminPage.getByRole('button', { name: '보고 목록' }).click()
    await adminPage.getByText('A01').first().click()
    await expect(adminPage.getByText('AI 결과 비공개')).toBeVisible()
    await adminPage.getByText('원문만으로 바로 판단 가능한가').locator('..').getByRole('button', { name: '아니오' }).click()
    await adminPage.getByText('추가 질문이 필요한가').first().locator('..').getByRole('button', { name: '예' }).click()
    await adminPage.getByRole('button', { name: '원문 평가 저장' }).click()
    await expect(adminPage.getByText(/저장됨/)).toBeVisible()

    await expect(adminPage.getByText('2단계 · AI 적용 후 평가')).toBeVisible()
    const stage2 = adminPage.locator('section', { hasText: '2단계' })
    await stage2.getByText('최종보고만으로 바로 이해 가능한가').locator('..').getByRole('button', { name: '예' }).click()
    await stage2.getByText('추가 질문이 필요한가').locator('..').getByRole('button', { name: '아니오' }).click()
    await stage2.getByText('실제 추가 전화·문자 확인 발생').locator('..').getByRole('button', { name: '필요없음' }).click()
    await stage2.getByText('사실과 다른 내용이 포함됐는가').locator('..').getByRole('button', { name: '아니오' }).click()
    await adminPage.getByRole('button', { name: 'AI 평가 저장' }).click()
    await expect(adminPage.getByText('이 건의 변화')).toBeVisible()

    await adminPage.getByRole('button', { name: '대시보드' }).click()
    await expect(adminPage.getByText(/AI 적용 후 \d+%/)).toBeVisible()
  })

  test('피칭 화면에는 민감한 원문 대신 요약 지표만 보인다', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/presentation?demo=1')
    await expect(page.getByText('AI365 CARE DREAM 초기 실증 성과')).toBeVisible()
    await expect(page.getByText('실제 참여자')).toBeVisible()
    await expect(page.getByText('PIN')).not.toBeVisible()
    await expect(page.getByText('전체 CSV')).not.toBeVisible()
  })
})
