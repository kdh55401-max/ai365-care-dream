import { test, expect } from '@playwright/test'
import { answerFollowupsWithOptions, completeDailyReport, loginAdmin, loginCare, openResearchKpiDetails, resetDemo, startReport } from './helpers'

test.describe('특이사항 없음 대응 흐름 · 표준상황 연습 분리 집계', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('정상 상태 구체화: "특이사항 없어요" 입력 → 평소와 같은 항목 질문 → 미확인 항목 질문 → 정상/미확인이 구분된 보고 생성', async ({ page }) => {
    await loginCare(page)
    await startReport(page)
    // 기본 돌봄보고는 상황선택 화면 없이 곧바로 자유 입력(record) 화면으로 가므로
    // "직접 말하기"를 따로 누를 필요가 없다 — 특이사항 없음 표현은 자유 입력에서도
    // 자동으로 이 흐름에 연결된다.
    await page.getByPlaceholder(/음성 대신/).fill('오늘은 특별히 달라진 점이 없었어요')
    await page.getByRole('button', { name: '이 내용으로 보고하기' }).click()

    await expect(page.getByText('평소와 비슷했어요 · 추가 확인 1/2')).toBeVisible()
    await page.getByPlaceholder(/없어요/).fill('식사는 평소와 같고 이동도 평소와 같아요')
    await page.getByRole('button', { name: '다음' }).click()

    await expect(page.getByText('평소와 비슷했어요 · 추가 확인 2/2')).toBeVisible()
    await page.getByPlaceholder(/없어요/).fill('배설은 확인하지 못했어요')
    await page.getByRole('button', { name: '다음' }).click()

    await expect(page.getByText('보고 내용을 확인해 주세요')).toBeVisible()
    const change = await page.locator('textarea').first().inputValue()
    expect(change).toContain('평소와 유사한 것으로 관찰됨')
    expect(change).toContain('확인하지 못함')

    await page.getByRole('button', { name: '이대로 센터에 보내기' }).click()
    await expect(page.getByText('센터에 보고되었습니다.')).toBeVisible()

    // 관리자 대시보드의 "무정보 보고 구체화율"에 반영된다.
    const admin = await page.context().newPage()
    await loginAdmin(admin)
    await openResearchKpiDetails(admin)
    await expect(admin.getByText('무정보 보고 구체화율')).toBeVisible()
  })

  test('계속 짧게 "없음"이라고만 답해도 질문은 2회를 넘지 않고, 무정보 보고로 분류된다', async ({ page }) => {
    // 이 테스트는 이제 선행 조건으로 기본 돌봄보고 하나를 통째로 완료한 뒤(추가
    // 상태변화 기록하기 진입 조건) 특이사항없음 흐름을 한 번 더 거치므로, 기본
    // 30초 제한보다 여유를 둔다.
    test.setTimeout(60_000)
    await loginCare(page)
    // "평소와 비슷했어요" 선택 버튼은 추가 상태변화 기록하기의 상황선택 화면에만
    // 있고, 그 진입점은 오늘 기본 돌봄보고를 먼저 제출해야 홈 화면에 나타난다.
    await completeDailyReport(page)
    await startReport(page, '추가 상태변화 기록하기')
    await page.getByRole('button', { name: '평소와 비슷했어요' }).click()

    await expect(page.getByText('추가 확인 1/2')).toBeVisible()
    await page.getByPlaceholder(/없어요/).fill('없어요')
    await page.getByRole('button', { name: '다음' }).click()

    await expect(page.getByText('추가 확인 2/2')).toBeVisible()
    await page.getByPlaceholder(/없어요/).fill('없어요')
    await page.getByRole('button', { name: '다음' }).click()

    await expect(page.getByText('보고 내용을 확인해 주세요')).toBeVisible()
    const change = await page.locator('textarea').first().inputValue()
    expect(change).toBe('금일 요양보호사가 별도 상태변화를 보고하지 않음. 구체적으로 확인된 관찰영역은 없음.')

    await page.getByRole('button', { name: '이대로 센터에 보내기' }).click()
    await expect(page.getByText('센터에 보고되었습니다.')).toBeVisible()

    const admin = await page.context().newPage()
    await loginAdmin(admin)
    await admin.getByRole('button', { name: '보고 목록' }).click()
    await expect(admin.getByText('무정보', { exact: true })).toBeVisible()
  })

  test('표준상황 연습(/care/scenario)은 실제 현장보고 통계에 합산되지 않는다', async ({ page }) => {
    await loginCare(page)
    // 이 화면도 CurrentRecipientCard로 배정된 수급자를 자동 선택한다(기본
    // 로그인 c7은 A09 한 명만 배정돼 있어 별도 선택 UI 자체가 없다) — 예전
    // 전체 수급자 드롭다운은 더 이상 존재하지 않는다.
    await page.goto('/care/scenario?demo=1')
    await expect(page.getByText('지금까지 0/2건 완료')).toBeVisible()
    await page.getByText('상황 1 · 식사량 감소와 휘청거림').click()
    await expect(page.locator('textarea')).toHaveValue(/점심을 평소의 절반/)
    await page.getByRole('button', { name: '이 내용으로 보고하기' }).click()

    // 후속질문은 선택형 버튼으로 온다(자유 텍스트 placeholder가 아니다).
    await answerFollowupsWithOptions(page)
    await expect(page.getByText('보고 내용을 확인해 주세요')).toBeVisible()

    await page.getByRole('button', { name: '이대로 센터에 보내기' }).click()
    await expect(page.getByText('표준상황 연습이 저장되었습니다.')).toBeVisible()

    const admin = await page.context().newPage()
    await loginAdmin(admin)
    await openResearchKpiDetails(admin)
    await expect(admin.getByText(/표준상황 검증 \(실제 현장보고와 별도 집계 · 1\/18건\)/)).toBeVisible()
    // 실제 현장보고 누적 건수(0/90)에는 표준상황이 포함되지 않는다.
    await expect(admin.getByText('0 / 90건')).toBeVisible()
  })
})
