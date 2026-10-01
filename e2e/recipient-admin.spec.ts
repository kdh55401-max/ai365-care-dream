import { test, expect, type Page } from '@playwright/test'
import { completeDailyReport, loginAdmin, loginCare, resetDemo } from './helpers'

/** 관리자 수급자 등록·배정 → 요양보호사 표시 → 기존 AI 돌봄기록 → 관리자 확인. 데모 모드(?demo=1, 브라우저 localStorage)라
 * 운영 DB·운영 집계와 섞이지 않는다. 실제 서버 권한·DB 저장은 api/_lib/recipientFlow.test.ts(실제 Postgres 엔진)가 검증한다. */

async function openRecipientAdmin(page: Page) {
  await page.getByRole('button', { name: '수급자', exact: true }).click()
  await expect(page.getByRole('heading', { name: /수급자 · \d+명/ })).toBeVisible()
}

async function adminLogout(page: Page) {
  await page.getByRole('button', { name: '로그아웃' }).click()
}

test.describe('recipient-admin: 수급자 등록 → 담당 요양보호사 → 돌봄기록 → 관리자 확인', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('등록·새로고침 유지·수정·배정 변경·요양보호사 표시·기록 제출·관리자 확인', async ({ page }) => {
    test.setTimeout(90_000)
    await loginAdmin(page)
    await openRecipientAdmin(page)
    // 기존 수급자는 그대로 보인다.
    await expect(page.locator('[data-recipient-code="A01"]')).toContainText('C01')

    // 입력 오류: 표시명 없이 저장 → 오류가 나고 폼은 닫히지 않는다.
    await page.getByRole('button', { name: '수급자 추가' }).click()
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('이름')
    await expect(page.getByRole('form', { name: '수급자 추가' })).toBeVisible()

    // 등록 — 표시명 + 담당 요양보호사 C08.
    await page.getByLabel('이름', { exact: true }).fill('햇살 어르신')
    await page.getByLabel('C08').check()
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('수급자 A10을(를) 등록했습니다')
    const row = page.locator('[data-recipient-code="A10"]')
    await expect(row).toContainText('햇살 어르신')
    await expect(row).toContainText('C08')
    await expect(row).toContainText('활성')

    // 새로고침해도 남아 있다.
    await page.reload()
    await openRecipientAdmin(page)
    await expect(page.locator('[data-recipient-code="A10"]')).toContainText('햇살 어르신')

    // 담당자 없이 등록하면 '담당자 미배정'이 명확히 보인다.
    await page.getByRole('button', { name: '수급자 추가' }).click()
    await page.getByLabel('이름', { exact: true }).fill('바람 어르신')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('[data-recipient-code="A11"]')).toContainText('담당자 미배정')

    // 수정 — 표시명 변경 + 담당자 추가(C09).
    await page.locator('[data-recipient-code="A10"]').getByRole('button', { name: '수정' }).click()
    await page.getByLabel('이름', { exact: true }).fill('햇살 할머니')
    await page.getByLabel('C09').check()
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('[data-recipient-code="A10"]')).toContainText('햇살 할머니')
    await expect(page.locator('[data-recipient-code="A10"]')).toContainText('C09')

    await adminLogout(page)

    // 담당 요양보호사 C08 — 새 수급자가 표시된다. 담당 아닌 C07(A09 담당)은 A10을 보지 못한다.
    await loginCare(page, 'c8', '6003')
    await expect(page.getByText('A10 · 햇살 할머니 어르신', { exact: true })).toBeVisible()
    await completeDailyReport(page, 'A10 어르신은 오늘 식사를 잘 하셨어요')
    await expect(page.getByText('오늘 돌봄기록을 남겼어요')).toBeVisible()

    await page.getByText('연습 및 계정', { exact: true }).click()
    await page.getByRole('button', { name: '로그아웃' }).click()
    await loginCare(page, 'c7', '6003')
    await expect(page.getByText('A09 어르신', { exact: true })).toBeVisible()
    await expect(page.getByText('A10', { exact: false })).toHaveCount(0)
    await page.getByText('연습 및 계정', { exact: true }).click()
    await page.getByRole('button', { name: '로그아웃' }).click()

    // 관리자가 제출된 기록을 그 수급자와 연결해 확인한다.
    await loginAdmin(page)
    await page.getByRole('button', { name: '수급자 변화' }).click()
    await page.getByRole('button', { name: /수급자 A10/ }).click()
    await expect(page.getByText('C08').first()).toBeVisible()
  })

  test('배정 해제·비활성화 뒤에는 로그인 중인 화면에서도 새 기록 시작이 서버 확인으로 차단된다', async ({ page, context }) => {
    test.setTimeout(90_000)
    await loginAdmin(page)
    await openRecipientAdmin(page)
    await page.getByRole('button', { name: '수급자 추가' }).click()
    await page.getByLabel('이름', { exact: true }).fill('구름 어르신')
    await page.getByLabel('C08').check()
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('[data-recipient-code="A10"]')).toContainText('C08')

    // 같은 브라우저의 다른 탭에서 요양보호사가 로그인해 홈을 열어 둔다(관리자 세션은 따로 유지된다).
    const care = await context.newPage()
    await loginCare(care, 'c8', '6003')
    await expect(care.getByRole('button', { name: '이야기 시작' })).toBeVisible()

    // 관리자가 배정을 해제한다.
    await page.locator('[data-recipient-code="A10"]').getByRole('button', { name: '수정' }).click()
    await page.getByLabel('C08').uncheck()
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('[data-recipient-code="A10"]')).toContainText('담당자 미배정')

    // 이미 열려 있던 화면에서 새 기록을 시작하면 막히고 안내가 나온다.
    await care.getByRole('button', { name: '이야기 시작' }).click()
    await expect(care.getByText('더 이상 내게 배정되어 있지 않아')).toBeVisible()
    await expect(care.getByText('배정된 수급자가 없습니다.')).toBeVisible()
    await expect(care.getByRole('button', { name: '이야기 시작' })).toHaveCount(0)

    // 다시 배정 + 비활성화 → 역시 차단되고, 관리자 화면에는 '비활성'이 보인다.
    await page.locator('[data-recipient-code="A10"]').getByRole('button', { name: '수정' }).click()
    await page.getByLabel('C08').check()
    await page.getByLabel('활성', { exact: true }).uncheck()
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('[data-recipient-code="A10"]')).toContainText('비활성')
    await care.reload()
    await expect(care.getByText('배정된 수급자가 없습니다.')).toBeVisible()
  })

  test('모바일에서 폼이 화면 폭을 넘지 않는다', async ({ page }) => {
    await loginAdmin(page)
    await openRecipientAdmin(page)
    await page.getByRole('button', { name: '수급자 추가' }).click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  // ERP 전환 2단계: 로그인 직후 첫 화면이 이지케어식 수급자 목록이고, 인적사항(가상 값)을 입력·검색·필터할 수 있다.
  test('로그인하면 수급자 목록이 첫 화면이고, 인적사항 입력·검색·필터·중복 차단이 된다', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/admin?demo=1')
    await page.getByPlaceholder('비밀번호').fill('demo1234')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByRole('heading', { name: /수급자 · \d+명/ })).toBeVisible()
    await expect(page).toHaveURL(/\/admin\?demo=1$/)

    await page.getByRole('button', { name: '수급자 추가' }).click()
    await page.getByLabel('이름', { exact: true }).fill('가상 어르신')
    await page.getByLabel('장기요양인정번호').fill('l0000000001001')
    await page.getByLabel('장기요양등급').selectOption('4등급')
    await page.getByLabel('인정 유효기간 시작').fill('2025-02-25')
    await page.getByLabel('인정 유효기간 종료').fill('2029-02-24')
    await page.getByLabel('C08').check()
    await page.getByRole('button', { name: '저장', exact: true }).click()
    const row = page.locator('[data-recipient-code="A10"]')
    await expect(row).toContainText('가상 어르신')
    await expect(row).toContainText('L0000000001-001')
    await expect(row).toContainText('4등급')
    await expect(row).toContainText('2025-02-25 ~ 2029-02-24')

    // 같은 인정번호는 다시 등록할 수 없다 — 사유가 보이고 입력은 남는다.
    await page.getByRole('button', { name: '수급자 추가' }).click()
    await page.getByLabel('이름', { exact: true }).fill('다른 어르신')
    await page.getByLabel('장기요양인정번호').fill('L0000000001-001')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('이미 등록된 장기요양인정번호')
    await expect(page.getByLabel('이름', { exact: true })).toHaveValue('다른 어르신')
    await page.getByRole('button', { name: '취소' }).click()

    // 검색(이름·인정번호·코드)과 보기 조건.
    await page.getByLabel('수급자 찾기').fill('0000000001')
    await expect(page.locator('[data-recipient-code]')).toHaveCount(1)
    await page.getByLabel('수급자 찾기').fill('')
    await page.getByRole('button', { name: '담당 미배정' }).click()
    await expect(page.locator('[data-recipient-code="A10"]')).toHaveCount(0)
    await page.getByRole('button', { name: '전체' }).click()

    // 새로고침해도 남아 있다.
    await page.reload()
    await expect(page.locator('[data-recipient-code="A10"]')).toContainText('L0000000001-001')
  })
})
