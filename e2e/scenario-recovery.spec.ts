import { test, expect } from '@playwright/test'
import { loginCare, resetDemo, answerFollowupsWithOptions, DEMO_SUBMITTED_TEXT } from './helpers'

test.beforeEach(async ({page}) => { await resetDemo(page) })
test('scenario draft cannot leak into live screen and survives reload', async ({page}) => {
  const apiRequests: string[]=[]
  page.on('request', r => { if(r.url().includes('/api/')) apiRequests.push(r.url()) })
  await loginCare(page,'c1')
  await page.getByRole('button',{name:'글로 입력하기',exact:true}).click()
  await page.getByRole('textbox',{name:'오늘의 돌봄 이야기'}).fill('실제 화면 초안 보존')
  await page.goto('/care/scenario?demo=1')
  await expect(page.getByRole('heading',{name:'표준상황 연습',exact:true})).toBeVisible()
  await page.getByText('상황 1 · 식사량 감소와 휘청거림').click()
  await page.getByRole('textbox',{name:'오늘의 돌봄 이야기'}).fill('연습 초안 보존')
  await page.reload()
  await expect(page.getByRole('textbox',{name:'오늘의 돌봄 이야기'})).toHaveValue('연습 초안 보존')
  await expect(page.getByRole('complementary',{name:'시뮬레이션 안내'})).toBeVisible()
  await page.getByRole('link',{name:'실제 돌봄 화면으로 돌아가기',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'오늘의 돌봄 이야기'})).toHaveValue('실제 화면 초안 보존')
  await expect(page.getByRole('complementary',{name:'시뮬레이션 안내'})).toHaveCount(0)
  expect(apiRequests).toEqual([])
})

test('AI failure retains input; rapid retry runs once; lost submit acknowledgement is recoverable', async ({page}) => {
  await loginCare(page,'c1')
  await page.getByRole('button',{name:'글로 입력하기',exact:true}).click()
  await page.getByRole('textbox',{name:'오늘의 돌봄 이야기'}).fill('식사를 적게 드셨어요')
  await page.evaluate(async()=> {
    const {demoCareRepo:repo}=await import('/src/pilot/demo/demoCareRepo.ts' /* @vite-ignore */)
    const {ApiClientError}=await import('/src/pilot/shared/api.ts' /* @vite-ignore */)
    const original=repo.aiTurn; let first=true; (window as any).aiCalls=0
    repo.aiTurn=async (...args:any[])=> { (window as any).aiCalls++; await new Promise(r=>setTimeout(r,200)); if(first){first=false;throw new ApiClientError(502,'fixture upstream failure')} repo.aiTurn=original; return original(...args) }
  })
  await page.getByRole('button',{name:'이야기 전달하기',exact:true}).click()
  await expect(page.getByText(/AI 응답 결과를 확인하지 못했어요 \(HTTP 502\)/)).toBeVisible()
  await expect(page.getByRole('textbox',{name:'오늘의 돌봄 이야기'})).toHaveValue('식사를 적게 드셨어요')
  await page.getByRole('button',{name:'다시 시도',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click()})
  await expect(page.getByTestId('current-question')).toBeVisible()
  expect(await page.evaluate(()=>(window as any).aiCalls)).toBe(2)
  await answerFollowupsWithOptions(page)
  await expect(page.getByRole('heading',{name:'말씀해주신 내용을 정리했어요.'})).toBeVisible()
  await page.evaluate(async()=> {
    const {demoCareRepo:repo}=await import('/src/pilot/demo/demoCareRepo.ts' /* @vite-ignore */)
    const original=repo.patchReport;let lost=false
    repo.patchReport=async(input:any)=>{const result=await original(input); if(input.submit&&!lost){lost=true;throw Error('lost response after commit')} return result}
  })
  await page.getByRole('button',{name:'센터에 보고하기',exact:true}).click()
  await expect(page.getByText(/최종 제출 결과를 확인하지 못했어요/)).toBeVisible()
  await page.getByRole('button',{name:'다시 시도',exact:true}).click()
  await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
  expect(await page.evaluate(async()=>{const {demoCareRepo:repo}=await import('/src/pilot/demo/demoCareRepo.ts' /* @vite-ignore */);return (await repo.listReports()).filter((r:any)=>r.status==='submitted').length})).toBe(1)
})

test('small mobile keeps entry actions reachable and typing cancels guidance',async({page},info)=>{
 await page.setViewportSize({width:360,height:740});await loginCare(page,'c1')
 const start=await page.getByRole('button',{name:'이야기 시작',exact:true}).boundingBox()
 const text=await page.getByRole('button',{name:'글로 입력하기',exact:true}).boundingBox()
 expect(start!.y+start!.height).toBeLessThan(740);expect(text!.y+text!.height).toBeLessThan(740)
 await page.screenshot({path:info.outputPath('mobile-home.png'),fullPage:true})
 await page.getByRole('button',{name:'글로 입력하기',exact:true}).click()
 await page.evaluate(()=>{(window as any).cancelled=0;speechSynthesis.cancel=()=>{(window as any).cancelled++}})
 await page.getByRole('textbox',{name:'오늘의 돌봄 이야기'}).focus()
 expect(await page.evaluate(()=>(window as any).cancelled)).toBeGreaterThan(0)
})

