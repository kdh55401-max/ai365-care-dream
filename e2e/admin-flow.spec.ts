import { test, expect } from '@playwright/test'
import {
  DEMO_SUBMITTED_TEXT,
  answerAllFollowups,
  loginAdmin,
  loginCare,
  openResearchKpiDetails,
  resetDemo,
  startReport,
  submitChangedReport,
} from './helpers'

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
    await openResearchKpiDetails(page)
    await expect(page.getByText('0 / 9명')).toBeVisible()
    await expect(page.getByText('0 / 90건')).toBeVisible()
  })

  test('다른 탭에서 C01이 보고를 제출하면 관리자 화면에 참여자 1명·보고 1건이 반영되고, 평가 후 지표가 바뀐다', async ({ context, page: adminPage }) => {
    // 이 테스트는 보고 2건 제출 + 2단계 평가 + 대시보드 재조회까지 한 번에
    // 거치는 무거운 시나리오라 기본 30초 제한에 여유가 없다.
    test.setTimeout(60_000)
    await loginAdmin(adminPage)

    const carePage = await context.newPage()
    await loginCare(carePage, 'c1', '6003')
    await startReport(carePage)
    await carePage.getByPlaceholder(/음성 대신/).fill('오늘 어르신이 두 번 휘청거리셨어요.')
    await carePage.getByRole('button', { name: '이 내용으로 보고하기' }).click()
    await answerAllFollowups(carePage, ['오전 10시경입니다', '부축했습니다', '지금은 괜찮습니다'])
    await carePage.getByRole('button', { name: '이대로 센터에 보내기' }).click()
    await expect(carePage.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()

    // 관리자는 재접속(새로고침)해서 최신 폴링 결과를 즉시 확인한다 (3초 폴링).
    // 새로고침하면 네이티브 <details>는 항상 닫힌 상태로 돌아가므로 다시 연다.
    await adminPage.reload()
    await openResearchKpiDetails(adminPage)
    await expect(adminPage.getByText('1 / 9명')).toBeVisible()
    await expect(adminPage.getByText('1 / 90건')).toBeVisible()

    // C01이 두 번째 보고(추가) 제출 → 재사용 참여자 수 변경
    await carePage.goto('/care?demo=1')
    await startReport(carePage, '추가 상태변화 기록하기')
    await submitChangedReport(carePage, '오늘 점심을 잘 안 드셨어요.')
    await answerAllFollowups(carePage, ['오늘 낮 12시경입니다', '조금 더 드시라고 권했습니다', '지금은 평소와 비슷합니다'])
    await carePage.getByRole('button', { name: '이대로 센터에 보내기' }).click()
    await expect(carePage.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()

    // 재사용률은 "첫 제출일이 오늘보다 이전인" 참여자만 분모로 센다(다시 쓸 기회가
    // 아직 없었을 수 있는 당일 첫 제출자는 "관찰 중"으로 분리) — C01의 두 보고가
    // 모두 오늘 제출됐으므로 아직 퍼센트가 아니라 "관찰 중"으로 표시된다.
    await adminPage.reload()
    await openResearchKpiDetails(adminPage)
    // "관찰 중"은 카드 값과 보조 설명 문구 둘 다에 나타나므로 값 쪽만 정확히 짚는다.
    await expect(adminPage.getByText('관찰 중', { exact: true })).toBeVisible()
    await expect(adminPage.getByText(/첫 제출이 오늘인 1명은 관찰 중/)).toBeVisible()

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
    await openResearchKpiDetails(adminPage)
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
