import { expect, type Page } from '@playwright/test'

/** 데모 모드는 요구사항대로 브라우저(프로필)당 localStorage에만 저장되므로,
 * 각 테스트를 독립적으로 만들기 위해 시작할 때 항상 초기화한다. */
export async function resetDemo(page: Page) {
  await page.goto('/care?demo=1')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
}

/** 데모 로그인은 별칭(c1~c9) + 공용 비밀번호(6003)만 지원한다 — 참여자 코드
 * 그대로(C01 등)를 입력칸에 넣어도 데모 화면의 placeholder/문구는 항상 별칭
 * 기준("예: c1")이라 그에 맞춰 입력한다. */
export async function loginCare(page: Page, code = 'c7', pin = '6003') {
  await page.goto('/care?demo=1')
  await page.getByPlaceholder('예: c1').fill(code)
  await page.getByPlaceholder('숫자 4자리').fill(pin)
  await page.getByRole('button', { name: '로그인' }).click()
  // 별칭(c1 등)은 로그인 후 정규화된 실제 참여자 코드(C01 등)로 화면에 표시된다.
  const match = code.trim().match(/^c0?([1-9])$/i)
  const canonical = match ? `C0${match[1]}` : code.toUpperCase()
  await expect(page.getByText(canonical, { exact: true })).toBeVisible()
}

export async function loginAdmin(page: Page, password = 'demo1234') {
  await page.goto('/admin?demo=1')
  await page.getByPlaceholder('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByText('관리자 검증 화면')).toBeVisible()
}

/** 홈에서 "오늘 어르신 이야기하기"(기본) 또는 "추가 상태변화 보고"를 누른다.
 * 수급자는 CurrentRecipientCard가 배정된 것 중 하나를 자동으로 선택해 두므로
 * (드롭다운 없음) 별도로 고를 필요가 없다. */
export async function startReport(page: Page, kind: '오늘 어르신 이야기하기' | '추가 상태변화 보고' = '오늘 어르신 이야기하기') {
  await page.getByRole('button', { name: kind }).click()
  if (kind === '오늘 어르신 이야기하기') {
    await expect(page.getByPlaceholder(/음성 대신/)).toBeVisible()
  } else {
    await expect(page.getByText('오늘 방문은 어땠나요?')).toBeVisible()
  }
}

/** "평소와 다른 점이 있었어요" 선택 후 텍스트로 관찰내용을 입력해 제출한다.
 * (추가 상태변화 보고의 상황선택 화면에서만 쓰는 경로 — 기본 보고는 상황선택
 * 화면 없이 바로 record 화면으로 간다.) */
export async function submitChangedReport(page: Page, text: string) {
  await page.getByRole('button', { name: '평소와 다른 점이 있었어요' }).click()
  await page.getByPlaceholder(/음성 대신/).fill(text)
  await page.getByRole('button', { name: '이 내용으로 보고하기' }).click()
}

/** 후속 질문 화면에서 선택 버튼(옵션)으로만 답해 진행한다 — 이번 변경의 핵심인
 * "선택형 추가 질문"(타이핑 없이 버튼만으로 진행) 경로를 검증하기 위한 헬퍼.
 * 옵션 버튼에는 명시적으로 type="button"을 줬고, "잘 모르겠어요"/"다른 내용
 * 말하기"/"다음"/"여기까지 말씀드릴게요" 같은 보조 버튼에는 주지 않았으므로
 * `button[type="button"]` 선택자로 실제 답변 옵션만 정확히 골라낼 수 있다. */
export async function answerFollowupsWithOptions(page: Page, maxSteps = 3) {
  for (let i = 0; i < maxSteps; i++) {
    const onQuestionScreen = await page
      .getByText(/추가 확인 \d\/3/)
      .isVisible()
      .catch(() => false)
    if (!onQuestionScreen) break

    const allowsMultiple = await page.getByText('여러 개 선택 가능').isVisible().catch(() => false)
    const firstOption = page.locator('button[type="button"]').first()
    await expect(firstOption).toBeVisible()
    await firstOption.click()

    if (allowsMultiple) {
      await page.getByRole('button', { name: '다음', exact: true }).click()
    }
    // 단일 선택은 버튼을 누르면 바로 다음 단계로 진행한다(추가 클릭 불필요).

    if (await page.getByText('보고 내용을 확인해 주세요').isVisible().catch(() => false)) break
  }
}

/** 후속 질문(최대 3개)에 순서대로 답하고 최종 제출까지 진행한다. 질문 화면은
 * 기본으로 선택 버튼(옵션)을 먼저 보여주므로, 매번 "다른 내용 말하기"로 자유
 * 입력을 열어 주어진 답을 그대로 타이핑한다 — 옵션이 아예 없는 질문(자유 입력만
 * 제공)이면 이 토글 버튼 자체가 없어 곧바로 입력창을 채운다. */
export async function answerAllFollowups(page: Page, answers: string[]) {
  for (const answer of answers) {
    const onQuestionScreen = await page
      .getByText(/추가 확인 \d\/3/)
      .isVisible()
      .catch(() => false)
    if (!onQuestionScreen) break

    const freeTextToggle = page.getByRole('button', { name: '다른 내용 말하기' })
    if (await freeTextToggle.isVisible().catch(() => false)) {
      await freeTextToggle.click()
    }
    await page.getByPlaceholder('답변을 입력하거나 마이크로 말씀해 주세요.').fill(answer)
    await page.getByRole('button', { name: '다음', exact: true }).click()

    if (await page.getByText('보고 내용을 확인해 주세요').isVisible().catch(() => false)) break
  }
}
