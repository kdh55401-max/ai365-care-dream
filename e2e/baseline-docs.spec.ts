import { test, expect, type Page } from '@playwright/test'
import { DEMO_SUBMITTED_TEXT, answerAllFollowups, loginAdmin, loginCare, resetDemo, startReport } from './helpers'

/** 4단계(원본 문서 → 기준정보 입력 → 관리자 확인 → 조치 근거 연결, 상충 보존, 과거 태그 표시) — 데모 모드(localStorage).
 * 실제 DB의 불변·버전·권한·상충 보존은 api/_lib/baselineMigration.test.ts(PGlite)에서 검증한다. */

const RECIPIENT_URL = '/admin/org/gadream365/recipients/A01?demo=1'
const pdf = (text: string) => ({ name: `${text}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`) })

function section(page: Page) {
  return page.getByRole('region', { name: '기준문서 · 기준정보' })
}

async function uploadDoc(page: Page, file: ReturnType<typeof pdf>, opts: { type?: string; date?: string; source?: string } = {}) {
  const s = section(page)
  await s.getByRole('button', { name: '문서 올리기' }).click()
  await s.getByLabel('원본 파일').setInputFiles(file)
  if (opts.type) await s.getByLabel('문서 종류').selectOption({ label: opts.type })
  if (opts.date) await s.getByLabel('문서 기준일').fill(opts.date)
  if (opts.source) await s.getByLabel('출처').fill(opts.source)
  await s.getByRole('button', { name: '올리기', exact: true }).click()
}

async function enterEntry(page: Page, docText: string | null, fields: { kind?: string; domain: string; statement: string; page?: string }) {
  const s = section(page)
  if (docText) {
    await s.getByTestId('source-document').filter({ hasText: `${docText}.pdf` }).getByRole('button', { name: '이 문서로 기준정보 입력' }).click()
  } else {
    await s.getByRole('button', { name: '기준정보 입력', exact: true }).click()
  }
  const form = s.getByLabel('기준정보 입력')
  if (fields.kind) await form.getByRole('radio', { name: fields.kind }).check()
  await form.getByLabel('세부 영역').selectOption({ label: fields.domain })
  await form.getByLabel('기준 설명').fill(fields.statement)
  if (fields.page) await form.getByLabel('쪽·위치').fill(fields.page)
  await form.getByRole('button', { name: '저장하고 관리자 확인' }).click()
  await expect(form).toHaveCount(0)
}

async function submitFieldReport(page: Page) {
  await loginCare(page, 'c1', '6003')
  await startReport(page)
  await page.getByPlaceholder(/음성 대신/).fill('오늘 식사를 평소보다 적게 하셨어요.')
  await page.getByRole('button', { name: '이야기 전달하기' }).click()
  await answerAllFollowups(page, ['점심때입니다', '조금 더 드시라고 권했습니다', '지금은 평소와 비슷합니다'])
  await page.getByRole('button', { name: '센터에 보고하기' }).click()
  await expect(page.getByText(DEMO_SUBMITTED_TEXT)).toBeVisible()
}

async function createDirectAction(admin: Page) {
  await admin.goto('/admin/work/reports?demo=1')
  await admin.getByRole('button', { name: '보고 열기 · 승인/반려' }).click()
  const wf = admin.getByRole('region', { name: '관리자 업무' })
  await wf.getByRole('button', { name: '조치 만들기' }).click()
  await wf.getByLabel('관리자 직접 조치(수행 사실을 관리자가 기록)').check()
  await wf.getByPlaceholder('예: 식사량이 계속 줄었는지 확인').fill('보호자에게 식사량 안내')
  await wf.getByRole('button', { name: '진행 중으로 만들기' }).click()
  await wf.getByRole('button', { name: /보호자에게 식사량 안내/ }).click()
  await expect(admin).toHaveURL(/\/admin\/actions\/[^?]+\?demo=1/)
}

test.describe('baseline-docs: 기준문서 → 기준정보 → 확인 → 조치 근거', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('원본을 올리고(기준일 미기재 유지) 문서에서 입력·확인한 기준정보를 조치 근거로 연결하며, 수정 뒤에도 당시 버전이 남는다', async ({ context, page: care }) => {
    test.setTimeout(120_000)
    await submitFieldReport(care)
    const admin = await context.newPage()
    await loginAdmin(admin)
    await admin.goto(RECIPIENT_URL)
    const s = section(admin)
    await expect(s).toContainText('기준정보 미등록 — 데이터 상태이며 건강 위험 신호가 아닙니다')

    await uploadDoc(admin, pdf('급여제공계획서'), { source: '센터 작성' })
    const docRow = s.getByTestId('source-document')
    await expect(docRow).toContainText('급여제공계획서')
    await expect(docRow).toContainText('문서 기준일 미기재') // 업로드일로 대신하지 않음
    await expect(docRow).toContainText('출처 센터 작성')
    await expect(docRow).toContainText('급여제공계획서.pdf')
    const popup = admin.waitForEvent('popup')
    await docRow.getByRole('button', { name: '원본 보기' }).click()
    // 원본은 새 창으로 열린다(헤드리스 브라우저는 PDF를 그리지 않고 내려받기로 넘겨 창 주소만 확인 가능).
    await (await popup).close()

    await enterEntry(admin, '급여제공계획서', { domain: '식사', statement: '평소 한 끼 2/3 공기', page: '2쪽 식사 항목' })
    await enterEntry(admin, '급여제공계획서', { kind: '계획·목표(관찰 결과 아님)', domain: '이동', statement: '주 3회 실내 걷기' })
    const meal = s.getByTestId('baseline-entry').filter({ hasText: '평소 한 끼 2/3 공기' })
    await expect(meal).toContainText('관리자 확인')
    await expect(meal).toContainText('2쪽 식사 항목')
    await expect(meal).toContainText('기준일 미기재')
    await expect(s.getByText('계획·목표(관찰 결과 아님)', { exact: true })).toBeVisible()
    await expect(s).not.toContainText('기준정보 미등록')

    await createDirectAction(admin)
    const ab = admin.getByRole('region', { name: '근거 기준정보' })
    await ab.getByLabel('근거로 연결할 기준정보').selectOption({ label: '관찰·평가 결과 · 식사 · 평소 한 끼 2/3 공기 (기준일 미기재) · v1' })
    await ab.getByLabel('연결 메모').fill('식사량 기준 참고')
    await ab.getByRole('button', { name: '근거로 연결' }).click()
    const link = ab.getByTestId('action-baseline-link')
    await expect(link).toContainText('연결 당시 v1')
    await expect(link).toContainText('근거 문서: 급여제공계획서')
    await expect(admin.getByText(/근거 기준정보 연결 · .*기준정보 v1\(연결 당시 버전\)/)).toBeVisible()
    const actionUrl = admin.url()

    // 기준정보를 고쳐(v2) 확인해도 조치에는 판단 당시 v1이 남는다
    await admin.goto(RECIPIENT_URL)
    await s.getByTestId('baseline-entry').filter({ hasText: '평소 한 끼 2/3 공기' }).getByRole('button', { name: '고치기(새 버전)' }).click()
    const form = s.getByLabel('기준정보 입력')
    await form.getByLabel('기준 설명').fill('평소 한 끼 반 공기')
    await form.getByRole('button', { name: '저장하고 관리자 확인' }).click()
    const revised = s.getByTestId('baseline-entry').filter({ hasText: '평소 한 끼 반 공기' })
    await expect(revised).toContainText('v2')
    await expect(revised).toContainText('버전 2개 보존')
    await admin.goto(actionUrl)
    await expect(link).toContainText('연결 당시 v1')
    await expect(link).toContainText('평소 한 끼 2/3 공기')
    await expect(link).toContainText(/이후 v2로 수정·확인됨: 평소 한 끼 반 공기 — 이 조치의 판단 당시 값은 위\(v1\)입니다/)
  })

  test('출처가 다른 상충 값은 모두 남고 관리자가 현재 참고값을 고른다 · 정식 척도는 필수 항목 없이 저장되지 않는다', async ({ page }) => {
    test.setTimeout(120_000)
    await loginAdmin(page)
    await page.goto(RECIPIENT_URL)
    const s = section(page)
    await uploadDoc(page, pdf('낙상평가A'), { type: '낙상 위험 평가', date: '2026-08-01', source: '공단' })
    await expect(s.getByTestId('source-document')).toHaveCount(1)
    await uploadDoc(page, pdf('기타평가B'), { type: '기타 평가 자료', date: '2026-09-10', source: '병원' })
    await expect(s.getByTestId('source-document')).toHaveCount(2)
    await enterEntry(page, '낙상평가A', { domain: '낙상', statement: '낙상 위험 낮음' })
    await enterEntry(page, '기타평가B', { domain: '낙상', statement: '낙상 위험 높음' })

    const box = s.getByLabel('상충하는 기준값')
    await expect(box).toContainText('최신 업로드로 덮어쓰지 않고 모두 보존합니다')
    await expect(box).toContainText('현재 참고값 확인 필요')
    await expect(box).toContainText('낙상 위험 낮음')
    await expect(box).toContainText('낙상 위험 높음')
    await box.locator('li', { hasText: '낙상 위험 낮음' }).getByRole('button', { name: '이 값을 현재 참고값으로' }).click()
    await box.getByLabel('참고값 선택 이유').fill('공단 평가 기준으로 확인')
    await box.getByRole('button', { name: '참고값 선택 기록' }).click()
    await expect(box).toContainText('현재 참고값 선택됨')
    await expect(box.locator('li', { hasText: '낙상 위험 낮음' })).toContainText('현재 참고값')
    await expect(s.getByTestId('baseline-entry').filter({ hasText: '낙상 위험 높음' })).toContainText('관리자 확인') // 다른 값도 보존

    // 정식 척도: 버전·측정일 없이 저장 시도 → 거부(입력 유지), 채우면 저장
    await s.getByTestId('source-document').filter({ hasText: '낙상평가A.pdf' }).getByRole('button', { name: '이 문서로 기준정보 입력' }).click()
    const form = s.getByLabel('기준정보 입력')
    await form.getByRole('radio', { name: '정식 척도 결과' }).check()
    await form.getByLabel('세부 영역').selectOption({ label: '낙상' })
    await form.getByLabel('도구명').fill('Morse Fall Scale')
    await form.getByLabel('측정값').fill('45')
    await form.getByLabel('단위').fill('점')
    await form.getByRole('button', { name: '미확인 초안으로 저장' }).click()
    await expect(form.getByRole('alert')).toContainText('정식 척도는 도구명·버전·측정값·단위·측정일·출처가 모두 있을 때만')
    await expect(form.getByLabel('도구명')).toHaveValue('Morse Fall Scale')
    await form.getByLabel('도구 버전').fill('1989')
    await form.getByRole('button', { name: /문서 기준일\(2026-08-01\)을 측정일로 쓰기/ }).click()
    await form.getByRole('button', { name: '미확인 초안으로 저장' }).click()
    const scale = s.getByTestId('baseline-entry').filter({ hasText: 'Morse Fall Scale' })
    await expect(scale).toContainText('미확인 초안')
    await expect(scale).toContainText('45 점')
    await expect(scale).toContainText('측정일 2026-08-01')
    await expect(s.getByText('정식 척도 결과', { exact: true })).toBeVisible()
  })

  test('형식이 틀린 파일은 저장되지 않고 입력이 유지된다 · 문서 철회 뒤에도 원본과 기준정보는 남는다', async ({ page }) => {
    await loginAdmin(page)
    await page.goto(RECIPIENT_URL)
    const s = section(page)
    await s.getByRole('button', { name: '문서 올리기' }).click()
    await s.getByLabel('원본 파일').setInputFiles({ name: '가짜.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>not a pdf</html>') })
    await s.getByLabel('출처').fill('보호자 제공')
    await s.getByRole('button', { name: '올리기', exact: true }).click()
    await expect(s.getByRole('alert')).toContainText('지원하지 않는 파일 형식')
    await expect(s.getByLabel('출처')).toHaveValue('보호자 제공')
    await expect(s.getByTestId('source-document')).toHaveCount(0)
    await s.getByRole('button', { name: '닫기' }).click()

    await uploadDoc(page, pdf('잘못올린문서'))
    await enterEntry(page, '잘못올린문서', { domain: '수면', statement: '밤에 2회 깸' })
    const docRow = s.getByTestId('source-document')
    await docRow.getByRole('button', { name: '철회' }).click()
    await s.getByLabel('문서 철회 이유').fill('다른 수급자 문서를 잘못 올림')
    await s.getByRole('button', { name: '철회 기록' }).click()
    await expect(docRow).toContainText('철회됨')
    await expect(docRow).toContainText('다른 수급자 문서를 잘못 올림')
    await expect(docRow.getByRole('button', { name: '원본 보기' })).toBeVisible()
    await expect(docRow.getByRole('button', { name: '이 문서로 기준정보 입력' })).toHaveCount(0)
    await expect(s.getByTestId('baseline-entry').filter({ hasText: '밤에 2회 깸' })).toContainText('근거 문서 철회됨')
  })

  test('과거 항목 태그는 "항목별 근거 연결 전"으로 보이고 누르면 보고 전체가 열린다 · 확인된 기준정보가 있으면 평소 기준으로 이동', async ({ page }) => {
    await page.evaluate(() => {
      const key = 'ai365_care_demo_db_v1'
      const db = JSON.parse(localStorage.getItem(key) || '{}')
      const now = new Date().toISOString()
      db.reports = [
        ...(db.reports ?? []),
        {
          id: 'demo-legacy-tag-1', participant_code: 'C01', recipient_code: 'A01', report_type: 'daily', report_date: now.slice(0, 10), status: 'submitted', input_method: 'text',
          started_at: now, submitted_at: now, completion_seconds: 30, raw_input: '점심을 반 정도 드셨어요.', followup_questions: [], followup_answers: [],
          ai_generated_report: null, caregiver_final_report: { change: '식사량 감소', action: '', result: '', escalation: '', caregiverNote: '' },
          initial_status_choice: 'changed', no_change_initial_input: false, observed_domains_json: [], changed_domains_json: [{ domain: 'meal', status: 'changed' }], unobserved_domains_json: [], uncertain_domains_json: [],
          no_change_followup_count: 0, no_change_followup_answered: 0, initial_information_count: 0, final_information_count: 0, information_added_count: 0, no_information_report: false,
          report_source: 'live', scenario_id: null, emergency_flagged: false, ai_fallback_used: null, ai_fallback_stage: null,
          review_status: 'pending', review_note: null, review_note_visible_to_caregiver: false, reviewed_at: null, review_history: [], last_review_request_id: null,
          admin_first_viewed_at: null, admin_final_report: null, deleted: false, created_at: now, updated_at: now,
        },
      ]
      localStorage.setItem(key, JSON.stringify(db))
    })
    await loginAdmin(page)
    await page.goto(RECIPIENT_URL)
    await expect(page.getByTestId('item-evidence-note')).toContainText('항목별 근거 연결 전')
    await expect(page.getByRole('link', { name: '평소 기준' })).toHaveCount(0) // 기준정보 없으면 연결도 없음
    await enterEntry(page, null, { domain: '식사', statement: '평소 한 끼 2/3 공기' }) // 관리자 입력(문서 외)
    await expect(section(page).getByTestId('baseline-entry')).toContainText('관리자 입력 — 공식 평가 결과 아님')
    await expect(page.getByRole('link', { name: '평소 기준' })).toHaveAttribute('href', '#baseline-domain-meal')
    await page.getByRole('button', { name: '식사: 변화 보고' }).click()
    await expect(page).toHaveURL(/\/admin\/reports\/demo-legacy-tag-1\?demo=1/)
  })

  test('4단계 DB 적용 전(3단계까지) 상태에서는 기준정보가 "준비 중"이고, 기준정보 없이도 조치·현장 요청 게시는 그대로 된다', async ({ context, page: care }) => {
    test.setTimeout(120_000)
    await submitFieldReport(care)
    const admin = await context.newPage()
    await loginAdmin(admin)
    await admin.goto('/admin/org/gadream365/recipients/A01?demo=1&demo_workflow=stage3')
    await expect(section(admin)).toHaveCount(0)
    await expect(admin.getByText(/준비 중 — 기준정보 저장소\(4단계 DB 마이그레이션\)가 적용되기 전/)).toBeVisible()
    await admin.goto('/admin/work/reports?demo=1&demo_workflow=stage3')
    await admin.getByRole('button', { name: '보고 열기 · 승인/반려' }).click()
    const wf = admin.getByRole('region', { name: '관리자 업무' })
    await wf.getByRole('button', { name: '조치 만들기' }).click()
    await wf.getByPlaceholder('예: 식사량이 계속 줄었는지 확인').fill('식사량 재확인')
    await wf.getByPlaceholder('예: 다음 방문 때 식사량을 다시 확인해 주세요.').fill('다음 방문 때 식사량을 다시 확인해 주세요.')
    await wf.getByRole('button', { name: '진행 중으로 만들기' }).click()
    await wf.getByRole('button', { name: /식사량 재확인/ }).click()
    await expect(admin).toHaveURL(/demo_workflow=stage3/)
    await expect(admin.getByRole('region', { name: '근거 기준정보' })).toContainText('조치는 기준정보 없이도 그대로 진행됩니다')
    await admin.getByRole('button', { name: '현장에 게시' }).click()
    await admin.getByRole('button', { name: '게시 기록' }).click()
    await expect(admin.getByText('게시됨 · 응답 대기')).toBeVisible()
  })
})
