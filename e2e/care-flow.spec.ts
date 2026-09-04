import { test, expect } from '@playwright/test'
import { answerAllFollowups, loginCare, resetDemo, startReport, submitChangedReport } from './helpers'

test.describe('care-flow: /care?demo=1 골든 패스', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('로그인 → 수급자 선택 → 텍스트 입력 → 추가질문 → 최종보고 수정 → 제출 → 완료 화면', async ({ page }) => {
    await loginCare(page, 'C01', '1234')
    await startReport(page, 'A01', '오늘 돌봄보고 시작')

    await submitChangedReport(page, '오늘 어르신이 거실에서 일어나실 때 두 번 휘청거리셨어요.')

    // 최대 3회, 한 번에 하나씩 질문
    await expect(page.getByText(/추가 확인 1\/3/)).toBeVisible()
    await answerAllFollowups(page, [
      '오전 10시 20분경 거실에서요',
      '부축해서 의자에 앉혀드렸어요',
      '현재는 의식과 대화 상태 평소와 같고 넘어지거나 다친 곳은 없어요',
    ])

    await expect(page.getByText('보고 내용을 확인해 주세요')).toBeVisible()

    // 보고문 수정
    const changeField = page.locator('textarea').first()
    await changeField.fill('[검수] ' + (await changeField.inputValue()))

    await page.getByRole('button', { name: '이 내용으로 제출하기' }).click()
    await expect(page.getByText('센터에 보고되었습니다.')).toBeVisible()
  })

  test('음성 인식 미지원 기기에서도 텍스트만으로 끝까지 제출할 수 있다', async ({ page }) => {
    // Playwright의 기본 브라우저 컨텍스트는 SpeechRecognition을 제공하지 않으므로
    // 음성 버튼 없이도 텍스트 입력만으로 전체 흐름이 끊기지 않아야 한다.
    await loginCare(page)
    await startReport(page)
    await page.getByRole('button', { name: '잘 모르겠거나 확인이 필요해요' }).click()
    await page.getByPlaceholder(/음성 대신/).fill('식사량이 평소보다 적었습니다.')
    await page.getByRole('button', { name: '이 내용으로 보고하기' }).click()
    await answerAllFollowups(page, ['오늘 점심에요', '체중을 확인했어요', '지금은 안정적입니다'])
    await expect(page.getByText('보고 내용을 확인해 주세요')).toBeVisible()
  })
})
