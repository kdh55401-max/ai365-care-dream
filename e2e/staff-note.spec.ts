import { test, expect, type Page } from '@playwright/test'
import { loginAdmin, resetDemo } from './helpers'

/** 직원(담당 요양보호사) 변경 상담일지: 수급자 관리에서 담당을 바꾸면 일지 대상이 생기고(기한 14일), 사람이 사유·안내·동의 내용을
 * 직접 적어 초안 저장 → 새로고침 후 이어쓰기 → 확정(이후 수정 불가)한다. 데모 모드(?demo=1, 브라우저 localStorage)라 운영 DB와 섞이지 않는다.
 * 실제 서버 권한·DB 저장·잠금은 api/_lib/staffChangeNoteFlow.test.ts(실제 Postgres 엔진)가 검증한다. */

async function openRecipientAdmin(page: Page) {
  await page.getByRole('button', { name: '수급자 관리' }).click()
  await expect(page.getByRole('heading', { name: /수급자 관리 · \d+명/ })).toBeVisible()
}

/** 데모 기본 수급자는 표시명이 없고 수정 저장에는 표시명이 필요하므로(기존 규칙), 비어 있으면 별칭을 채운다. */
async function openEdit(page: Page, code: string) {
  await page.locator(`[data-recipient-code="${code}"]`).getByRole('button', { name: '수정' }).click()
  const name = page.getByLabel('표시명(별칭)')
  if ((await name.inputValue()) === '') await name.fill(`${code} 어르신`)
}

async function changeCaregiver(page: Page, code: string, uncheck: string, check?: string) {
  await openEdit(page, code)
  await page.getByLabel(uncheck, { exact: true }).uncheck()
  if (check) await page.getByLabel(check, { exact: true }).check()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('status').first()).toContainText(`수급자 ${code} 정보를 저장했습니다`)
}

test.describe('staff-note: 담당 변경 → 직원 변경 상담일지', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('담당 교체 → 일지 대상 생성 → 빈 칸 확정 거부 → 초안 저장·이어쓰기 → 확정 후 수정 불가', async ({ page }) => {
    test.setTimeout(90_000)
    await loginAdmin(page)
    await openRecipientAdmin(page)

    // 담당이 바뀐 적이 없으면 일지도 없다.
    await expect(page.getByText('아직 담당이 바뀐 수급자가 없습니다')).toBeVisible()

    // 담당을 추가만 하면(해제 없음) 일지 대상이 아니다.
    await openEdit(page, 'A03')
    await page.getByLabel('C08', { exact: true }).check()
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('status').first()).toContainText('수급자 A03 정보를 저장했습니다')
    await expect(page.getByText('아직 담당이 바뀐 수급자가 없습니다')).toBeVisible()

    // A01의 담당을 C01 → C08로 교체하면 일지 1건이 생긴다(미작성, 기한 14일).
    await changeCaregiver(page, 'A01', 'C01', 'C08')
    const section = page.getByRole('region', { name: '직원 변경 상담일지' })
    const list = page.getByRole('list', { name: '직원 변경 상담일지 목록' })
    const row = list.getByRole('listitem').first()
    await expect(row).toContainText('A01')
    await expect(row).toContainText('미작성')
    await expect(row).toContainText('담당 C01 → C08')
    await expect(row).toContainText('14일 남음')
    await expect(page.getByRole('heading', { name: /직원 변경 상담일지/ })).toContainText('쓸 일지 1건')

    // 열면 자동으로 채운 사실 문장만 있고, 사유·동의 문장은 비어 있다.
    await row.getByRole('button', { name: '작성' }).click()
    const form = page.getByRole('form', { name: 'A01 직원 변경 상담일지' })
    await expect(form.getByTestId('staff-note-fact')).toContainText('A01 어르신의 담당 요양보호사가 C01에서 C08(으)로 변경되었습니다')
    await expect(form.getByTestId('staff-note-fact')).not.toContainText('동의')
    await expect(form.getByLabel(/변경 사유 문장/)).toHaveValue('')
    await expect(form.getByLabel(/안내한 내용과 의견·동의 문장/)).toHaveValue('')

    // 빈 칸으로 확정하면 확인창 전에 막힌다.
    await form.getByRole('button', { name: '확정', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('확정하려면 변경 사유')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)

    // 선택 없이 초안 만들기 → 무엇을 골라야 하는지 알려 준다.
    await form.getByRole('button', { name: '초안 만들기' }).click()
    await expect(form.getByRole('alert')).toContainText('선택')

    // 버튼만 눌러 고른다 → 초안 만들기 (타이핑 없음)
    await form.getByLabel('근무시간 조정', { exact: true }).check()
    await form.getByLabel('전화', { exact: true }).check()
    await form.getByLabel('보호자(자녀)', { exact: true }).check()
    await form.getByLabel('동의함', { exact: true }).check()
    await form.getByRole('button', { name: '초안 만들기' }).click()
    await expect(form.getByTestId('staff-note-source')).toContainText('기본 문장 초안')
    await expect(form.getByTestId('staff-note-source')).toContainText('데모에서는 AI를 호출하지 않습니다')
    await expect(form.getByLabel(/변경 사유 문장/)).toHaveValue('근무시간 조정에 따른 담당 요양보호사 변경')
    await expect(form.getByLabel(/안내한 내용과 의견·동의 문장/)).toHaveValue(/\[안내\] 전화로 보호자\(자녀\)에게 .*\n\[의견·동의\] 변경에 동의함\./)

    // 초안 저장 → 새로고침 후에도 문장과 선택값이 남는다.
    await form.getByRole('button', { name: '초안 저장' }).click()
    await expect(section.getByRole('status')).toContainText('초안을 저장했습니다')
    await expect(row).toContainText('작성 중')
    await page.reload()
    await openRecipientAdmin(page)
    const section2 = page.getByRole('region', { name: '직원 변경 상담일지' })
    const row2 = page.getByRole('list', { name: '직원 변경 상담일지 목록' }).getByRole('listitem').first()
    await expect(row2).toContainText('작성 중')
    await row2.getByRole('button', { name: '이어쓰기' }).click()
    const form2 = page.getByRole('form', { name: 'A01 직원 변경 상담일지' })
    await expect(form2.getByLabel(/변경 사유 문장/)).toHaveValue('근무시간 조정에 따른 담당 요양보호사 변경')
    await expect(form2.getByLabel('동의함', { exact: true })).toBeChecked()
    await expect(form2.getByLabel('전화', { exact: true })).toBeChecked()
    await expect(form2.getByLabel('보호자(자녀)', { exact: true })).toBeChecked()

    // 문장을 직접 고친 뒤 초안을 다시 만들려 하면 덮어쓰기 전에 묻는다.
    await form2.getByLabel(/변경 사유 문장/).fill('직접 고친 사유')
    await form2.getByLabel('근무시간 조정', { exact: true }).check()
    await form2.getByRole('button', { name: /초안/ }).filter({ hasText: /만들기/ }).click()
    await expect(page.getByRole('alertdialog', { name: '초안 덮어쓰기 확인' })).toBeVisible()
    await page.getByRole('button', { name: '그대로 두기' }).click()
    await expect(form2.getByLabel(/변경 사유 문장/)).toHaveValue('직접 고친 사유')

    // 확정 — 한 번 더 확인한다.
    await form2.getByRole('button', { name: '확정', exact: true }).click()
    await expect(page.getByRole('alertdialog', { name: '상담일지 확정 확인' })).toContainText('수정할 수 없습니다')
    await page.getByRole('button', { name: '돌아가기' }).click()
    await expect(row2).toContainText('작성 중') // 돌아가기는 아무것도 확정하지 않는다
    await form2.getByRole('button', { name: '확정', exact: true }).click()
    await page.getByRole('button', { name: '확정하기' }).click()
    await expect(section2.getByRole('status')).toContainText('상담일지를 확정했습니다')
    await expect(row2).toContainText('확정 완료')
    await expect(page.getByRole('heading', { name: /직원 변경 상담일지/ })).not.toContainText('쓸 일지')

    // 확정된 일지는 보기만 가능하다 — 입력·선택이 잠기고 저장·확정·초안 버튼이 없으며 고른 동의 여부가 보인다.
    await row2.getByRole('button', { name: '보기' }).click()
    const form3 = page.getByRole('form', { name: 'A01 직원 변경 상담일지' })
    await expect(form3.getByLabel(/변경 사유 문장/)).toBeDisabled()
    await expect(form3.getByLabel(/변경 사유 문장/)).toHaveValue('직접 고친 사유')
    await expect(form3).toContainText('의견·동의 여부: 동의함')
    await expect(form3.getByRole('button', { name: '확정', exact: true })).toHaveCount(0)
    await expect(form3.getByRole('button', { name: '초안 저장' })).toHaveCount(0)
    await expect(form3.getByRole('button', { name: /초안.*만들기/ })).toHaveCount(0)
  })

  test('동의 여부에 따라 문장이 달라지고, 동의하지 않았거나 못 알렸다면 동의한 것처럼 쓰지 않는다', async ({ page }) => {
    test.setTimeout(90_000)
    await loginAdmin(page)
    await openRecipientAdmin(page)
    await changeCaregiver(page, 'A01', 'C01', 'C08')
    await page.getByRole('region', { name: '직원 변경 상담일지' }).getByRole('button', { name: '작성' }).click()
    const form = page.getByRole('form', { name: 'A01 직원 변경 상담일지' })
    const content = form.getByLabel(/안내한 내용과 의견·동의 문장/)

    await form.getByLabel('수급자(보호자) 요청', { exact: true }).check()
    await form.getByLabel('방문', { exact: true }).check()
    await form.getByLabel('본인', { exact: true }).check()

    // 동의함(의견 있음) — 의견 내용이 필수다.
    await form.getByLabel('동의함(의견 있음)', { exact: true }).check()
    await form.getByRole('button', { name: '초안 만들기' }).click()
    await expect(form.getByRole('alert')).toContainText('어떤 의견')
    await form.getByLabel('의견 내용').fill('오전 시간대를 희망함')
    await form.getByRole('button', { name: '초안 만들기' }).click()
    await expect(content).toHaveValue(/변경에 동의함\. 의견: 오전 시간대를 희망함/)

    // 동의하지 않음 — 동의했다는 표현이 없다.
    await form.getByLabel('동의하지 않음', { exact: true }).check()
    await form.getByRole('button', { name: '초안 다시 만들기' }).click()
    await expect(content).toHaveValue(/변경에 동의하지 않음\./)
    expect(await content.inputValue()).not.toMatch(/동의함/)

    // 아직 안내하지 못함 — 동의 여부는 재확인 필요.
    await form.getByLabel('아직 안내하지 못함', { exact: true }).check()
    await form.getByRole('button', { name: '초안 다시 만들기' }).click()
    await expect(content).toHaveValue(/방문했으나 만나지 못해 본인에게 .* 아직 안내하지 못함/)
    await expect(content).toHaveValue(/다시 확인 필요/)
    expect(await content.inputValue()).not.toMatch(/동의함|동의하였/)

    // 기타 사유는 직접 적어야 한다.
    await form.getByLabel('기타(직접 입력)', { exact: true }).check()
    await form.getByRole('button', { name: '초안 다시 만들기' }).click()
    await expect(form.getByRole('alert')).toContainText('직접 적어')
  })

  test('후임 없이 담당만 해제해도 일지 대상이 되고, 문구가 해제로 표현된다', async ({ page }) => {
    await loginAdmin(page)
    await openRecipientAdmin(page)
    await changeCaregiver(page, 'A03', 'C02')
    const row = page.getByRole('list', { name: '직원 변경 상담일지 목록' }).getByRole('listitem').first()
    await expect(row).toContainText('담당 C02 → 미배정')
    await row.getByRole('button', { name: '작성' }).click()
    await expect(page.getByTestId('staff-note-fact')).toContainText('C02에서 해제되었습니다')
  })
})
