import { expect, test } from '@playwright/test'
const patientId = '00000000-0000-4000-8000-000000000021', first = '00000000-0000-4000-8000-000000000022', second = '00000000-0000-4000-8000-000000000023'
async function openAssignments(page: import('@playwright/test').Page) {
  await page.getByRole('navigation', { name: '센터 업무 메뉴' }).getByRole('button', { name: '수급자관리' }).click()
  await page.getByRole('button', { name: '가상 수급자', exact: true }).click()
  await page.getByRole('tab', { name: '담당', exact: true }).click()
  return page.getByRole('region', { name: '수급자 담당 배정' })
}
test.beforeEach(async ({ page }) => {
  await page.goto('/center?demo=1')
  await page.evaluate(({ patientId, first, second }) => {
    const base = { status: '', category: '', start: '', end: '', examination: '', notes: {}, version: 1 }
    localStorage.setItem('gadream365:center-operations:demo:v1', JSON.stringify({ people: [{ ...base, id: patientId, kind: 'patient', name: '가상 수급자' }, { ...base, id: first, kind: 'worker', name: '가상 직원1' }, { ...base, id: second, kind: 'worker', name: '가상 직원2' }], visits: [], requests: {} }))
  }, { patientId, first, second })
  await page.reload()
})
test('체크 배정 저장·재진입 후 선택 유지·수급자와 담당자의 일정 연결', async ({ page }) => {
  let section = await openAssignments(page)
  await section.getByRole('checkbox', { name: '가상 직원1 담당 배정', exact: true }).check()
  await expect(section).toContainText('저장된 담당 1명')
  await section.getByRole('checkbox', { name: '가상 직원2 담당 배정', exact: true }).check()
  await expect(section).toContainText('저장된 담당 2명')
  await page.reload(); section = await openAssignments(page)
  await expect(section.getByRole('checkbox', { name: '가상 직원1 담당 배정', exact: true })).toBeChecked()
  await expect(section.getByRole('checkbox', { name: '가상 직원2 담당 배정', exact: true })).toBeChecked()
  await section.getByRole('button', { name: '배정 직원으로 방문일정 추가' }).click()
  const dialog = page.getByRole('dialog', { name: '방문일정 추가' })
  await expect(dialog.getByRole('combobox', { name: '수급자', exact: true })).toHaveValue(patientId)
  await expect(dialog.getByRole('combobox', { name: '직원', exact: true })).toHaveValue(first)
  await dialog.getByRole('combobox', { name: '서비스', exact: true }).selectOption('목욕')
  await dialog.getByRole('combobox', { name: '두 번째 제공자', exact: true }).selectOption(second)
  await dialog.getByRole('button', { name: '시연 세션에 반영' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.cd-visit')).toContainText('가상 직원1 · 가상 직원2')
})
test('배정 충돌은 선택을 보존하고 새로 조회하면 저장값으로 돌아간다', async ({ page }) => {
  const section = await openAssignments(page)
  await section.getByRole('checkbox', { name: '가상 직원1 담당 배정', exact: true }).check()
  await expect(section).toContainText('저장된 담당 1명')
  await page.evaluate(() => { const key = 'gadream365:center-assignments:demo:v1', value = JSON.parse(localStorage.getItem(key)!); value.assignments[0].version++; localStorage.setItem(key, JSON.stringify(value)) })
  await section.getByRole('checkbox', { name: '가상 직원2 담당 배정', exact: true }).check()
  await expect(section.getByRole('alert')).toContainText('변경')
  await expect(section.getByRole('checkbox', { name: '가상 직원2 담당 배정', exact: true })).toBeChecked()
  await expect(section.getByRole('button', { name: '배정 직원으로 방문일정 추가' })).toBeDisabled()
  await section.getByRole('button', { name: '다시 조회 · 선택 초기화' }).click()
  await expect(section.getByRole('checkbox', { name: '가상 직원2 담당 배정', exact: true })).not.toBeChecked()
  await expect(section).toContainText('v2')
})
