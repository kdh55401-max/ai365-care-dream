/** 관리자 화면의 기관(센터) 범위. 서버(api/)와 브라우저(src/)가 같은 정의를 쓴다.
 *
 * 현재 이 배포(Supabase 프로젝트 하나)는 파일럿 기관 한 곳의 데이터만 담는다 —
 * db/schema.sql이 "파일럿 전용"이고 수급자·참여자 테이블에 기관 컬럼이 없다. 그래서
 * 이 배포의 모든 수급자는 DEPLOYMENT_ORGANIZATION 소속으로 본다. 두 번째 기관을 같은
 * 배포에 받으려면 먼저 DB에 기관 소속 컬럼을 추가하고, 기존 행의 소속을 사용자가
 * 확인한 뒤 채워야 한다(추정으로 몰아넣지 않는다) — 그 전에는 다른 기관 ID로 오는
 * 모든 요청을 서버가 거부한다. */
export interface Organization {
  id: string
  name: string
}

export const DEPLOYMENT_ORGANIZATION: Organization = {
  id: 'gadream365',
  name: '가드림365재가복지센터',
}

const KNOWN_ORGANIZATIONS: Organization[] = [DEPLOYMENT_ORGANIZATION]

export function findOrganization(id: string | null | undefined): Organization | null {
  if (!id) return null
  return KNOWN_ORGANIZATIONS.find((o) => o.id === id) ?? null
}

export type OrganizationAccess =
  | { ok: true; organization: Organization }
  | { ok: false; status: 403; reason: string }

/** 인증된 세션의 기관 ID(서버가 서명한 값)와, 요청이 가리키는 기관 ID(URL·쿼리 —
 * 클라이언트가 보낸 값)를 대조한다. 클라이언트 값은 "이 기관을 보려 한다"는 표시일
 * 뿐 권한 근거가 아니다 — 세션 기관과 다르면 거부한다. 요청 기관 ID가 없으면 세션
 * 기관으로 진행한다(단일 기관 사용자는 기관을 따로 고르지 않는다). */
export function checkOrganizationAccess(sessionOrganizationId: string, requestedOrganizationId: string | null | undefined): OrganizationAccess {
  const organization = findOrganization(sessionOrganizationId)
  if (!organization) return { ok: false, status: 403, reason: '이 계정에 연결된 기관을 확인할 수 없습니다.' }
  if (requestedOrganizationId && requestedOrganizationId !== organization.id) {
    return { ok: false, status: 403, reason: '이 기관의 기록에 접근할 권한이 없습니다.' }
  }
  return { ok: true, organization }
}
