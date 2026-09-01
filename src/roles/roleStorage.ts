export type RoleId = 'team' | 'care' | 'community'

const LAST_ROLE_KEY = 'ai365_last_role'

/** 역할 선택 화면에서 "마지막으로 사용한 역할"을 강조 표시하는 용도로만 쓴다.
 * 저장된 값이 있어도 자동으로 다른 화면으로 이동시키지 않는다 — 역할 선택
 * 화면은 첫 방문이든 재방문이든 항상 먼저 보여준다. */
export function rememberRole(role: RoleId) {
  try {
    localStorage.setItem(LAST_ROLE_KEY, role)
  } catch {
    // 저장 공간을 사용할 수 없는 환경(프라이빗 모드 등)에서는 조용히 무시한다.
  }
}

export function readLastRole(): RoleId | null {
  try {
    const value = localStorage.getItem(LAST_ROLE_KEY)
    if (value === 'team' || value === 'care' || value === 'community') return value
    return null
  } catch {
    return null
  }
}
