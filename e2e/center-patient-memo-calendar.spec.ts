import { expect, test } from '@playwright/test'
import { bundledDemo } from './bundledDemo'
test('관리기록 연도/월·검색·보관·달력 건수 및 선택 날짜 추가', async ({ page }) => {
 await bundledDemo(page); await page.goto('/center?demo=1')
 await page.evaluate(() => {
  const patientId = '00000000-0000-4000-8000-000000000091', entries = [
   { id: '00000000-0000-4000-8000-000000000001', date: '2026-10-23', text: '전화 상담', writer: '가상 담당자', archived: false },
   { id: '00000000-0000-4000-8000-000000000002', date: '2026-10-23', text: '방문 상담', writer: '다른 담당자', archived: false },
   { id: '00000000-0000-4000-8000-000000000003', date: '2027-10-23', text: '다음연도', writer: '가상 담당자', archived: false },
   { id: '00000000-0000-4000-8000-000000000004', date: '2026-10-23', text: '전화 보관', writer: '가상 담당자', archived: true },
  ]
  localStorage.setItem('gadream365:center-operations:demo:v1', JSON.stringify({ people: [{ id: patientId, kind: 'patient', name: '가상 수급자', status: '수급중', category: '기존 등급', start: '', end: '', examination: '', notes: {}, version: 1, archived: false }], visits: [], requests: {}, patientMemosState: { states: { [patientId]: { patientId, version: 4, entries } }, receipts: {} } }))
 })
 await page.reload(); await page.getByRole('navigation', { name: '센터 업무 메뉴' }).getByRole('button', { name: '수급자관리' }).click(); await page.getByRole('button', { name: '가상 수급자', exact: true }).click(); await page.getByRole('tab', { name: '관리기록', exact: true }).click()
 const section = page.getByRole('region', { name: '수급자 관리기록', exact: true })
 await expect(section).toContainText('조회 결과 3건'); await section.getByLabel('관리기록 달력 월', { exact: true }).fill('2026-10')
 await section.getByRole('button', { name: '2026-10-23 관리기록 2건', exact: true }).click(); await expect(section).toContainText('2026-10-23 · 조회 결과 2건')
 await section.getByLabel('관리기록 검색', { exact: true }).fill('전화'); await expect(section).toContainText('조회 결과 1건'); await expect(section.getByRole('button', { name: '2026-10-23 관리기록 1건', exact: true })).toBeVisible()
 await section.getByLabel('보관된 관리기록 보기', { exact: true }).check(); await expect(section).toContainText('조회 결과 2건'); await expect(section.getByRole('button', { name: '2026-10-23 관리기록 2건', exact: true })).toBeVisible()
 await section.getByRole('button', { name: '관리기록 검색 초기화', exact: true }).click(); await expect(section).toContainText('조회 결과 4건')
 await section.getByLabel('관리기록 조회 연도', { exact: true }).selectOption('2027'); await section.getByLabel('관리기록 조회 월', { exact: true }).selectOption('10'); await expect(section).toContainText('조회 결과 1건'); await expect(section.getByLabel('관리기록 달력 월', { exact: true })).toHaveValue('2027-10')
 await section.getByRole('button', { name: '2027-10-24 관리기록 0건', exact: true }).click(); await expect(section).toContainText('조회 결과 0건'); await section.getByRole('button', { name: '관리기록 추가', exact: true }).click(); await expect(section.getByLabel('관리기록 날짜', { exact: true })).toHaveValue('2027-10-24'); await section.getByRole('button', { name: '취소', exact: true }).click()
 const data = await page.evaluate(() => JSON.parse(localStorage.getItem('gadream365:center-operations:demo:v1')!)); expect(data.people[0].version).toBe(1); expect(Object.values(data.patientMemosState.states)[0]).toMatchObject({ version: 4 }); expect(data.visits).toEqual([])
})
