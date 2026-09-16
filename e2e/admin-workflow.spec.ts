import { test, expect, type Page } from '@playwright/test'
import { DEMO_SUBMITTED_TEXT, answerAllFollowups, loginAdmin, loginCare, resetDemo, startReport } from './helpers'

/** 2단계(관리자 판단·조치·안전 검토) — 데모 모드(localStorage). 실제 DB의 원자성·버전 충돌·
 * 중복 요청은 api/_lib/workflowMigration.test.ts(PGlite)에서 따로 검증한다. */

const kstDate = (offsetDays: number) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10)

async function submitFieldReport(page: Page, text: string) {
  await loginCare(page, 'c1', '6003')
  await startReport(page)
  await page.getByPlaceholder(/음성 대신/).fill(text)
  await page.getByRole('button', { name: '이야기 전달하기' }).click()
  await answerAllFollowups(page, ['점심때입니다', '조금 더 드시라고 권했습니다', '지금은 평소와 비슷합니다'])
  await page.getByRole('button', { name: '센터에 보고하기' }).click()
  await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
}

/** 응급 신호가 기록된 제출 보고를 데모 저장소에 직접 넣는다(현장 응급 화면은 별도 흐름). */
async function seedFlaggedReport(page: Page) {
  await page.evaluate(() => {
    const key = 'ai365_care_demo_db_v1'
    const db = JSON.parse(localStorage.getItem(key) || '{}')
    const now = new Date().toISOString()
    db.reports = [
      ...(db.reports ?? []),
      {
        id: 'demo-flagged-1', participant_code: 'C03', recipient_code: 'A04', report_type: 'daily', report_date: now.slice(0, 10), status: 'submitted', input_method: 'text',
        started_at: now, submitted_at: now, completion_seconds: 40, raw_input: '어르신이 불러도 반응이 없으셨다가 돌아오셨어요.', followup_questions: [], followup_answers: [],
        ai_generated_report: null, caregiver_final_report: { change: '잠시 반응 없음', action: '119 안내 확인', result: '의식 회복', escalation: '센터 확인 필요', caregiverNote: '' },
        initial_status_choice: null, no_change_initial_input: false, observed_domains_json: [], changed_domains_json: [], unobserved_domains_json: [], uncertain_domains_json: [],
        no_change_followup_count: 0, no_change_followup_answered: 0, initial_information_count: 0, final_information_count: 0, information_added_count: 0, no_information_report: false,
        report_source: 'live', scenario_id: null, emergency_flagged: true, ai_fallback_used: null, ai_fallback_stage: null,
        review_status: 'pending', review_note: null, review_note_visible_to_caregiver: false, reviewed_at: null, review_history: [], last_review_request_id: null,
        admin_first_viewed_at: null, admin_final_report: null, deleted: false, created_at: now, updated_at: now,
      },
    ]
    localStorage.setItem(key, JSON.stringify(db))
  })
}

function card(page: Page, title: string) {
  return page.getByRole('button', { name: new RegExp(`^${title}`) })
}

test.describe('admin-workflow: 관리자 판단·조치·안전 검토', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('변화 보고 → 승인과 별개로 "조치 필요" 판단 → 현장 확인 요청(미게시 초안) → 기한 변경 이력 → 새로고침 유지', async ({ context, page: carePage }) => {
    test.setTimeout(90_000)
    await submitFieldReport(carePage, '오늘 식사를 평소보다 적게 하셨어요.')
    const admin = await context.newPage()
    await loginAdmin(admin)

    await expect(card(admin, '새 보고 미확인')).toContainText('1건')
    await card(admin, '새 보고 미확인').click()
    await expect(admin).toHaveURL(/\/admin\/work\/reports\?demo=1/)
    await admin.getByRole('button', { name: '보고 열기 · 승인/반려' }).click()

    const wf = admin.getByRole('region', { name: '관리자 업무' })
    await expect(wf.getByText(/최초 제출 이벤트: \d/)).toBeVisible() // 기능 적용 후 제출 — 이벤트가 남는다
    await admin.getByRole('button', { name: '승인', exact: true }).click()
    await expect(admin.getByText('승인본 (활용 가능 기록)')).toBeVisible()
    // 승인과 관리자 판단은 별개 — 승인 뒤에도 판단은 아직 없다
    await admin.reload()
    await expect(wf.getByText('아직 판단 없음')).toBeVisible()
    await expect(wf.getByText(/최초 검토\(승인\/반려\) 이벤트: .*승인/)).toBeVisible()

    await wf.getByRole('radio', { name: '조치 필요', exact: true }).click()
    await wf.getByPlaceholder(/판단 근거/).fill('식사량 감소 보고 — 다음 방문 재확인 필요')
    await wf.getByRole('button', { name: '판단 기록' }).click()
    await expect(wf.getByText('"조치 필요" 판단에 아직 연결된 조치가 없습니다.')).toBeVisible()

    await wf.getByRole('button', { name: '조치 만들기' }).click()
    await wf.getByPlaceholder('예: 식사량이 계속 줄었는지 확인').fill('식사량 재확인')
    await wf.getByPlaceholder('예: 다음 방문 때 식사량을 다시 확인해 주세요.').fill('다음 방문 때 식사량을 다시 확인해 주세요.')
    await wf.getByPlaceholder('예: 담당 사회복지사', { exact: true }).fill('담당 사회복지사')
    await wf.getByLabel('관리자 결과 재확인기한 종류').selectOption('datetime')
    await wf.getByLabel('관리자 결과 재확인기한 일시(한국 시간)').fill(`${kstDate(2)}T09:00`)
    await wf.getByRole('button', { name: '진행 중으로 만들기' }).click()
    await expect(wf.getByText('이 보고에서 시작한 조치 (1건)')).toBeVisible()
    await expect(wf.getByText('현장 요청 미게시')).toBeVisible()

    await wf.getByRole('button', { name: /식사량 재확인/ }).click()
    await expect(admin).toHaveURL(/\/admin\/actions\/[^?]+\?demo=1/)
    await expect(admin.getByText('[미게시 초안 — 요양보호사에게 전달되지 않음]')).toBeVisible()
    const responseRow = admin.locator('tr', { hasText: '현장 응답기한' })
    await expect(responseRow).toContainText('미게시 — 현장에 아직 전달되지 않음')
    await expect(responseRow).toContainText('다음 실제 방문(날짜 없음)')
    await expect(admin.getByRole('button', { name: '수행 결과 기록 · 완료' })).toHaveCount(0) // 현장 답변 전 완료 불가
    await expect(admin.getByText('담당 사회복지사 (입력값 — 로그인 신원 아님)')).toBeVisible()

    await admin.locator('tr', { hasText: '관리자 결과 재확인기한' }).getByRole('button', { name: '기한 변경' }).click()
    await admin.getByLabel('관리자 결과 재확인기한 새 값 일시(한국 시간)').fill(`${kstDate(3)}T09:00`)
    await admin.getByLabel('변경 이유(필수)').fill('다음 방문 일정 지연')
    await admin.getByRole('button', { name: '기한 변경 기록' }).click()
    await expect(admin.locator('tr', { hasText: '관리자 결과 재확인기한' })).toContainText('(변경됨)')
    await expect(admin.getByText(/기한 변경 · .*이유: 다음 방문 일정 지연/)).toBeVisible()

    await admin.reload()
    await expect(admin.locator('tr', { hasText: '관리자 결과 재확인기한' })).toContainText('(변경됨)')
    await expect(admin.getByText(/이력 \(2건/)).toBeVisible() // 생성 + 기한 변경
  })

  test('평소와 같은 보고는 조치 없이 "추가 조치 불필요"로 마치고, 수급자 기록에 판단이 남는다', async ({ context, page: carePage }) => {
    test.setTimeout(90_000)
    // 관리자가 보기에 추가 조치가 필요 없는 일상 보고(현장의 '평소와 비슷' 전용 흐름과는 별개로 이야기 시작 경로 사용)
    await submitFieldReport(carePage, '오늘 어르신과 산책을 함께 했어요.')
    const admin = await context.newPage()
    await loginAdmin(admin)
    await card(admin, '새 보고 미확인').click()
    await admin.getByRole('button', { name: '보고 열기 · 승인/반려' }).click()
    await admin.getByRole('button', { name: '승인', exact: true }).click()
    const wf = admin.getByRole('region', { name: '관리자 업무' })
    await wf.getByRole('radio', { name: '검토 완료 · 추가 조치 불필요' }).click()
    await expect(wf.getByText('평소와 같은 보고는 조치를 만들지 않고 이 판단으로 마칩니다.')).toBeVisible()
    await wf.getByRole('button', { name: '판단 기록' }).click()
    await expect(wf.getByText(/현재: 검토 완료 · 추가 조치 불필요/)).toBeVisible()
    await expect(wf.getByText('이 보고에서 시작한 조치 (0건)')).toBeVisible()

    await admin.getByRole('button', { name: '수급자 A01의 기록 흐름 보기' }).click()
    const entry = admin.locator('article').first()
    await expect(entry.getByText('관리자 판단: 검토 완료 · 추가 조치 불필요')).toBeVisible()
    await expect(entry.getByText('이 보고의 조치 0건')).toBeVisible()
    await expect(admin.getByText('진행 중·초안 조치 0건')).toBeVisible()
    await admin.getByRole('button', { name: '오늘의 돌봄' }).click()
    await expect(card(admin, '새 보고 미확인')).toContainText('0건')
  })

  test('보고를 승인해도 안전 신호는 남고, 명시적 안전 검토로만 빠진다 · 기한 지난 직접 조치는 완료 기록으로 빠진다', async ({ page }) => {
    test.setTimeout(90_000)
    await seedFlaggedReport(page)
    await loginAdmin(page)
    await expect(card(page, '안전 신호 미검토')).toContainText('1건')

    await card(page, '안전 신호 미검토').click()
    await expect(page).toHaveURL(/\/admin\/work\/safety/)
    await page.getByRole('button', { name: /수급자 A04/ }).first().click()
    await page.getByRole('button', { name: '승인', exact: true }).click()
    await expect(page.getByText('승인본 (활용 가능 기록)')).toBeVisible()
    const wf = page.getByRole('region', { name: '관리자 업무' })
    await page.reload()
    await expect(wf.getByText('안전 검토 기록 없음')).toBeVisible()

    // 기한이 이미 지난 관리자 직접 조치를 만들고 안전 검토에 연결
    await wf.getByRole('button', { name: '조치 만들기' }).click()
    await wf.getByLabel('관리자 직접 조치(수행 사실을 관리자가 기록)').check()
    await wf.getByPlaceholder('예: 식사량이 계속 줄었는지 확인').fill('보호자에게 상황 안내')
    await wf.getByLabel('관리자 직접 수행기한 종류').selectOption('datetime')
    await wf.getByLabel('관리자 직접 수행기한 일시(한국 시간)').fill(`${kstDate(-1)}T09:00`)
    await wf.getByRole('button', { name: '진행 중으로 만들기' }).click()
    await expect(wf.getByText('이 보고에서 시작한 조치 (1건)')).toBeVisible()

    await wf.getByLabel('확인함 · 조치로 연결').check()
    await wf.getByRole('combobox').filter({ hasText: '선택' }).selectOption({ label: '보호자에게 상황 안내 (진행 중)' })
    await wf.getByPlaceholder(/119 연결/).fill('119 연결 확인, 보호자 안내 조치 연결')
    await wf.getByRole('button', { name: '안전 검토 기록' }).click()
    await expect(wf.getByText(/현재: 확인함 · 조치로 연결/)).toBeVisible()

    await page.getByRole('button', { name: '오늘의 돌봄' }).click()
    await expect(card(page, '안전 신호 미검토')).toContainText('0건')
    await expect(card(page, '기한 지난 조치')).toContainText('1건')
    await card(page, '기한 지난 조치').click()
    await page.getByRole('button', { name: /보호자에게 상황 안내/ }).click()
    await page.getByRole('button', { name: '수행 결과 기록 · 완료' }).click()
    await page.getByLabel(/실제로 한 일과 결과 근거/).fill('보호자와 통화해 상황 안내함')
    await page.getByRole('button', { name: '완료 기록' }).click()
    await expect(page.getByText(/완료 근거: 보호자와 통화해 상황 안내함/)).toBeVisible()
    await page.getByRole('button', { name: '오늘의 돌봄' }).click()
    await expect(card(page, '기한 지난 조치')).toContainText('0건')
  })

  test('동시 수정: 다른 탭이 먼저 판단을 저장하면 충돌을 알리고 입력값을 지우지 않는다', async ({ context, page }) => {
    await seedFlaggedReport(page)
    await loginAdmin(page)
    await page.goto('/admin/reports/demo-flagged-1?demo=1')
    const other = await context.newPage()
    await other.goto('/admin/reports/demo-flagged-1?demo=1')

    const wf1 = page.getByRole('region', { name: '관리자 업무' })
    const wf2 = other.getByRole('region', { name: '관리자 업무' })
    await expect(wf2.getByText('아직 판단 없음')).toBeVisible()
    await wf1.getByRole('radio', { name: '추가 관찰 필요' }).click()
    await wf1.getByRole('button', { name: '판단 기록' }).click()
    await expect(wf1.getByText(/현재: 추가 관찰 필요/)).toBeVisible()

    await wf2.getByRole('radio', { name: '판단 보류' }).click()
    await wf2.getByPlaceholder(/판단 근거/).fill('보호자 확인 후 판단')
    await wf2.getByRole('button', { name: '판단 기록' }).click()
    await expect(wf2.getByText(/다른 곳에서 이 보고의 판단이 먼저 저장됐습니다/)).toBeVisible()
    await expect(wf2.getByPlaceholder(/판단 근거/)).toHaveValue('보호자 확인 후 판단')
  })

  test('DB 적용 전 상태에서는 가짜 0 대신 "준비 중"을 보이고 저장하지 않는다', async ({ page }) => {
    await seedFlaggedReport(page)
    await loginAdmin(page)
    await page.goto('/admin?demo=1&demo_workflow=off')
    await expect(card(page, '기한 지난 조치')).toContainText('준비 중')
    await expect(card(page, '오늘 재확인')).toContainText('준비 중')
    await expect(card(page, '안전 신호 미검토')).toContainText('검토 여부 미확인')
    await card(page, '안전 신호 미검토').click()
    await expect(page).toHaveURL(/demo_workflow=off/)
    await page.getByRole('button', { name: /수급자 A04/ }).first().click()
    await expect(page.getByText(/준비 중 — 업무 기록 저장소가 DB에 적용되기 전/)).toBeVisible()
    await expect(page.getByRole('button', { name: '판단 기록' })).toHaveCount(0)
  })
})
