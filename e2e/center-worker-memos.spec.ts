import { expect, test } from '@playwright/test'
import { bundledDemo } from './bundledDemo'
test('관리기록 동일일 복수·수정·취소/보관·재진입·기존메모 보존', async ({ page }) => {
 await bundledDemo(page); await page.goto('/center?demo=1')
 await page.evaluate(() => localStorage.setItem('gadream365:center-operations:demo:v1', JSON.stringify({ people: [{ id: '00000000-0000-4000-8000-000000000091', kind: 'worker', name: '가상 직원', status: '활동', category: '기존 등급', start: '2026-01-02', end: '2026-12-31', examination: '', notes: { 관리기록: '기존 단일메모' }, version: 1, archived: false }], visits: [], requests: {} })))
 await page.reload()
 async function open() { await page.getByRole('navigation', { name: '센터 업무 메뉴' }).getByRole('button', { name: '직원관리' }).click(); await page.getByRole('button', { name: '가상 직원', exact: true }).click(); await page.getByRole('tab', { name: '관리기록', exact: true }).click(); return page.getByRole('region', { name: '직원 관리기록', exact: true }) }
 let section = await open()
 async function add(text: string) { await section.getByRole('button', { name: '관리기록 추가', exact: true }).click(); await section.getByLabel('관리기록 날짜', { exact: true }).fill('2026-10-23'); await section.getByLabel('관리기록 내용', { exact: true }).fill(text); await section.getByRole('button', { name: '관리기록 저장', exact: true }).click(); await expect(section.getByLabel('관리기록 내용', { exact: true })).toHaveCount(0) }
 await add('첫 번째 가상 기록'); await add('<script>가상 두 번째</script>')
 await expect(section.getByRole('row').filter({ hasText: '2026-10-23' })).toHaveCount(2); await expect(section).toContainText('시연 관리자'); await expect(section.locator('script')).toHaveCount(0)
 let row = section.getByRole('row').filter({ hasText: '첫 번째 가상 기록' }); await row.getByRole('button', { name: '관리기록 수정', exact: true }).click(); await section.getByLabel('관리기록 내용', { exact: true }).fill('수정된 기록'); await section.getByRole('button', { name: '관리기록 저장', exact: true }).click()
 row = section.getByRole('row').filter({ hasText: '수정된 기록' }); await row.getByRole('button', { name: '관리기록 보관', exact: true }).click(); await section.getByRole('group', { name: '관리기록 보관 확인' }).getByRole('button', { name: '취소', exact: true }).click(); await expect(row).toBeVisible()
 await row.getByRole('button', { name: '관리기록 보관', exact: true }).click(); await section.getByRole('button', { name: '보관 확인', exact: true }).click(); await expect(row).toHaveCount(0)
 await page.reload(); section = await open(); await section.getByLabel('보관된 관리기록 보기', { exact: true }).check(); await expect(section.getByRole('row').filter({ hasText: '수정된 기록' })).toContainText('보관')
 await section.getByText('기존 단일 업무 메모', { exact: true }).click(); await expect(section).toContainText('기존 단일메모')
 const person = await page.evaluate(() => JSON.parse(localStorage.getItem('gadream365:center-operations:demo:v1')!).people[0]); expect(person.version).toBe(1); expect(person.notes.관리기록).toBe('기존 단일메모')
})
