import { expect, type Page } from '@playwright/test'

/** 데모 모드는 요구사항대로 브라우저(프로필)당 localStorage에만 저장되므로,
 * 각 테스트를 독립적으로 만들기 위해 시작할 때 항상 초기화한다. */
export async function resetDemo(page: Page) {
  await page.goto('/care?demo=1')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
}

export async function loginCare(page: Page, code = 'C01', pin = '1234') {
  await page.goto('/care?demo=1')
  await page.getByPlaceholder('예: C01').fill(code)
  await page.getByPlaceholder('숫자 4자리').fill(pin)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByText(code, { exact: true })).toBeVisible()
}

export async function loginAdmin(page: Page, password = 'demo1234') {
  await page.goto('/admin?demo=1')
  await page.getByPlaceholder('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByText('관리자 검증 화면')).toBeVisible()
}

/** 홈에서 수급자를 고르고 "오늘 돌봄보고 시작" 또는 "추가 상태변화 보고"를 누른다. */
export async function startReport(page: Page, recipient = 'A01', kind: '오늘 돌봄보고 시작' | '추가 상태변화 보고' = '오늘 돌봄보고 시작') {
  await page.getByRole('combobox').selectOption(recipient)
  await page.getByRole('button', { name: kind }).click()
  await expect(page.getByText('오늘 방문은 어땠나요?')).toBeVisible()
}

/** "평소와 다른 점이 있었어요" 선택 후 텍스트로 관찰내용을 입력해 제출한다. */
export async function submitChangedReport(page: Page, text: string) {
  await page.getByRole('button', { name: '평소와 다른 점이 있었어요' }).click()
  await page.getByPlaceholder(/음성 대신/).fill(text)
  await page.getByRole('button', { name: '이 내용으로 보고하기' }).click()
}

/** 데모 규칙 기반 엔진의 추가 질문(최대 3개)에 순서대로 답하고 최종 제출까지 진행한다. */
export async function answerAllFollowups(page: Page, answers: string[]) {
  for (const answer of answers) {
    const nextBtn = page.getByRole('button', { name: '다음' })
    if (!(await nextBtn.isVisible().catch(() => false))) break
    await page.getByPlaceholder('답변을 입력해 주세요.').fill(answer)
    await nextBtn.click()
    if (await page.getByText('보고 내용을 확인해 주세요').isVisible().catch(() => false)) break
  }
}
