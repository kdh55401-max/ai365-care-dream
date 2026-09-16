import { test, expect, type Page } from '@playwright/test'
import { loginAdmin, resetDemo } from './helpers'

/** 5단계(관찰 달력 7·30일, 날짜별 원문 근거, 반복 보고 후보 v1, 후보 판단 → 기존 조치 → 현장 요청) — 데모 모드(localStorage).
 * 항목별 상태는 현재 현장 흐름이 저장하지 않으므로, 저장된 항목이 있는 보고를 데모 저장소에 직접 넣어 검증한다. */

const RECIPIENT_URL = '/admin/org/gadream365/recipients/A01?demo=1'
const kst = (offset: number) => new Date(Date.now() + 9 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10)

type Entry = { domain: string; status: string }
async function seed(page: Page, reports: Array<{ id: string; day: number; raw: string; changed?: Entry[]; observed?: Entry[]; unobserved?: Entry[]; participant?: string; choice?: string | null }>) {
  await page.evaluate(
    ({ list, days }) => {
      const key = 'ai365_care_demo_db_v1'
      const db = JSON.parse(localStorage.getItem(key) || '{}')
      db.reports = [
        ...(db.reports ?? []),
        ...list.map((r, i) => {
          const date = days[i]
          const at = `${date}T0${2 + (i % 5)}:00:00.000Z`
          return {
            id: r.id, participant_code: r.participant ?? 'C01', recipient_code: 'A01', report_type: 'additional', report_date: date, status: 'submitted', input_method: 'text',
            started_at: at, submitted_at: at, completion_seconds: 30, raw_input: r.raw, followup_questions: [], followup_answers: [], ai_generated_report: null,
            caregiver_final_report: { change: r.raw, action: '', result: '', escalation: '', caregiverNote: '' }, initial_status_choice: r.choice ?? 'changed', no_change_initial_input: false,
            observed_domains_json: r.observed ?? [], changed_domains_json: r.changed ?? [], unobserved_domains_json: r.unobserved ?? [], uncertain_domains_json: [],
            no_change_followup_count: 0, no_change_followup_answered: 0, initial_information_count: 0, final_information_count: 0, information_added_count: 0, no_information_report: false,
            report_source: 'live', scenario_id: null, emergency_flagged: false, ai_fallback_used: null, ai_fallback_stage: null, review_status: 'pending', review_note: null,
            review_note_visible_to_caregiver: false, reviewed_at: null, review_history: [], last_review_request_id: null, admin_first_viewed_at: null, admin_final_report: null,
            deleted: false, created_at: at, updated_at: at,
          }
        }),
      ]
      localStorage.setItem(key, JSON.stringify(db))
    },
    { list: reports, days: reports.map((r) => kst(r.day)) },
  )
}

const MEAL_CHANGED = { domain: 'meal', status: 'changed' }
const STANDARD = [
  { id: 'obs-1', day: 0, raw: '오늘 점심을 반만 드셨어요.', changed: [MEAL_CHANGED] },
  { id: 'obs-2', day: 0, raw: '저녁도 조금 드셨어요.', changed: [MEAL_CHANGED] },
  { id: 'obs-3', day: 0, raw: '간식은 평소처럼 드셨어요.', observed: [{ domain: 'meal', status: 'same_as_usual' }], participant: 'C03', choice: 'similar' },
  { id: 'obs-4', day: -2, raw: '아침을 거의 안 드셨어요.', changed: [MEAL_CHANGED] },
  { id: 'obs-5', day: -3, raw: '산책을 함께 했어요.', choice: null },
  { id: 'obs-6', day: -4, raw: '물은 못 봤어요.', unobserved: [{ domain: 'hydration', status: 'not_observed' }] },
]

function calendar(page: Page) {
  return page.getByTestId('observation-calendar')
}

test.describe('observation-calendar: 관찰 달력 · 반복 보고 후보', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('7일 달력은 보고일 기준으로 상태·보고 없음·저장 없음·미언급·상충을 구분하고, 칸을 누르면 그날 원문·보고자·시각이 보인다', async ({ page }) => {
    await seed(page, STANDARD)
    await loginAdmin(page)
    await page.goto(RECIPIENT_URL)
    const section = page.getByRole('region', { name: '관찰 달력' })
    await expect(section).toContainText('보고일(한국 시간) 기준')
    await expect(section).toContainText('보고 6건(항목별 상태 저장 5건 · 저장 없음 1건)')
    const cal = calendar(page)
    await expect(cal.getByRole('button', { name: new RegExp(`^${kst(0)} 여러 기록·상충 · 기록 3건`) })).toBeVisible() // 식사: 같은 날 3건 · 상충
    await expect(cal.getByRole('button', { name: `${kst(-2)} 변화` }).first()).toBeVisible()
    await expect(cal.getByRole('button', { name: `${kst(-3)} 항목 저장 없음` }).first()).toBeVisible()
    await expect(cal.getByRole('button', { name: `${kst(-4)} 미관찰` })).toBeVisible() // 수분
    await expect(cal.getByRole('button', { name: `${kst(-4)} 미언급` }).first()).toBeVisible() // 같은 날 다른 항목
    await expect(cal.getByRole('button', { name: `${kst(-1)} 보고 없음` }).first()).toBeDisabled()
    await expect(cal.getByText('수분', { exact: true })).toBeVisible() // 세부 키 유지(식사·수분 분리)
    await expect(cal.getByText('식사·수분(세분화 이전 기록)')).toHaveCount(0)

    await cal.getByRole('button', { name: new RegExp(`^${kst(0)} 여러 기록·상충 · 기록 3건`) }).click()
    const detail = page.getByRole('region', { name: '선택한 날의 원문 근거' })
    await expect(detail).toContainText(`${kst(0)} 보고 3건 · 식사`)
    await expect(detail).toContainText('변화 보고(C01)')
    await expect(detail).toContainText('평소와 같음(C03)')
    await expect(detail).toContainText('원문: 오늘 점심을 반만 드셨어요.')
    await expect(detail).toContainText('요양보호사 C03')
    await detail.getByRole('button', { name: '보고 전체 열기' }).first().click()
    await expect(page).toHaveURL(/\/admin\/reports\/obs-1\?demo=1/)

    await page.goto(RECIPIENT_URL)
    await page.getByRole('group', { name: '달력 기간' }).getByRole('button', { name: '30일' }).click()
    await expect(calendar(page).locator('thead th')).toHaveCount(31) // 세부 영역 + 30일
    await expect(page.getByRole('region', { name: '관찰 달력' }).locator('svg, canvas')).toHaveCount(0) // 점수 그래프로 바꾸지 않음
  })

  test('반복 보고 후보는 "식사 변화가 2일 보고됨"(같은 날 여러 건은 하루)이고, 판단을 기존 조치에 연결하면 조치에서 되짚고 현장 요청까지 이어진다', async ({ page }) => {
    test.setTimeout(120_000)
    await seed(page, STANDARD)
    await loginAdmin(page)
    await page.goto(RECIPIENT_URL)
    const repeat = page.getByRole('region', { name: '관찰 달력' }).getByLabel('반복 보고 후보')
    await expect(repeat).toContainText('관찰일 기준: 관찰일이 기록된 보고가 없어 계산 대상 0건 · 제외 3건')
    const cand = repeat.getByTestId('repeat-candidate')
    await expect(cand).toHaveCount(1)
    await expect(cand).toContainText('식사 변화가 2일 보고됨')
    await expect(cand).toContainText('같은 증상이 계속됐거나 나빠졌다는 뜻이 아닙니다')
    await expect(cand).toContainText('관리자 판단 없음')
    await expect(cand).toContainText('이 수급자의 열린 조치 없음')

    // 근거 보고에서 기존 흐름대로 현장 확인 요청 조치를 만든다
    await cand.getByRole('button', { name: '최근 근거 보고에서 판단·조치' }).click()
    const wf = page.getByRole('region', { name: '관리자 업무' })
    await wf.getByRole('button', { name: '조치 만들기' }).click()
    await wf.getByPlaceholder('예: 식사량이 계속 줄었는지 확인').fill('식사량 재확인')
    await wf.getByPlaceholder('예: 다음 방문 때 식사량을 다시 확인해 주세요.').fill('다음 방문 때 식사량을 다시 확인해 주세요.')
    await wf.getByRole('button', { name: '진행 중으로 만들기' }).click()
    await expect(wf.getByText('이 보고에서 시작한 조치 (1건)')).toBeVisible()

    await page.goto(RECIPIENT_URL)
    await expect(cand).toContainText('이 수급자의 열린 조치 1건(새 조치 전에 확인)')
    await cand.getByRole('button', { name: '후보 판단 남기기' }).click()
    await cand.getByRole('radio', { name: '추가 확인 필요' }).check()
    await cand.getByLabel('판단 근거').fill('이틀 연속 식사 감소 보고 — 다음 방문 확인 요청에 연결')
    await cand.getByLabel('연결할 조치').selectOption({ label: '식사량 재확인 (진행 중)' })
    await cand.getByRole('button', { name: '판단 기록' }).click()
    await expect(cand).toContainText('관리자 판단: 추가 확인 필요')
    await expect(cand).toContainText('조치 연결됨')

    await cand.getByRole('button', { name: '식사량 재확인' }).click()
    const linked = page.getByRole('region', { name: '연결된 변화 후보 판단' })
    await expect(linked).toContainText('식사 변화 반복 보고(보고일 기준)')
    await expect(linked).toContainText('추가 확인 필요')
    await page.getByRole('button', { name: '현장에 게시' }).click()
    await page.getByRole('button', { name: '게시 기록' }).click()
    await expect(page.getByText('게시됨 · 응답 대기')).toBeVisible()

    // 기관 첫 화면 카드와 전체 목록
    await page.getByRole('button', { name: '오늘의 돌봄' }).click()
    const card = page.getByRole('button', { name: /^반복 보고 후보/ })
    await expect(card).toContainText('1건')
    await expect(card).toContainText('판단 전 0건')
    await card.click()
    await expect(page).toHaveURL(/\/admin\/work\/repeat\?demo=1/)
    await expect(page.getByText('관리자 판단: 추가 확인 필요')).toBeVisible()
  })

  test('근거 보고가 반려되면 판단을 덮어쓰지 않고 재검토 필요로 보이며, 판단 뒤 새 보고는 따로 알린다', async ({ page }) => {
    await seed(page, STANDARD)
    await loginAdmin(page)
    await page.goto(RECIPIENT_URL)
    const cand = page.getByTestId('repeat-candidate')
    await cand.getByRole('button', { name: '후보 판단 남기기' }).click()
    await cand.getByRole('radio', { name: '평소 범위' }).check()
    await cand.getByLabel('판단 근거').fill('보호자 통화 — 평소와 비슷')
    await cand.getByRole('button', { name: '판단 기록' }).click()
    await expect(cand).toContainText('관리자 판단: 평소 범위')

    await seed(page, [{ id: 'obs-7', day: -1, raw: '어제도 반만 드셨어요.', changed: [MEAL_CHANGED] }])
    await page.reload()
    await expect(cand).toContainText('식사 변화가 3일 보고됨')
    await expect(cand).toContainText('판단 뒤 새 근거 보고 1건')
    await expect(cand).toContainText('관리자 판단: 평소 범위') // 자동으로 바꾸지 않음

    await page.evaluate(() => {
      const key = 'ai365_care_demo_db_v1'
      const db = JSON.parse(localStorage.getItem(key) || '{}')
      db.reports = db.reports.map((r: { id: string }) => (r.id === 'obs-4' ? { ...r, review_status: 'rejected', review_note: '다른 수급자 기록' } : r))
      localStorage.setItem(key, JSON.stringify(db))
    })
    await page.reload()
    await expect(cand).toContainText('재검토 필요: 판단 당시 근거 보고가 반려됨')
    await expect(page.getByRole('region', { name: '관찰 달력' }).getByLabel('반복 보고 후보')).toContainText('반려된 보고라 제외 1건')
  })

  test('5단계 DB 적용 전(4단계까지)에도 달력·후보는 보이고 후보 판단 저장만 "준비 중"이다', async ({ page }) => {
    await seed(page, STANDARD)
    await loginAdmin(page)
    await page.goto('/admin/org/gadream365/recipients/A01?demo=1&demo_workflow=stage4')
    await expect(page.getByTestId('repeat-candidate')).toContainText('식사 변화가 2일 보고됨')
    await expect(page.getByText('후보 판단 저장: 준비 중(5단계 DB 적용 전)')).toBeVisible()
    await expect(page.getByRole('button', { name: '후보 판단 남기기' })).toHaveCount(0)
  })
})
