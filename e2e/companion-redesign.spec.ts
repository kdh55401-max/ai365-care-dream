import { test, expect, type Page } from '@playwright/test'
import { loginCare, resetDemo, loginAdmin, answerFollowupsWithOptions, DEMO_SUBMITTED_TEXT } from './helpers'

async function settled(page: Page) {
  await page.getByTestId('companion-avatar').locator('img').evaluate(async (img: HTMLImageElement) => { await img.decode() })
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined)))
  })
}
test.beforeEach(async ({ page }) => { await resetDemo(page) })

test('provided avatar persists and moves from home into conversation; reduced viewport stays usable', async ({ page }, info) => {
  await loginCare(page, 'c1')
  await settled(page)
  await expect(page.getByRole('heading', { name: '오늘 A01 어르신은 어떠셨어요?' })).toBeVisible()
  const image = page.getByTestId('companion-avatar')
  const before = (await image.boundingBox())!
  expect(before.width).toBeGreaterThan(200)
  await image.evaluate((node) => { (window as any).initialAvatar = node })
  await page.screenshot({ path: info.outputPath('home.png'), fullPage: true })
  await page.getByRole('button', { name: '글로 입력하기', exact: true }).click()
  await expect(page.getByTestId('companion-avatar')).toHaveClass(/--sm/)
  expect(await image.evaluate((node) => node === (window as any).initialAvatar)).toBe(true)
  await settled(page)
  const after = (await image.boundingBox())!
  expect(after.width).toBeLessThan(100); expect(after.y).toBeLessThan(before.y)
  const input = page.getByRole('textbox', { name: '오늘의 돌봄 이야기' })
  await input.fill('물을 적게 드셨어요')
  await page.setViewportSize({ width: info.project.name === 'mobile-360' ? 360 : 390, height: 450 })
  await input.focus(); await input.scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: '이야기 전달하기' }).click()
  await expect(page.getByTestId('current-question')).toBeVisible()
  await expect(page.getByRole('log')).toContainText('물을 적게 드셨어요')
  await page.setViewportSize({ width: 390, height: 844 }); await settled(page)
  await page.screenshot({ path: info.outputPath('conversation.png'), fullPage: true })
  await answerFollowupsWithOptions(page)
  await expect(page.getByRole('heading', { name: '말씀해주신 내용을 정리했어요.' })).toBeVisible()
  await settled(page); await page.screenshot({ path: info.outputPath('review.png'), fullPage: true })
  await page.getByRole('textbox', { name: '현재 상태', exact: true }).fill('직접 확인한 상태로 수정')
  await page.getByRole('button', { name: '센터에 보고하기', exact: true }).click()
  await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
  const admin = await page.context().newPage(); await loginAdmin(admin)
  await admin.getByRole('button', { name: '보고 목록', exact: true }).click()
  await admin.getByRole('button', { name: /C01 → A01/ }).click()
  await expect(admin.getByRole('heading', { name: /C01 · A01 · 기본/ })).toBeVisible()
  await expect(admin.locator('div.whitespace-pre-wrap').filter({ hasText: /^물을 적게 드셨어요$/ })).toBeVisible()
  const saved = await page.evaluate(async () => {
    const { demoCareRepo } = await import('/src/pilot/demo/demoCareRepo.ts' /* @vite-ignore */)
    const reports = await demoCareRepo.listReports()
    return demoCareRepo.getReport(reports.find((r: any) => r.status === 'submitted').id)
  })
  expect(saved.participant_code).toBe('C01'); expect(saved.recipient_code).toBe('A01')
  expect(saved.raw_input).toBe('물을 적게 드셨어요')
  expect(saved.caregiver_final_report.result).toBe('직접 확인한 상태로 수정')
})

test('failed followup retains the actual answer and presents a working retry', async ({ page }) => {
  await loginCare(page, 'c1')
  await page.getByRole('button', { name: '글로 입력하기', exact: true }).click()
  await page.getByPlaceholder(/음성 대신/).fill('식사를 적게 드셨어요')
  await page.getByRole('button', { name: '이야기 전달하기' }).click()
  await expect(page.getByTestId('current-question')).toBeVisible()
  await page.evaluate(async () => {
    const { demoCareRepo } = await import('/src/pilot/demo/demoCareRepo.ts' /* @vite-ignore */)
    const original = demoCareRepo.aiTurn
    demoCareRepo.aiTurn = async () => {
      demoCareRepo.aiTurn = original
      throw Error('test offline')
    }
  })
  await page.getByRole('button', { name: '잘 모르겠어요', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('말씀하신 내용은 그대로 남아 있어요.')
  await expect(page.getByRole('log')).toContainText('잘 모르겠어요')
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('말씀하신 내용은 그대로 남아 있어요.')
  await expect(page.getByRole('log')).toContainText('잘 모르겠어요')
  await page.getByRole('button', { name: '다시 시도', exact: true }).click()
  await expect(page.getByText('추가 확인 2/3', { exact: false })).toBeVisible()
})

test('actual TTS lifecycle and microphone start cannot overlap', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any
    w.said = []; w.micActive = false; w.overlap = false
    speechSynthesis.speak = (utterance) => { w.said.push(utterance); if (w.micActive) w.overlap = true }
    speechSynthesis.cancel = () => { w.cancelled = true }
    class Recognition {
      onend?: () => void
      onstart?: () => void
      start() { w.micActive = true; w.currentMic = this }
      stop() { w.micActive = false; this.onend?.() }
      abort() { w.micActive = false }
    }
    w.SpeechRecognition = Recognition
  })
  await loginCare(page, 'c1')
  await page.getByRole('button', { name: '글로 입력하기', exact: true }).click()
  await expect(page.getByTestId('companion-state')).not.toContainText('말씀드리고 있어요')
  await page.evaluate(() => (window as any).said.at(-1).onstart())
  await expect(page.getByTestId('companion-state')).toContainText('말씀드리고 있어요')
  await page.getByRole('button', { name: '눌러서 말하기', exact: true }).click()
  await expect(page.getByTestId('companion-state')).toContainText('마이크를 연결하고 있어요')
  await page.evaluate(() => (window as any).currentMic.onstart())
  await expect(page.getByTestId('companion-state')).toContainText('듣고 있어요')
  expect(await page.evaluate(() => (window as any).overlap)).toBe(false)
  await page.evaluate(() => (window as any).said.at(-1).onstart())
  await expect(page.getByTestId('companion-state')).toContainText('듣고 있어요')
})

test('denied microphone permits text input; reduced motion suppresses avatar animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    class Recognition {
      onerror?: (e: {error: string}) => void
      start() { setTimeout(() => this.onerror?.({ error: 'not-allowed' }), 0) }
      abort() {}
    }
    ;(window as any).SpeechRecognition = Recognition
  })
  await loginCare(page, 'c1')
  await page.getByRole('button', { name: '이야기 시작', exact: true }).click()
  await expect(page.getByPlaceholder(/음성 대신/)).toBeEditable()
  expect(await page.getByTestId('companion-avatar').evaluate((node) => node.getAnimations().length)).toBe(0)
  await page.getByPlaceholder(/음성 대신/).fill('특이사항 없어요')
  await page.getByRole('button', { name: '이야기 전달하기' }).click()
  await expect(page.getByTestId('current-question')).toBeVisible()
})

test('no-change conversation survives reload with unobserved details and caregiver difficulty', async ({ page }) => {
  await loginCare(page, 'c1')
  await page.getByRole('button', { name: '글로 입력하기', exact: true }).click()
  await page.getByPlaceholder(/음성 대신/).fill('특이사항 없어요. 돌보는 일이 힘들어요')
  await page.getByRole('button', { name: '이야기 전달하기' }).click()
  await page.getByPlaceholder(/없어요/).fill('식사는 평소와 같아요')
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('log')).toContainText('식사는 평소와 같아요')
  await page.getByPlaceholder(/없어요/).fill('수분은 관찰하지 못했어요')
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '관찰한 돌봄 상황', exact: true })).toHaveValue(/관찰하지 못/)
  await expect(page.getByRole('textbox', { name: /요양보호사 상황/ })).toHaveValue(/힘들어요/)
})

test('failed submission stays in review and retry saves one report', async ({ page }) => {
  await loginCare(page, 'c1')
  await page.getByRole('button', { name: '글로 입력하기', exact: true }).click()
  await page.getByPlaceholder(/음성 대신/).fill('식사를 적게 드셨어요')
  await page.getByRole('button', { name: '이야기 전달하기' }).click()
  await answerFollowupsWithOptions(page)
  await page.evaluate(async () => {
    const { demoCareRepo } = await import('/src/pilot/demo/demoCareRepo.ts' /* @vite-ignore */)
    const original = demoCareRepo.patchReport
    demoCareRepo.patchReport = async (input: any) => {
      if (input.submit) { demoCareRepo.patchReport = original; throw Error('test save failure') }
      return original(input)
    }
  })
  await page.getByRole('button', { name: '센터에 보고하기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '말씀해주신 내용을 정리했어요.' })).toBeVisible()
  await expect(page.getByText(DEMO_SUBMITTED_TEXT)).not.toBeVisible()
  await page.getByRole('button', { name: '다시 시도', exact: true }).click()
  await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
  const count = await page.evaluate(async () => {
    const { demoCareRepo } = await import('/src/pilot/demo/demoCareRepo.ts' /* @vite-ignore */)
    return (await demoCareRepo.listReports()).filter((r: any) => r.status === 'submitted').length
  })
  expect(count).toBe(1)
})
