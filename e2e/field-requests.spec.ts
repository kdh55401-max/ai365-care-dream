import { test, expect, type Page } from '@playwright/test'
import { DEMO_SUBMITTED_TEXT, answerAllFollowups, loginAdmin, loginCare, resetDemo, startReport, submitChangedReport, switchRecipient } from './helpers'

/** 3단계(현장 요청 게시 → 현장 응답 → 관리자 결과 확인 → 종결/추가 확인) — 데모 모드(localStorage).
 * 실제 DB의 잠금·중복 요청·버전 충돌·늦은 응답 처리는 api/_lib/fieldRequestsMigration.test.ts(PGlite)에서 검증한다. */

const MESSAGE = '다음 방문 때 식사량을 다시 확인해 주세요.'
const INTERNAL = '내부메모-보호자민원이력-현장비공개'

function card(page: Page, title: string) {
  return page.getByRole('button', { name: new RegExp(`^${title}`) })
}

async function submitFirstReport(page: Page, code = 'c1') {
  await loginCare(page, code, '6003')
  await startReport(page)
  await page.getByPlaceholder(/음성 대신/).fill('오늘 식사를 평소보다 적게 하셨어요.')
  await page.getByRole('button', { name: '이야기 전달하기' }).click()
  await answerAllFollowups(page, ['점심때입니다', '조금 더 드시라고 권했습니다', '지금은 평소와 비슷합니다'])
  await page.getByRole('button', { name: '센터에 보고하기' }).click()
  await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
}

/** 첫 보고에서 "조치 필요" 판단 → 현장 확인 요청 조치 → 조치 화면에서 게시. */
async function publishRequest(admin: Page, target?: string) {
  await card(admin, '새 보고 미확인').click()
  await admin.getByRole('button', { name: '보고 열기 · 승인/반려' }).click()
  const wf = admin.getByRole('region', { name: '관리자 업무' })
  await wf.getByRole('radio', { name: '조치 필요', exact: true }).click()
  await wf.getByRole('button', { name: '판단 기록' }).click()
  await wf.getByRole('button', { name: '조치 만들기' }).click()
  await wf.getByPlaceholder('예: 식사량이 계속 줄었는지 확인').fill('식사량 재확인')
  await wf.getByPlaceholder('예: 다음 방문 때 식사량을 다시 확인해 주세요.').fill(MESSAGE)
  await wf.getByLabel('내부 메모(관리자 전용 — 현장에 보이지 않음)').fill(INTERNAL)
  await wf.getByRole('button', { name: '진행 중으로 만들기' }).click()
  await wf.getByRole('button', { name: /식사량 재확인/ }).click()
  await expect(admin).toHaveURL(/\/admin\/actions\/[^?]+\?demo=1/)
  await admin.getByRole('button', { name: '현장에 게시' }).click()
  if (target) {
    await admin.getByRole('radio', { name: /지정한 요양보호사/ }).check()
    await admin.getByLabel('지정할 요양보호사').selectOption(target)
  }
  await admin.getByRole('button', { name: '게시 기록' }).click()
  await expect(admin.getByText('게시됨 · 응답 대기')).toBeVisible()
  await expect(admin.getByText('[게시됨 — 게시한 문구가 현장에 보임]')).toBeVisible()
}

/** 오늘 기본 보고를 낸 뒤 추가 상태변화 보고를 검토 화면까지 진행한다. */
async function reachReview(page: Page, text: string) {
  await page.goto('/care?demo=1')
  await startReport(page, '추가 상태변화 기록하기')
  await submitChangedReport(page, text)
  await answerAllFollowups(page, ['점심때입니다', '천천히 드시게 도왔습니다', '지금은 편안하십니다'])
  await expect(page.getByText('말씀해주신 내용을 정리했어요.')).toBeVisible()
}

async function setAssignments(page: Page, assignments: Record<string, string[]>) {
  await page.evaluate((a) => {
    const key = 'ai365_care_demo_db_v1'
    const db = JSON.parse(localStorage.getItem(key) || '{}')
    db.assignments = a
    localStorage.setItem(key, JSON.stringify(db))
  }, assignments)
}

test.describe('field-requests: 관리자 요청 → 현장 응답 → 결과 확인', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('게시한 요청이 현재 담당에게 보이고, 말한 내용으로 답하면 응답 대기가 풀리며, 관리자 결과 확인으로만 완료된다', async ({ context, page: care }) => {
    test.setTimeout(120_000)
    await submitFirstReport(care)
    const admin = await context.newPage()
    await loginAdmin(admin)
    await publishRequest(admin)
    await expect(admin.getByText('현장 화면 표시 기록 없음 — 읽음으로 추정하지 않음')).toBeVisible()

    await admin.getByRole('button', { name: '대시보드' }).click()
    await expect(card(admin, '현장 응답 대기 요청')).toContainText('1건')
    await expect(card(admin, '현장 응답 대기 요청')).toContainText('방문 대기 1')

    // 현장: 홈에 요청 문구만 보이고 내부 메모는 보이지 않는다
    await care.goto('/care?demo=1')
    const notice = care.getByRole('region', { name: '센터 확인 요청' })
    await expect(notice).toContainText('센터 확인 요청 1건')
    await expect(notice).toContainText(MESSAGE)
    await expect(notice).toContainText('다음 방문 때')
    await expect(care.locator('body')).not.toContainText(INTERNAL)

    // 화면 표시 기록(읽음 추정 아님)
    await admin.getByRole('button', { name: '조치', exact: true }).click()
    await admin.getByRole('button', { name: /식사량 재확인/ }).click()
    await expect(admin.getByText(/현장 화면 첫 표시 .*\(C01\)/)).toBeVisible()

    // 현장: 기존 말하기 흐름 끝에서, 이미 말한 문장으로 답한다(다시 묻지 않음)
    await reachReview(care, '점심 식사는 반 정도 드셨어요.')
    const answer = care.getByTestId('center-request-answer')
    await expect(answer).toContainText(MESSAGE)
    await expect(answer).toContainText('방금 말씀하신 내용: “점심 식사는 반 정도 드셨어요.”')
    await expect(answer.getByRole('radio', { name: '이번에는 답하지 않음' })).toHaveAttribute('aria-checked', 'true') // 기본은 답하지 않음
    await answer.getByRole('button', { name: '이 내용으로 답하기' }).click()
    await expect(answer.getByRole('radio', { name: '확인했어요(관찰함)' })).toHaveAttribute('aria-checked', 'true')
    await expect(care.locator('body')).not.toContainText(INTERNAL)
    await care.getByRole('button', { name: '센터에 보고하기' }).click()
    await expect(care.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
    await expect(care.getByText('센터 확인 요청 1건에 대한 답도 함께 전달했어요.')).toBeVisible()
    await care.getByRole('button', { name: '홈으로' }).click()
    await expect(care.getByRole('region', { name: '센터 확인 요청' })).toHaveCount(0) // 답한 요청은 다시 묻지 않는다

    // 관리자: 응답 도착 → 결과 확인 대기(완료 아님)
    await admin.getByRole('button', { name: '대시보드' }).click()
    await expect(card(admin, '현장 응답 대기 요청')).toContainText('0건')
    await expect(card(admin, '응답 도착 · 결과 확인 대기')).toContainText('1건')
    await card(admin, '응답 도착 · 결과 확인 대기').click()
    await expect(admin).toHaveURL(/\/admin\/work\/verification/)
    await admin.getByRole('button', { name: /식사량 재확인/ }).click()
    await expect(admin.getByText('응답 도착', { exact: true })).toBeVisible()
    await expect(admin.getByText('보고 원문에서: “점심 식사는 반 정도 드셨어요.”')).toBeVisible()
    await expect(admin.getByText(/현장 응답 대기 해소\(완료 아님/)).toBeVisible()
    await expect(admin.locator('h2 + span').first()).toHaveText('진행 중')

    await admin.getByRole('button', { name: '결과 확인', exact: true }).click()
    await expect(admin.getByLabel(/근거\(필수/)).toHaveValue(/현장 응답\(C01, .*\): 확인했어요\(관찰함\) — 보고 원문 “점심 식사는 반 정도 드셨어요.”/)
    await admin.getByRole('radio', { name: '변화 없음 확인' }).check()
    await admin.getByLabel('결과 요약(필수)').fill('점심 식사량 반 공기 — 지난 보고와 비슷')
    await admin.getByRole('button', { name: '결과 확인 기록' }).click()
    await expect(admin.getByText(/확인한 결과: 변화 없음 확인/)).toBeVisible()
    await expect(admin.getByText(/건강 개선 지표로 집계하지 않음/).first()).toBeVisible()
    await expect(admin.getByText(/관리자 결과 확인 \(1건/)).toBeVisible()
    await expect(admin.getByText('결과 확인으로 게시 종료', { exact: true })).toHaveCount(0) // 응답 도착한 요청은 그대로 '응답 도착'

    await admin.reload()
    await expect(admin.getByText(/이력 \(4건/)).toBeVisible() // 생성·게시·응답 도착·결과 확인
    await admin.getByRole('button', { name: '대시보드' }).click()
    await expect(card(admin, '응답 도착 · 결과 확인 대기')).toContainText('0건')
  })

  test('확인 불가는 남은 문제·다음 책임 없이 기록되지 않고, 추가 확인은 새 주기를 열어 다시 게시할 수 있다', async ({ context, page: care }) => {
    test.setTimeout(120_000)
    await submitFirstReport(care)
    const admin = await context.newPage()
    await loginAdmin(admin)
    await publishRequest(admin)

    await admin.getByRole('button', { name: '결과 확인', exact: true }).click()
    await expect(admin.getByText(/아직 이번 주기 현장 응답이 없습니다/)).toBeVisible()
    await admin.getByRole('radio', { name: '확인 불가' }).check()
    await admin.getByLabel('결과 요약(필수)').fill('이번 주 방문이 없어 확인하지 못함')
    await admin.getByLabel(/근거\(필수/).fill('방문 기록 없음(현장 응답 없음)')
    await admin.getByRole('radio', { name: /추가 확인 — 새 후속 주기/ }).check()
    await admin.getByRole('button', { name: '결과 확인 기록' }).click()
    await expect(admin.getByText(/남은 문제와 다음 책임·업무를 적어 주세요/)).toBeVisible()
    await expect(admin.getByLabel('결과 요약(필수)')).toHaveValue('이번 주 방문이 없어 확인하지 못함') // 입력 유지

    await admin.getByLabel(/남은 문제\(필수\)/).fill('식사량 변화 미확인')
    await admin.getByLabel(/다음 책임·업무\(필수/).fill('사회복지사가 다음 방문 뒤 재요청')
    await admin.getByRole('button', { name: '결과 확인 기록' }).click()
    await expect(admin.getByText(/관리자 결과 확인 \(1건/)).toBeVisible()
    await expect(admin.getByText('결과 확인으로 게시 종료', { exact: true })).toBeVisible()
    await expect(admin.locator('h2 + span').first()).toHaveText('진행 중') // 종결 아님 — 새 주기
    await expect(admin.locator('tr', { hasText: '현장 응답기한' })).toHaveCount(2) // 과거 주기 기한 보존 + 새 주기

    // 내려간 요청은 현장에 보이지 않는다
    await care.goto('/care?demo=1')
    await expect(care.getByRole('region', { name: '센터 확인 요청' })).toHaveCount(0)

    // 새 주기에서 다시 게시
    await admin.getByRole('button', { name: '현장에 게시' }).click()
    await admin.getByRole('button', { name: '게시 기록' }).click()
    await expect(admin.getByText('게시됨 · 응답 대기')).toBeVisible()
    await expect(admin.getByText(/주기 2 · 게시/)).toBeVisible()
    await care.reload()
    await expect(care.getByRole('region', { name: '센터 확인 요청' })).toContainText('센터 확인 요청 1건')
  })

  test('철회 뒤 늦게 도착한 답은 기록만 남고 요청을 되살리지 않는다', async ({ context, page: care }) => {
    test.setTimeout(120_000)
    await submitFirstReport(care)
    const admin = await context.newPage()
    await loginAdmin(admin)
    await publishRequest(admin)

    // 요양보호사가 검토 화면에서 요청을 보고 있는 동안 관리자가 철회
    await reachReview(care, '점심 식사는 반 정도 드셨어요.')
    await care.getByTestId('center-request-answer').getByRole('radio', { name: '요청대로 했어요(수행함)' }).click()

    await admin.getByRole('button', { name: '철회' }).click()
    await admin.getByLabel('철회 이유(필수)').fill('보호자가 직접 확인해 줌')
    await admin.getByRole('button', { name: '철회 기록' }).click()
    await expect(admin.getByText('철회됨', { exact: true })).toBeVisible()

    await care.getByRole('button', { name: '센터에 보고하기' }).click()
    await expect(care.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()

    await admin.reload()
    await expect(admin.getByText(/늦은 응답 — 요청이 철회됨 뒤 도착, 기록만 남김/)).toBeVisible()
    await expect(admin.getByText('철회됨', { exact: true })).toBeVisible()
    await expect(admin.getByText(/현장 응답 도착 · .*늦은 응답\(기록만\)/)).toBeVisible()
    await expect(admin.getByRole('button', { name: '현장에 게시' })).toBeVisible() // 같은 주기에서 다시 게시 가능
    await admin.getByRole('button', { name: '대시보드' }).click()
    await expect(card(admin, '응답 도착 · 결과 확인 대기')).toContainText('0건')
  })

  test('배정 변경: 지정 대상이 담당에서 빠지면 재배정 필요로 뜨고, 대상을 바꾸면 새 담당에게만 보인다', async ({ context, page: care }) => {
    test.setTimeout(120_000)
    await submitFirstReport(care)
    const admin = await context.newPage()
    await loginAdmin(admin)
    await publishRequest(admin, 'C01')

    // A01 담당이 C01 → C02로 바뀜
    await setAssignments(admin, { C01: ['A02'], C02: ['A03', 'A01'], C03: ['A04', 'A05'] })
    await admin.getByRole('button', { name: '대시보드' }).click()
    await expect(card(admin, '재배정·담당 필요')).toContainText('1건')
    await card(admin, '재배정·담당 필요').click()
    await expect(admin.getByText('지정한 요양보호사가 지금 이 수급자 담당이 아님 — 재배정 필요')).toBeVisible()

    // C02는 A01 담당이지만 C01에게 지정된 요청이라 아직 안 보인다
    await care.goto('/care?demo=1')
    await care.getByText('연습 및 계정').click()
    await care.getByRole('button', { name: '로그아웃' }).click()
    await loginCare(care, 'c2', '6003')
    await switchRecipient(care, 'A01')
    await expect(care.getByRole('region', { name: '센터 확인 요청' })).toHaveCount(0)

    await admin.getByRole('button', { name: /수급자 A01/ }).first().click()
    await admin.getByRole('button', { name: '대상 변경' }).click()
    await admin.getByLabel('지정할 요양보호사').selectOption('C02')
    await admin.getByLabel('변경 이유(필수)').fill('담당 변경')
    await admin.getByRole('button', { name: '대상 변경 기록' }).click()
    await expect(admin.getByText(/지정 요양보호사 C02/).first()).toBeVisible()

    await care.reload()
    await expect(care.getByRole('region', { name: '센터 확인 요청' })).toContainText(MESSAGE)
    await admin.getByRole('button', { name: '대시보드' }).click()
    await expect(card(admin, '재배정·담당 필요')).toContainText('0건')
  })

  test('3단계 DB 적용 전(2단계만) 상태에서는 게시·결과 확인이 "준비 중"이고 저장 버튼이 없다', async ({ context, page: care }) => {
    test.setTimeout(90_000)
    await submitFirstReport(care)
    const admin = await context.newPage()
    await loginAdmin(admin)
    await admin.goto('/admin?demo=1&demo_workflow=stage2')
    await expect(card(admin, '현장 응답 대기 요청')).toContainText('준비 중')
    await expect(card(admin, '응답 도착 · 결과 확인 대기')).toContainText('준비 중')
    await card(admin, '새 보고 미확인').click()
    await admin.getByRole('button', { name: '보고 열기 · 승인/반려' }).click()
    const wf = admin.getByRole('region', { name: '관리자 업무' })
    await wf.getByRole('button', { name: '조치 만들기' }).click()
    await wf.getByPlaceholder('예: 식사량이 계속 줄었는지 확인').fill('식사량 재확인')
    await wf.getByPlaceholder('예: 다음 방문 때 식사량을 다시 확인해 주세요.').fill(MESSAGE)
    await wf.getByRole('button', { name: '진행 중으로 만들기' }).click()
    await wf.getByRole('button', { name: /식사량 재확인/ }).click()
    await expect(admin).toHaveURL(/demo_workflow=stage2/)
    await expect(admin.getByText(/현장 게시·응답·결과 확인: 준비 중/)).toBeVisible()
    await expect(admin.getByRole('button', { name: '현장에 게시' })).toHaveCount(0)
    await expect(admin.getByRole('button', { name: '결과 확인', exact: true })).toHaveCount(0)
  })
})
