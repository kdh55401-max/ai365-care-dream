import { expect, test } from '@playwright/test'

test('목욕 두 제공자를 선택하고 저장 후 다시 조회한다', async ({ page }) => {
  await page.goto('/center?demo=1')
  const workerId = '00000000-0000-4000-8000-000000000011', secondary = '00000000-0000-4000-8000-000000000012', patientId = '00000000-0000-4000-8000-000000000013'
  await page.evaluate(({ workerId, secondary, patientId }) => {
    const base = { status: '', category: '', start: '', end: '', examination: '', notes: {}, version: 1 }
    localStorage.setItem('gadream365:center-operations:demo:v1', JSON.stringify({ people: [{ ...base, id: workerId, kind: 'worker', name: '가상 첫 직원' }, { ...base, id: secondary, kind: 'worker', name: '가상 둘째 직원' }, { ...base, id: patientId, kind: 'patient', name: '가상 수급자' }], visits: [], requests: {} }))
  }, { workerId, secondary, patientId })
  await page.reload()
  await page.getByRole('navigation', { name: '센터 업무 메뉴' }).getByRole('button', { name: '방문일정' }).click()
  await page.getByRole('button', { name: '+ 방문일정 추가', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '방문일정 추가' })
  await dialog.getByLabel('날짜', { exact: true }).fill('2026-10-22')
  await dialog.getByRole('combobox', { name: '직원', exact: true }).selectOption(workerId)
  await dialog.getByRole('combobox', { name: '수급자', exact: true }).selectOption(patientId)
  await dialog.getByRole('combobox', { name: '서비스', exact: true }).selectOption('목욕')
  await dialog.getByRole('combobox', { name: '두 번째 제공자', exact: true }).selectOption(workerId)
  await dialog.getByRole('button', { name: '시연 세션에 반영' }).click()
  await expect(dialog.getByRole('alert')).toContainText('입력')
  await expect(dialog.getByLabel('날짜', { exact: true })).toHaveValue('2026-10-22')
  await dialog.getByRole('combobox', { name: '두 번째 제공자', exact: true }).selectOption(secondary)
  await dialog.getByRole('button', { name: '시연 세션에 반영' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.cd-visit')).toContainText('가상 첫 직원 · 가상 둘째 직원')
  await page.locator('.cd-visit').click()
  await expect(page.getByRole('dialog').getByRole('combobox', { name: '두 번째 제공자', exact: true })).toHaveValue(secondary)
})

test('방문일정 수정·경합·보관은 별도 확인을 거친다', async ({ page }) => {
  const key = 'gadream365:center-operations:demo:v1'
  const workerId = '00000000-0000-4000-8000-000000000001'
  const patientId = '00000000-0000-4000-8000-000000000002'
  const visitId = '00000000-0000-4000-8000-000000000003'
  await page.goto('/center?demo=1')
  await page.evaluate(({ key, workerId, patientId, visitId }) => {
    const base = { status: '', category: '', start: '', end: '', examination: '', notes: {}, version: 1 }
    localStorage.setItem(key, JSON.stringify({ people: [{ ...base, id: workerId, kind: 'worker', name: '가상 직원' }, { ...base, id: patientId, kind: 'patient', name: '가상 수급자' }], visits: [{ id: visitId, date: '2026-10-22', time: '09:00', minutes: 60, service: '요양', workerId, patientId, version: 1 }], requests: {} }))
  }, { key, workerId, patientId, visitId })
  await page.reload()
  const navigation = page.getByRole('navigation', { name: '센터 업무 메뉴' })
  await navigation.getByRole('button', { name: '방문일정' }).click()
  await page.getByLabel('일정 년월').fill('2026-10')
  await page.getByRole('button', { name: /2026-10-22 09:00.*방문일정 수정/ }).click()
  let dialog = page.getByRole('dialog', { name: '방문일정 수정' })
  await expect(dialog.getByLabel('방문시간')).toHaveValue('09:00')
  await dialog.getByLabel('방문시간').fill('10:30')
  await dialog.getByRole('button', { name: '시연 세션에 반영' }).click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await navigation.getByRole('button', { name: '방문일정' }).click()
  await page.getByLabel('일정 년월').fill('2026-10')
  await page.getByRole('button', { name: /2026-10-22 10:30.*방문일정 수정/ }).click()
  dialog = page.getByRole('dialog', { name: '방문일정 수정' })
  await dialog.getByLabel('제공시간(분)').fill('90')
  // Another editor changed the persisted version after this form was opened.
  await page.evaluate(key => { const data = JSON.parse(localStorage.getItem(key)!); data.visits[0].version++; data.visits[0].time = '11:00'; localStorage.setItem(key, JSON.stringify(data)) }, key)
  await dialog.getByRole('button', { name: '시연 세션에 반영' }).click()
  await expect(dialog.getByRole('alert')).toContainText('변경')
  await expect(dialog.getByLabel('제공시간(분)')).toHaveValue('90')
  await dialog.getByRole('button', { name: '일정 보관', exact: true }).click()
  await dialog.getByRole('button', { name: '보관 확인', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('변경')
  await dialog.getByRole('button', { name: '편집으로 돌아가기' }).click()
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await page.reload()
  await navigation.getByRole('button', { name: '방문일정' }).click()
  await page.getByLabel('일정 년월').fill('2026-10')
  await page.getByRole('button', { name: /2026-10-22 11:00.*방문일정 수정/ }).click()
  await dialog.getByRole('button', { name: '일정 보관', exact: true }).click()
  await dialog.getByRole('button', { name: '편집으로 돌아가기' }).click()
  await expect(dialog.getByLabel('방문시간')).toHaveValue('11:00')
  await dialog.getByRole('button', { name: '일정 보관', exact: true }).click()
  await dialog.getByRole('button', { name: '보관 확인', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.cd-visit')).toHaveCount(0)
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
  expect(stored.visits[0]).toMatchObject({ archived: true, time: '11:00', minutes: 60, version: 4 })
})
