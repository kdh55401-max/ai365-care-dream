import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { loginAdmin, resetDemo } from './helpers'

/** ERP 3단계: 서류(가상 시험용 이미지)를 올리면 AI가 읽어 인적사항을 채우고, 관리자가 확인해 저장하며, 원본이 보관된다.
 * 데모 모드의 읽기는 파일 이름의 종류 단어로 가상 결과를 돌려준다(실제 AI 미호출) — 실제 AI 읽기 정확도는 여기서 확인되지 않는다. */

/** 한글 파일 이름이 서류 종류를 가리키므로(데모 읽기) 파일 내용을 읽어 이름 그대로 올린다. */
const fixture = (name: string) => ({ name, mimeType: 'image/png', buffer: readFileSync(`e2e/fixtures/${name}`) })
const CERT = fixture('가상_장기요양인정서.png')
const PLAN = fixture('가상_개인별장기요양이용계획서.png')
const GUIDE = fixture('가상_안내문.png')
const CONFLICT_PLAN = fixture('가상_충돌_이용계획서.png')

async function openAdd(page: Page) {
  await loginAdmin(page)
  await page.getByRole('button', { name: '수급자', exact: true }).click()
  await page.getByRole('button', { name: '수급자 추가' }).click()
}

test.describe('profile-from-documents: 서류로 채우기', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('서류 3장을 올리면 칸이 채워지고, 확인 후 저장하면 수급자와 서류 원본이 남는다', async ({ page }) => {
    test.setTimeout(90_000)
    await openAdd(page)
    await page.getByLabel('서류 파일 선택').setInputFiles([CERT, PLAN, GUIDE])
    await expect(page.getByRole('list', { name: '올린 서류' }).getByRole('listitem')).toHaveCount(3)
    await page.getByRole('button', { name: /AI로 읽어서 채우기 \(3장\)/ }).click()

    const report = page.getByRole('status', { name: 'AI가 읽은 결과' })
    await expect(report).toContainText('서류 3장을 읽어 7칸을 채웠습니다')
    await expect(report).toContainText('데모: 실제 AI를 호출하지 않은 가상 결과')
    await expect(page.getByLabel('이름', { exact: true })).toHaveValue('김가상')
    await expect(page.getByLabel('장기요양인정번호')).toHaveValue('L0000000099-001')
    await expect(page.getByLabel('장기요양등급')).toHaveValue('4등급')
    await expect(page.getByLabel('인정 유효기간 종료')).toHaveValue('2029-02-24')
    await expect(page.getByLabel('주소')).toHaveValue('가상시 가상구 가상로 1')
    // 채운 칸에는 확인 필요 표시가 붙고, 직접 고치면 사라진다.
    await expect(page.getByText('AI가 채움 · 확인 필요')).toHaveCount(7)
    await page.getByLabel('주소').fill('가상시 가상구 가상로 2')
    await expect(page.getByText('AI가 채움 · 확인 필요')).toHaveCount(6)

    // 자동 저장은 없다 — 아직 목록에 없다.
    await expect(page.locator('[data-recipient-code="A10"]')).toHaveCount(0)
    await page.getByLabel('C08').check()
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('status').first()).toContainText('수급자 A10을(를) 등록했습니다')
    await expect(page.getByRole('status').first()).toContainText('서류 원본 3건을 비공개로 보관했습니다')
    const row = page.locator('[data-recipient-code="A10"]')
    await expect(row).toContainText('김가상')
    await expect(row).toContainText('L0000000099-001')
    await expect(row).toContainText('4등급')

    // 보관된 원본이 그 수급자의 기준문서로 보인다.
    await row.getByRole('button', { name: '기록 보기' }).click()
    await expect(page.getByText('가상_장기요양인정서.png').first()).toBeVisible()
  })

  test('서류마다 값이 다르면 그 칸은 채우지 않고 충돌로 보여 준다', async ({ page }) => {
    await openAdd(page)
    await page.getByLabel('서류 파일 선택').setInputFiles([CERT, CONFLICT_PLAN])
    await page.getByRole('button', { name: /AI로 읽어서 채우기/ }).click()
    const report = page.getByRole('status', { name: 'AI가 읽은 결과' })
    await expect(report).toContainText('서류마다 값이 다릅니다 — 장기요양등급')
    await expect(report).toContainText('4등급')
    await expect(report).toContainText('3등급')
    await expect(page.getByLabel('장기요양등급')).toHaveValue('')
    await expect(page.getByLabel('이름', { exact: true })).toHaveValue('김가상') // 일치하는 칸은 채운다
  })

  test('이미 입력한 칸은 덮어쓰지 않고 다르다고만 알린다', async ({ page }) => {
    await openAdd(page)
    await page.getByLabel('이름', { exact: true }).fill('직접 입력한 이름')
    await page.getByLabel('서류 파일 선택').setInputFiles([CERT])
    await page.getByRole('button', { name: /AI로 읽어서 채우기/ }).click()
    const report = page.getByRole('status', { name: 'AI가 읽은 결과' })
    await expect(report).toContainText('입력하신 값(직접 입력한 이름)과 서류에서 읽은 값(김가상)이 다릅니다')
    await expect(page.getByLabel('이름', { exact: true })).toHaveValue('직접 입력한 이름')
  })

  test('PDF·JPG·PNG가 아닌 파일은 올리기 전에 이유를 알려 준다', async ({ page }) => {
    await openAdd(page)
    await page.getByLabel('서류 파일 선택').setInputFiles({ name: '메모.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(page.getByRole('alert').filter({ hasText: '메모.txt' })).toContainText('PDF·JPG·PNG 파일만')
    await expect(page.getByRole('list', { name: '올린 서류' })).toHaveCount(0)
  })

  test('서류를 빼고 취소하면 아무것도 저장되지 않는다', async ({ page }) => {
    await openAdd(page)
    await page.getByLabel('서류 파일 선택').setInputFiles([CERT])
    await page.getByRole('button', { name: '가상_장기요양인정서.png 빼기' }).click()
    await expect(page.getByRole('list', { name: '올린 서류' })).toHaveCount(0)
    await page.getByRole('button', { name: '취소' }).click()
    await expect(page.locator('[data-recipient-code="A10"]')).toHaveCount(0)
  })
})
