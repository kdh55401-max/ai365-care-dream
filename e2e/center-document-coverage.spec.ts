import { expect, test } from '@playwright/test'
import { bundledDemo } from './bundledDemo'
import { resolve } from 'node:path'

test('월 작성현황은 저장본으로 갱신되고 원문 열기·미저장 입력 보호를 유지한다', async ({ page }) => {
 await bundledDemo(page); await page.goto('/center?demo=1')
 await page.evaluate(() => localStorage.setItem('gadream365:center-operations:demo:v1', JSON.stringify({ people: [
  { id: '00000000-0000-4000-8000-000000000091', kind: 'patient', name: '가상 기록 대상', status: '수급중', category: '3등급', start: '', end: '', examination: '', notes: {}, version: 1, archived: false },
  { id: '00000000-0000-4000-8000-000000000092', kind: 'patient', name: '가상 미작성 대상', status: '수급중', category: '3등급', start: '', end: '', examination: '', notes: {}, version: 1, archived: false }
 ], visits: [], requests: {} })))
 await page.reload()
 await page.getByRole('navigation', { name: '센터 업무 메뉴' }).getByRole('button', { name: '서류함', exact: true }).click()
 const coverage = page.getByRole('region', { name: '상태변화 월별 작성현황', exact: true })
 await coverage.locator('summary').click()
 await coverage.getByLabel('작성현황 조회월', { exact: true }).fill('2026-10')
 const row = coverage.getByRole('row').filter({ hasText: '가상 기록 대상' })
 await expect(row.getByText('미작성', { exact: true })).toHaveCount(5)
 await page.getByRole('button', { name: '+ 문서 작성', exact: true }).click()
 await page.getByLabel('문서 양식', { exact: true }).selectOption('state-change-record')
 await page.getByLabel('문서 수급자', { exact: true }).selectOption('00000000-0000-4000-8000-000000000091')
 await page.getByLabel('문서 제목', { exact: true }).fill('가상 현황 연결 기록')
 await page.getByLabel('문서 기준월', { exact: true }).fill('2026-10')
 await page.getByLabel('1주차 서비스 일자', { exact: true }).fill('2026-10-06')
 await page.getByLabel('1주차 특이사항 및 조치내용', { exact: true }).fill('가상 관찰: 이동 보조 후 안정적으로 휴식함.')
 await page.getByRole('button', { name: '초안 저장', exact: true }).click()
 await expect(row.getByText('초안 기록', { exact: true })).toHaveCount(1)
 await expect(row.getByText('미작성', { exact: true })).toHaveCount(4)
 await page.getByRole('button', { name: '+ 문서 작성', exact: true }).click()
 await page.getByLabel('문서 본문', { exact: true }).fill('취소 시 유지할 가상 입력')
 page.once('dialog', dialog => dialog.dismiss())
 await coverage.getByRole('button', { name: '현황에서 가상 현황 연결 기록 열기', exact: true }).click()
 await expect(page.getByLabel('문서 본문', { exact: true })).toHaveValue('취소 시 유지할 가상 입력')
 page.once('dialog', dialog => dialog.accept())
 await coverage.getByRole('button', { name: '현황에서 가상 현황 연결 기록 열기', exact: true }).click()
 await expect(page.getByRole('region', { name: '문서 상세', exact: true })).toContainText('가상 현황 연결 기록')
 await coverage.getByLabel('작성현황 조회월', { exact: true }).fill('2026-11')
 await expect(row.getByText('미작성', { exact: true })).toHaveCount(5)
 await coverage.getByLabel('작성현황 조회월', { exact: true }).fill('2026-10')
 await page.screenshot({ path: resolve('../../outputs/상태변화-월작성현황-' + test.info().project.name + '.png'), fullPage: true })
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})


test('문서 저장소를 읽지 못하면 월 현황을 미작성으로 대체하지 않는다', async ({ page }) => {
 await bundledDemo(page); await page.goto('/center?demo=1')
 await page.evaluate(() => localStorage.setItem('gadream365:center-documents:demo:v1', '{broken'))
 await page.reload()
 await page.getByRole('navigation', { name: '센터 업무 메뉴' }).getByRole('button', { name: '서류함', exact: true }).click()
 const coverage = page.getByRole('region', { name: '상태변화 월별 작성현황', exact: true })
 await coverage.locator('summary').click()
 await expect(coverage.getByRole('status')).toContainText('미작성으로 집계하지 않았습니다')
 await expect(coverage.getByRole('table')).toHaveCount(0)
 expect(await page.evaluate(() => localStorage.getItem('gadream365:center-documents:demo:v1'))).toBe('{broken')
})
