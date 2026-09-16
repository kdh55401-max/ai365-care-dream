import { test, expect, type Page } from '@playwright/test'
import { DEMO_SUBMITTED_TEXT, answerAllFollowups, loginAdmin, loginCare, resetDemo, startReport, submitChangedReport } from './helpers'

/** 6단계(책임을 나눈 업무 화면 + 2·3단계 이벤트로 계산하는 운영 지표) — 데모 모드(localStorage).
 * 지표 계산 규칙 자체(기간 경계·최초 기한·취소·재개방·분모 0)는 shared/operationMetrics.test.ts에서
 * 검증하고, 여기서는 실제 업무 흐름이 화면의 숫자·목록·상태로 이어지는지를 본다. */

const MESSAGE = '다음 방문 때 식사량을 다시 확인해 주세요.'

function card(page: Page, title: string) {
  return page.getByRole('button', { name: new RegExp(`^${title}`) })
}

function metric(page: Page, id: string) {
  return page.locator(`[data-testid="operation-metric"][data-metric="${id}"]`)
}

async function openQuality(page: Page) {
  await page.getByRole('button', { name: '실증과 품질' }).click()
  await expect(page.getByRole('region', { name: '운영 지표' })).toBeVisible()
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

test.describe('operation-dashboard: 책임을 나눈 업무 화면과 운영 지표', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('오늘의 돌봄이 기본 진입이고 다섯 책임이 나뉘며 기존 경로도 그대로 열린다', async ({ page }) => {
    await loginAdmin(page)
    // 기본 진입 = 오늘의 돌봄(업무). 연구용 실증 대시보드는 여기 있지 않다.
    await expect(page).toHaveURL(/\/admin\?demo=1/)
    await expect(page.getByRole('heading', { name: '센터가 확인할 돌봄' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'AI365 CARE DREAM 현장 실증 대시보드' })).toHaveCount(0)

    for (const name of ['오늘의 돌봄', '수급자 변화', '요청과 후속조치', '돌봄기록', '실증과 품질', '참여자 관리']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }

    // 실증과 품질: 운영 지표(업무 이벤트)와 기존 연구용 실증 대시보드가 같은 화면에서 분리돼 있다.
    await openQuality(page)
    await expect(page).toHaveURL(/\/admin\/quality\?demo=1/)
    await expect(page.getByRole('heading', { name: 'AI365 CARE DREAM 현장 실증 대시보드' })).toBeVisible()
    await expect(page.getByRole('region', { name: '현장 부담' })).toContainText('실제 노동시간이 아닙니다')

    // 새로고침·직접 주소로도 같은 화면(기존 라우팅 규칙 유지)
    await page.reload()
    await expect(page.getByRole('region', { name: '운영 지표' })).toBeVisible()

    // 기존 경로 유지
    await page.goto('/admin/presentation?demo=1')
    await expect(page.getByText('AI365 CARE DREAM 초기 실증 성과')).toBeVisible()
    await page.goto('/admin/participants?demo=1')
    await expect(page.getByRole('button', { name: '실증과 품질' })).toBeVisible()
  })

  test('자료가 없으면 0%가 아니라 해당 없음·미측정으로 구분하고, 분자·분모·정의·제외를 확인할 수 있다', async ({ page }) => {
    await loginAdmin(page)
    await openQuality(page)

    // 대상이 없는 기간 = 해당 없음(0%가 아니다)
    const first = metric(page, 'first_review_time')
    await expect(first).toContainText('해당 없음')
    await expect(first).toContainText('0%가 아닙니다')
    await expect(first.locator('span.text-2xl')).toHaveCount(0) // 비율 숫자를 만들어 보이지 않는다
    await expect(metric(page, 'reopen_count')).toContainText('해당 없음')

    // 정의·원천·제외·해석 주의를 펼쳐 확인한다(값만 보여주지 않는다)
    await first.getByRole('button', { name: '정의·분모·제외 보기' }).click()
    await expect(first).toContainText('report_events.submitted')
    await expect(first).toContainText('제출 이벤트가 없는 이전 보고')
    await expect(first).toContainText('관리자가 실제 일한 시간이 아닙니다')

    // 기간과 기준시각을 함께 보이고 한국시간 자정 경계를 밝힌다
    await expect(page.getByTestId('operation-window')).toContainText('한국시간 자정 경계')
    await page.getByRole('button', { name: '최근 7일' }).click()
    await expect(page.getByTestId('operation-window')).toBeVisible()

    // 원천 상태별 건수는 '지금 상태'이며 기간 지표와 분모가 다르다고 밝힌다
    await expect(page.getByText('원천 상태별 실제 건수 (지금 상태)')).toBeVisible()
  })

  test('DB 미적용이면 지표를 0%로 만들지 않고 미측정으로 두며, 시스템 상태와 안전 신호를 섞지 않는다', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin/quality?demo=1&demo_workflow=off')
    await expect(page.getByRole('region', { name: '운영 지표' })).toBeVisible()
    for (const id of ['first_review_time', 'request_response_rate', 'verification_on_time', 'action_link_rate', 'outcome_evidence_rate', 'reopen_count']) {
      await expect(metric(page, id)).toContainText('미측정')
      await expect(metric(page, id)).not.toContainText('0%')
    }
    await expect(page.getByTestId('operation-window')).toContainText('2단계 저장소 미적용')
    await expect(page.getByText('열린 조치').locator('..')).toContainText('준비 중')

    // 시스템 상태는 수급자 안전 신호와 분리해서 보여주고, 저장하지 않는 것은 '미측정'이라고 말한다
    await page.goto('/admin?demo=1&demo_workflow=off')
    const system = page.getByRole('region', { name: '시스템 상태' })
    await expect(system).toContainText('전송 실패')
    await expect(system).toContainText('미측정')
    await expect(system).toContainText('0건이 아니라 측정하지 않는 것입니다')
    await expect(system).toContainText('안전 신호 미검토')
  })

  test('업무 카드는 단위를 밝히고 합산하지 않으며, 카드 숫자와 전체 목록이 같은 조건으로 이어진다', async ({ context, page: care }) => {
    test.setTimeout(120_000)
    await submitFirstReport(care)
    const admin = await context.newPage()
    await loginAdmin(admin)

    await expect(admin.getByText('숫자를 더하지 마세요')).toBeVisible()
    const reports = card(admin, '새 보고 미확인')
    await expect(reports).toContainText('1건')
    await expect(reports).toContainText('수급자 1명')
    await expect(admin.getByTestId('reports-waiting')).toContainText('일반 최장 대기')

    // 카드 → 같은 조건의 전체 목록(같은 기준 시각·같은 필터)
    await reports.click()
    await expect(admin).toHaveURL(/\/admin\/work\/reports/)
    await expect(admin.getByRole('button', { name: '보고 열기 · 승인/반려' })).toHaveCount(1)
  })

  test('요청 → 현장 응답 → 관리자 결과 확인이 운영 지표에 그대로 나타난다', async ({ context, page: care }) => {
    test.setTimeout(150_000)
    await submitFirstReport(care)
    const admin = await context.newPage()
    await loginAdmin(admin)

    // 보고 검토(승인) — 최초 검토시간의 원천 이벤트가 쌓인다
    await card(admin, '새 보고 미확인').click()
    await admin.getByRole('button', { name: '보고 열기 · 승인/반려' }).click()
    const wf = admin.getByRole('region', { name: '관리자 업무' })
    await wf.getByRole('radio', { name: '조치 필요', exact: true }).click()
    await wf.getByRole('button', { name: '판단 기록' }).click()
    await admin.getByRole('button', { name: '승인', exact: true }).click()

    const reportUrl = admin.url()

    await openQuality(admin)
    const first = metric(admin, 'first_review_time')
    await expect(first).toContainText('측정됨')
    await expect(first).toContainText('측정된 표본1건 / 기간 내 제출 1건')
    // 조치 필요로 판단했지만 아직 조치가 없다 — 이슈는 분모에 남는다
    const link = metric(admin, 'action_link_rate')
    await expect(link).toContainText('0 / 1이슈')
    await expect(link).toContainText('조치가 없는 이슈')

    // 같은 보고로 돌아가 조치를 만든다
    await admin.goto(reportUrl)
    await wf.getByRole('button', { name: '조치 만들기' }).click()
    await wf.getByPlaceholder('예: 식사량이 계속 줄었는지 확인').fill('식사량 재확인')
    await wf.getByPlaceholder('예: 다음 방문 때 식사량을 다시 확인해 주세요.').fill(MESSAGE)
    await wf.getByRole('button', { name: '진행 중으로 만들기' }).click()

    await openQuality(admin)
    await expect(metric(admin, 'action_link_rate')).toContainText('1 / 1이슈')
    // 기한을 시각으로 정하지 않았으면 응답률의 분모에 들어가지 않는다(다음 방문은 별도 집계)
    await expect(metric(admin, 'request_response_rate')).toContainText('해당 없음')
    await expect(metric(admin, 'outcome_evidence_rate')).toContainText('해당 없음')

    // 게시 → 현장 응답 → 관리자 결과 확인
    await admin.getByRole('button', { name: '요청과 후속조치' }).click()
    await admin.getByRole('button', { name: /식사량 재확인/ }).click()
    await admin.getByRole('button', { name: '현장에 게시' }).click()
    await admin.getByRole('button', { name: '게시 기록' }).click()
    await expect(admin.getByText('게시됨 · 응답 대기')).toBeVisible()
    const actionUrl = admin.url()

    await care.goto('/care?demo=1')
    await startReport(care, '추가 상태변화 기록하기')
    await submitChangedReport(care, '점심 식사는 반 정도 드셨어요.')
    await answerAllFollowups(care, ['점심때입니다', '천천히 드시게 도왔습니다', '지금은 편안하십니다'])
    const answer = care.getByTestId('center-request-answer')
    await answer.getByRole('button', { name: '이 내용으로 답하기' }).click()
    await care.getByRole('button', { name: '센터에 보고하기' }).click()
    await expect(care.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()

    // 응답 도착만으로는 완료가 아니다 — 원천 상태별 건수에서 '결과 확인 대기'로 남는다
    await openQuality(admin)
    await expect(admin.getByText('후속 응답 도착(결과 확인 대기)').locator('..')).toContainText('1')
    await expect(metric(admin, 'outcome_evidence_rate')).toContainText('해당 없음')

    await admin.goto(actionUrl)
    await admin.getByRole('button', { name: '결과 확인', exact: true }).click()
    await admin.getByRole('radio', { name: '변화 없음 확인' }).check()
    await admin.getByLabel('결과 요약(필수)').fill('점심 식사량 반 공기 — 지난 보고와 비슷')
    await admin.getByRole('button', { name: '결과 확인 기록' }).click()
    await expect(admin.getByText(/관리자 결과 확인 \(1건/)).toBeVisible()

    // 결과 근거 보유율: 현장 응답 원문이 근거로 연결된 종결 주기 1건
    await openQuality(admin)
    const evidence = metric(admin, 'outcome_evidence_rate')
    await expect(evidence).toContainText('1 / 1주기')
    await evidence.getByRole('button', { name: '정의·분모·제외 보기' }).click()
    await expect(evidence).toContainText('결과가 적절했는지')
    await expect(admin.getByText('후속 응답 도착(결과 확인 대기)').locator('..')).toContainText('0')
  })
})
