import { test, expect, type Page } from '@playwright/test'
import { DEMO_SUBMITTED_TEXT, answerAllFollowups, loginAdmin, loginCare, resetDemo, startReport } from './helpers'

/** 1단계(관리자 허브): 기관 → 수급자 목록 → 수급자 상세 타임라인, 기관 첫 화면의
 * 검토 대기 보고와 이유, 기존 승인/반려와의 연결, 새로고침·직접 URL·뒤로가기·다른
 * 기관 차단. 데모 모드(localStorage)로 화면 흐름만 검증한다 — 실제 DB·서버 권한은
 * 단위테스트(api/_lib/adminOrganization.test.ts)와 운영 확인으로 따로 본다. */

const RAW = '오늘 식사를 평소보다 적게 하셨어요.'

async function submitFieldReport(page: Page) {
  await loginCare(page, 'c1', '6003')
  await startReport(page)
  await page.getByPlaceholder(/음성 대신/).fill(RAW)
  await page.getByRole('button', { name: '이야기 전달하기' }).click()
  await answerAllFollowups(page, ['점심때입니다', '조금 더 드시라고 권했습니다', '지금은 평소와 비슷합니다'])
  await page.getByRole('button', { name: '센터에 보고하기' }).click()
  await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
}

test.describe('recipient-hub: 기관 → 수급자 → 보고 타임라인', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('현장 제출 → 기관 첫 화면 검토 대기(이유) → 수급자 타임라인 → 승인 → 뒤로·새로고침에도 유지', async ({ context, page: carePage }) => {
    test.setTimeout(60_000)
    await submitFieldReport(carePage)

    const admin = await context.newPage()
    await loginAdmin(admin)
    // 2단계부터 첫 화면은 업무 카드 → 카드를 누르면 같은 조건의 전체 목록(검토 대기 이유 포함)
    await admin.getByRole('button', { name: /^새 보고 미확인/ }).click()
    await expect(admin.getByText('수급자 A01')).toBeVisible()
    await expect(admin.getByText('요양보호사 C01')).toBeVisible()
    await expect(admin.getByText('제출 후 승인·반려 기록 없음')).toBeVisible()

    await admin.getByRole('button', { name: 'A01 기록 흐름 보기' }).click()
    await expect(admin).toHaveURL(/\/admin\/org\/gadream365\/recipients\/A01\?demo=1/)
    await expect(admin.getByRole('heading', { name: '수급자 A01' })).toBeVisible()
    await expect(admin.getByText('담당 요양보호사: C01')).toBeVisible()

    const card = admin.locator('article').first()
    await expect(card.getByText('작성: 요양보호사 C01')).toBeVisible()
    await expect(card.getByText('검토 대기', { exact: true }).first()).toBeVisible()
    // 원문과 구조화 기록이 다른 칸으로 나뉘어 있다
    await expect(card.locator('section', { hasText: '① 보고 원문' }).getByText(RAW)).toBeVisible()
    await expect(card.locator('section', { hasText: '② 구조화 기록' })).toBeVisible()
    await expect(card.locator('section', { hasText: '③ 관리자 검토' })).toBeVisible()
    await expect(card.getByText(/항목별 상태가 저장되지 않았습니다|항목별 상태 \(보고 때 저장된 값만\)/).first()).toBeVisible()

    await card.getByRole('button', { name: /원본 보고 열기/ }).click()
    await expect(admin).toHaveURL(/\/admin\/reports\/[^?]+\?demo=1/)
    await admin.getByRole('button', { name: '승인', exact: true }).click()
    await expect(admin.getByText('승인본 (활용 가능 기록)')).toBeVisible()

    await admin.getByRole('button', { name: '← 뒤로' }).click()
    await expect(admin).toHaveURL(/\/recipients\/A01/)
    await expect(admin.locator('article').first().getByText('승인됨').first()).toBeVisible()
    await expect(admin.getByText('검토 대기 0건')).toBeVisible()

    await admin.reload()
    await expect(admin.getByRole('heading', { name: '수급자 A01' })).toBeVisible()
    await expect(admin.locator('article').first().getByText('승인됨').first()).toBeVisible()

    // 기관 첫 화면에서도 검토 대기에서 빠진다
    await admin.getByRole('button', { name: '대시보드' }).click()
    await expect(admin.getByRole('button', { name: /^새 보고 미확인/ })).toContainText('0건')
  })

  test('수급자 목록에서 담당·최근 제출·검토 대기를 보고 상세로 이동, 브라우저 뒤로가기로 돌아온다', async ({ context, page: carePage }) => {
    await submitFieldReport(carePage)
    const admin = await context.newPage()
    await loginAdmin(admin)

    await admin.getByRole('button', { name: '수급자', exact: true }).click()
    await expect(admin).toHaveURL(/\/admin\/org\/gadream365\/recipients\?demo=1/)
    await expect(admin.getByRole('heading', { name: /가드림365재가복지센터 · 수급자 9명/ })).toBeVisible()
    const first = admin.getByRole('button', { name: /수급자 A01/ })
    await expect(first).toContainText('검토 대기 1건')
    await expect(first).toContainText('담당 요양보호사: C01')
    const noReports = admin.getByRole('button', { name: /수급자 A02/ })
    await expect(noReports).toContainText('제출된 보고 없음')

    await first.click()
    await expect(admin.getByRole('heading', { name: '수급자 A01' })).toBeVisible()
    await admin.goBack()
    await expect(admin.getByRole('heading', { name: /수급자 9명/ })).toBeVisible()

    // 기간 전환: 오늘 보고는 7일에도 보이고, 보고 없는 수급자는 빈 상태를 명확히 보여준다
    await noReports.click()
    await expect(admin.getByText('선택한 기간에 제출된 보고가 없습니다.')).toBeVisible()
    await admin.getByRole('button', { name: '최근 7일' }).click()
    await expect(admin).toHaveURL(/period=7/)
    await expect(admin.getByText('제출된 보고가 없습니다.', { exact: true })).toBeVisible()
  })

  test('직접 URL: 다른 기관은 차단, 없는 수급자·없는 보고는 이유를 보여준다', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/org/other-center/recipients/A01?demo=1')
    await expect(page.getByText('이 기관의 기록에 접근할 권한이 없습니다.')).toBeVisible()
    await expect(page.locator('article')).toHaveCount(0)

    await page.goto('/admin/org/other-center/recipients?demo=1')
    await expect(page.getByText('이 기관의 기록에 접근할 권한이 없습니다.')).toBeVisible()

    await page.goto('/admin/org/gadream365/recipients/Z99?demo=1')
    await expect(page.getByText('이 기관에서 해당 수급자를 찾을 수 없습니다.')).toBeVisible()

    await page.goto('/admin/reports/not-a-real-id?demo=1')
    await expect(page.getByText(/보고를 찾을 수 없습니다/)).toBeVisible()
  })
})
