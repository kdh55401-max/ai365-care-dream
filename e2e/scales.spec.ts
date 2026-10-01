import { test, expect, type Page } from '@playwright/test'
import { loginAdmin, resetDemo } from './helpers'

/** 표준화 척도 실시 — 응답 번호 입력 → 척도집 규칙 채점 → 정식 척도 결과로 저장 → 사전·사후 이력. 데모 모드(localStorage).
 * 채점 규칙 자체는 shared/scales.test.ts에서 척도별로 검증한다. */

const RECIPIENT_URL = '/admin/org/gadream365/recipients/A01?demo=1'
const section = (page: Page) => page.getByRole('region', { name: '표준화 척도' })

async function enterCaregiverBurden(page: Page, date: string, answers: number[], memo: string) {
  const s = section(page)
  await s.getByRole('button', { name: '척도 실시 결과 입력' }).click()
  const form = s.getByLabel('척도 실시 입력')
  await form.getByLabel('척도 선택').selectOption({ label: '부양부담 척도 (12문항 · 보호자 응답)' })
  await form.getByLabel('측정일').fill(date)
  // 하나라도 비면 저장 버튼이 잠긴다
  for (const [i, v] of answers.slice(0, -1).entries()) await form.getByLabel(new RegExp(`^${i + 1}번 ${v} `)).check({ force: true })
  await expect(form.getByTestId('scale-preview')).toContainText('응답하지 않은 문항 1개')
  await expect(form.getByRole('button', { name: '저장하고 관리자 확인' })).toBeDisabled()
  await form.getByLabel(new RegExp(`^12번 ${answers[11]} `)).check({ force: true })
  await form.getByLabel('척도 메모').fill(memo)
  return form
}

test.describe('표준화 척도 실시', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
    await loginAdmin(page)
    await page.goto(RECIPIENT_URL)
  })

  test('응답 번호만 입력하면 척도집 규칙대로 채점해 정식 척도 결과로 저장하고, 사전·사후 변화를 판정 없이 보여준다', async ({ page }) => {
    const pre = await enterCaregiverBurden(page, '2026-07-01', [3, 3, 3, 4, 4, 4, 3, 3, 3, 2, 2, 2], '사전 측정')
    await expect(pre.getByTestId('scale-preview')).toContainText('총점 36점(12~48)')
    await expect(pre.getByTestId('scale-preview')).toContainText('신체적 부담 9/12')
    await pre.getByRole('button', { name: '저장하고 관리자 확인' }).click()
    await expect(pre).toHaveCount(0)

    const history = section(page).getByTestId('scale-history')
    await expect(history).toContainText('부양부담 척도')
    await expect(history).toContainText('관리자 확인된 측정이 2회 이상이면')

    const post = await enterCaregiverBurden(page, '2026-09-30', [2, 2, 2, 3, 3, 3, 2, 2, 2, 2, 2, 2], '3개월 후')
    await expect(post.getByTestId('scale-preview')).toContainText('총점 27점')
    await post.getByRole('button', { name: '저장하고 관리자 확인' }).click()
    await expect(post).toHaveCount(0)

    await expect(history).toContainText('첫 측정 36 → 최근 27점 (-9, 점수 낮아짐 — 이 척도는 점수가 높을수록 부양부담이 높음)')
    await expect(history).not.toContainText(/개선|악화|호전/)

    // 기존 기준정보 목록에도 같은 값이 '정식 척도 결과'로, 앱 채점 근거와 함께 보인다
    const baseline = page.getByRole('region', { name: '기준문서 · 기준정보' })
    await expect(baseline.getByText('부양부담(이혜자) 척도집2017').first()).toBeVisible()
    await expect(baseline.getByText('기관이 실시한 표준화 척도 — 앱이 척도집 규칙대로 채점').first()).toBeVisible()
  })

  test('문항 원문은 화면에 없고 번호·응답 보기만 보인다', async ({ page }) => {
    const s = section(page)
    await s.getByRole('button', { name: '척도 실시 결과 입력' }).click()
    const form = s.getByLabel('척도 실시 입력')
    await form.getByLabel('척도 선택').selectOption({ label: '한국판 단축형 노인 우울 척도 (15문항)' })
    await expect(form).toContainText('응답 보기: 1=예 · 0=아니오')
    await expect(form).not.toContainText('자신의 생활에 만족합니까')
  })
})
