import { test, expect } from '@playwright/test'
import { loginAdmin, loginCare, resetDemo } from './helpers'

/** CODEX_REVIEW.md §8 DEP-01 회귀 테스트: care의 "표준상황 연습"/"실제 현장보고로
 * 돌아가기", admin의 "피칭 화면"/"관리자 화면으로" 내부 링크가 query 없는 절대
 * 경로(`/care/scenario`, `/care`, `/admin/presentation`, `/admin`)로만 이동해
 * isDemoMode()가 false가 되고, 그 결과 일반(운영) 로그인 화면으로 바뀌던 문제.
 * 데모 로그인 상태를 유지한 채 오간 뒤에도 데모 화면이어야 한다. */
test.describe('demo-mode-persistence: 데모 내부 이동에서 demo=1 유지 (DEP-01)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page)
  })

  test('care: 표준상황 연습 왕복 및 새로고침에도 데모 모드 유지', async ({ page }) => {
    await loginCare(page, 'c1', '6003')

    await page.getByRole('link', { name: /표준상황 연습/ }).click()
    await expect(page.getByRole('heading', { name: '표준상황 연습' })).toBeVisible()
    // 운영 로그인 화면으로 빠졌다면 이 참여자 코드 입력칸(데모 전용 placeholder)이
    // 사라지고 대신 운영 로그인 폼이 보인다 — 데모 URL을 직접 확인해 모드 이탈을
    // 잡아낸다.
    await expect(page).toHaveURL(/\/care\/scenario\?demo=1/)
    await expect(page.getByPlaceholder('예: c1')).not.toBeVisible()

    await page.getByRole('link', { name: '실제 현장보고 화면으로 돌아가기' }).click()
    await expect(page).toHaveURL(/\/care\?demo=1/)
    await expect(page.getByText('C01', { exact: true })).toBeVisible()

    // 새로고침 후에도 여전히 로그인 상태 + 데모 모드여야 한다(로그아웃되지 않음).
    await page.reload()
    await expect(page.getByText('C01', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/demo=1/)
  })

  test('admin: 피칭 화면 왕복에도 데모 모드 유지, 실제 데이터 API 미호출', async ({ page }) => {
    const realApiCalls: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (/\/api\/(care|admin)\//.test(url) && !url.includes('demo')) realApiCalls.push(url)
    })

    await loginAdmin(page)
    await page.getByRole('link', { name: '피칭 화면' }).click()
    await expect(page).toHaveURL(/\/admin\/presentation\?demo=1/)
    await expect(page.getByText('AI365 CARE DREAM 초기 실증 성과')).toBeVisible()
    await expect(page.getByText('DEMO DATA')).toBeVisible()

    await page.getByRole('link', { name: '관리자 화면으로' }).click()
    await expect(page).toHaveURL(/\/admin\?demo=1/)
    await expect(page.getByText('관리자 검증 화면')).toBeVisible()

    // 데모 리포지토리(demoAdminRepo)는 실제 서버로 /api/care 또는 /api/admin
    // 요청을 보내지 않는다 — 데모 데이터/운영 데이터가 섞이지 않는다는 최소 확인.
    expect(realApiCalls).toEqual([])
  })

  // 홈페이지 → 역할 선택(RoleGateway) → 로그인 진입 흐름 자체의 데모 유지 확인.
  // AI365 — 홈페이지 역할 선택·로그인 경로 작업: RoleGateway.handleSelect가 현재
  // 쿼리스트링(?demo=1)을 이어 붙이지 않으면, 역할을 고르는 순간 운영 로그인
  // 화면으로 떨어진다.
  test('역할 선택(/?demo=1)에서 요양보호사를 고르면 /care?demo=1로 이동해 데모 로그인 화면이 보인다', async ({
    page,
  }) => {
    await page.goto('/?demo=1')
    await expect(page.getByRole('heading', { name: '어떤 업무를 시작할까요?' })).toBeVisible()

    await page.getByRole('button', { name: /요양보호사/ }).click()
    await expect(page).toHaveURL(/\/care\?demo=1/)
    // 운영 로그인 화면이었다면 데모 전용 placeholder(별칭 c1~c9)가 없다.
    await expect(page.getByPlaceholder('예: c1')).toBeVisible()
  })

  test('역할 선택(/?demo=1)에서 관리자를 고르면 /admin?demo=1로 이동해 데모 로그인 화면이 보인다', async ({
    page,
  }) => {
    await page.goto('/?demo=1')
    await page.getByRole('button', { name: /관리자/ }).click()
    await expect(page).toHaveURL(/\/admin\?demo=1/)
    await expect(page.getByPlaceholder('비밀번호')).toBeVisible()
  })

  // /support: 생활지원사 공개 진입 별칭. 기존 /community와 같은 화면(App.tsx,
  // '현장 대응 도우미')을 그대로 보여줘야 한다 — 새 로그인/데이터 계층을 만들지
  // 않는다는 요청 범위를 지킨다.
  test('/support는 /community와 같은 생활지원사 화면(현장 대응 도우미)을 보여준다', async ({ page }) => {
    await page.goto('/support')
    await expect(page.getByText('현장 대응 도우미')).toBeVisible()
    await expect(page.getByText('COMMUNITY')).toBeVisible()
  })
})
