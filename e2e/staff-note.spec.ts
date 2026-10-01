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

    // 열면 자동으로 채운 사실 문장만 있고, 사유·동의 내용은 비어 있다.
    await row.getByRole('button', { name: '작성' }).click()
    const form = page.getByRole('form', { name: 'A01 직원 변경 상담일지' })
    await expect(form.getByTestId('staff-note-fact')).toContainText('A01 어르신의 담당 요양보호사가 C01에서 C08(으)로 변경되었습니다')
    await expect(form.getByTestId('staff-note-fact')).not.toContainText('동의')
    await expect(form.getByLabel('변경 사유')).toHaveValue('')

    // 빈 칸으로 확정하면 확인창 전에 막힌다.
    await form.getByRole('button', { name: '확정', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('확정하려면 변경 사유')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)

    // 초안 저장 — 일부만 적어도 저장된다.
    await form.getByLabel('변경 사유').fill('근무시간 조정')
    await form.getByRole('button', { name: '초안 저장' }).click()
    await expect(section.getByRole('status')).toContainText('초안을 저장했습니다')
    await expect(row).toContainText('작성 중')

    // 새로고침해도 남아 있고 이어서 쓸 수 있다.
    await page.reload()
    await openRecipientAdmin(page)
    const section2 = page.getByRole('region', { name: '직원 변경 상담일지' })
    const row2 = page.getByRole('list', { name: '직원 변경 상담일지 목록' }).getByRole('listitem').first()
    await expect(row2).toContainText('작성 중')
    await row2.getByRole('button', { name: '이어쓰기' }).click()
    const form2 = page.getByRole('form', { name: 'A01 직원 변경 상담일지' })
    await expect(form2.getByLabel('변경 사유')).toHaveValue('근무시간 조정')

    // 나머지를 채우고 확정 — 한 번 더 확인한다.
    await form2.getByLabel('전화', { exact: true }).check()
    await form2.getByLabel('상담 대상자(관계)').fill('보호자(자녀)')
    await form2.getByLabel(/안내한 내용과/).fill('전화로 담당 변경을 안내했고 보호자가 동의한다고 답했습니다.')
    await form2.getByRole('button', { name: '확정', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('수정할 수 없습니다')
    await page.getByRole('button', { name: '돌아가기' }).click()
    await expect(row2).toContainText('작성 중') // 돌아가기는 아무것도 확정하지 않는다
    await form2.getByRole('button', { name: '확정', exact: true }).click()
    await page.getByRole('button', { name: '확정하기' }).click()
    await expect(section2.getByRole('status')).toContainText('상담일지를 확정했습니다')
    await expect(row2).toContainText('확정')
    await expect(row2).toContainText('확정 완료')
    await expect(page.getByRole('heading', { name: /직원 변경 상담일지/ })).not.toContainText('쓸 일지')

    // 확정된 일지는 보기만 가능하다 — 입력이 잠기고 저장·확정 버튼이 없다.
    await row2.getByRole('button', { name: '보기' }).click()
    const form3 = page.getByRole('form', { name: 'A01 직원 변경 상담일지' })
    await expect(form3.getByLabel('변경 사유')).toBeDisabled()
    await expect(form3.getByLabel('변경 사유')).toHaveValue('근무시간 조정')
    await expect(form3.getByRole('button', { name: '확정', exact: true })).toHaveCount(0)
    await expect(form3.getByRole('button', { name: '초안 저장' })).toHaveCount(0)
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
