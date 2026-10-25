import { expect, test } from '@playwright/test'
import { bundledDemo } from './bundledDemo'
test('부담률 기준일 조회·미래 이력·보관·재진입', async ({ page }) => {
 await bundledDemo(page)
 await page.goto('/center?demo=1')
 await page.evaluate(() => localStorage.setItem('gadream365:center-operations:demo:v1', JSON.stringify({ people: [{ id: '00000000-0000-4000-8000-000000000091', kind: 'patient', name: '가상 수급자', status: '수급중', category: '기존 등급', start: '2026-01-02', end: '2026-12-31', examination: '', notes: {}, version: 1, archived: false }], visits: [], requests: {} })))
 await page.reload()
 async function open() { await page.getByRole('navigation', { name: '센터 업무 메뉴' }).getByRole('button', { name: '수급자관리' }).click(); await page.getByRole('button', { name: '가상 수급자', exact: true }).click(); await page.getByRole('tab', { name: '본인부담률 이력', exact: true }).click(); return page.getByRole('region', { name: '수급자 본인부담률 이력' }) }
 let section = await open()
 async function add(day: string, code: string, note: string) { await section.getByRole('button', { name: '부담률 이력 추가', exact: true }).click(); await section.getByLabel('부담률 적용일', { exact: true }).fill(day); await section.getByLabel('본인부담 구분', { exact: true }).selectOption(code); await section.getByLabel('부담률 비고', { exact: true }).fill(note); await section.getByRole('button', { name: '부담률 이력 저장', exact: true }).click(); await expect(section).toContainText('기본정보·기존 일정·청구금액은 바뀌지 않았습니다.') }
 await add('2026-10-01', '01', '현재자료'); await add('2027-01-01', '06', '향후자료')
 await section.getByLabel('부담률 조회 기준일', { exact: true }).fill('2026-12-31'); await expect(section).toContainText('기준일 이력: 일반 15% · 적용일 2026-10-01')
 await section.getByLabel('부담률 조회 기준일', { exact: true }).fill('2027-01-01'); await expect(section).toContainText('기준일 이력: 감경 40% (9%) · 적용일 2027-01-01')
 await section.getByRole('row').filter({ hasText: '향후자료' }).getByRole('button', { name: '부담률 이력 보관', exact: true }).click(); await section.getByRole('button', { name: '보관 확인', exact: true }).click(); await expect(section).toContainText('기준일 이력: 일반 15%')
 await page.reload(); section = await open(); await section.getByLabel('보관된 부담률 이력 보기', { exact: true }).check(); await expect(section.getByRole('row').filter({ hasText: '향후자료' })).toContainText('보관')
 const person = await page.evaluate(() => JSON.parse(localStorage.getItem('gadream365:center-operations:demo:v1')!).people[0]); expect(person.category).toBe('기존 등급'); expect(person.end).toBe('2026-12-31')
})
