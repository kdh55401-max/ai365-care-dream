# 돌봄 연속성 단계 구현 현황 ("말하면, 돌봄이 이어진다")

실행 기준: 사용자가 2026-09-15에 제공한 `AI365_Continuity_ClaudeCode_Plan_v2.md`(작성 2026-09-14, 저장소 밖
원본). 이전 단계별 프롬프트(자료 D)와 순서가 다르면 이 문서의 순서를 따른다 — 문서 자동화보다 관리자 조치와
다음 방문 연결을 먼저 만든다. 각 단계는 사용자 승인 후 하나씩 진행한다.

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 기관 → 수급자 목록 → 수급자 상세(보고 타임라인), 기관 첫 화면 검토 대기와 이유 | 구현·배포(아래 §2) |
| 2 | 관리자 판단·응답·조치·담당·기한·미완료 목록 | 승인 대기 |
| 3 | 인계 → 현장 응답 → 관리자 재확인·완료 | 미착수 |
| 4 | 원본 문서와 확인된 기준정보 | 미착수 |
| 5 | 근거 있는 변화 후보 → 기존 조치 연결 | 미착수 |
| 6 | 통합 업무 목록·기간별 흐름·연속성 지표·최종 검증 | 미착수 |

## 1. 1단계 착수 시 기존 구현 판정 (2026-09-15, 기준 origin/master 40e7c34)

판정: **동작** = 코드와 데모 e2e로 확인 / **불완전** = 있으나 이번 목적에 부족 / **없음** / **확인 불가** = 이 환경에서
볼 수 없음(운영 DB·자격증명 없음).

| 영역 | 판정 | 근거 |
|---|---|---|
| 관리자 로그인 | 동작 — 공유 비밀번호 1개, 개인 식별 없음 | `api/admin/login.ts`, `api/_lib/auth.ts` |
| 기관(센터) 개념 | 없음 → 1단계에서 세션 기관 범위 추가 | DB에 기관 테이블·컬럼 없음, 화면은 상수 `INSTITUTION_NAME` |
| 수급자 | 동작 — `recipients(code, active)`만 | `db/schema.sql` |
| 요양보호사↔수급자 배정 | 동작(보고 시작 시 서버가 배정 확인) / 배정 변경 이력은 없음(불완전) | `api/care/reports.ts` POST, `caregiver_assignments` |
| 말하기·글 입력·AI 추가질문·응급 안내·제출 | 동작(데모 e2e) / 실제 Gemini·운영 DB는 확인 불가 | `src/pilot/care/CareApp.tsx`, `api/care/*` |
| 원문 / AI 초안 / 요양보호사 확인본 / 관리자 검토본 분리 저장 | 동작 — 각각 별도 컬럼 | `raw_input`, `ai_generated_report`, `caregiver_final_report`, `admin_final_report` |
| 관리자 승인·반려(조건부 갱신·요청 ID 중복 방지·이력) | 동작 | `api/admin/reports.ts` `handleReviewStage` |
| 관리자 응답의 현장 공개 | 불완전 — 검토 메모/반려 사유를 요양보호사 "내가 남긴 돌봄기록"에 공개하는 것만 있음. 조치·담당·기한·인계 없음. `review_note_visible_to_caregiver` 마이그레이션의 운영 적용 여부는 확인 불가 | `db/migrations/2026-09-10-review-note-visibility.sql` |
| `manager_status`(확인완료/추가확인필요/전화함/종결) | 불완전 — 연구용 2단계 평가 폼의 한 필드. 담당·기한·이력·현장 연결 없음. 2단계에서 재사용 여부 판단 | `api/admin/reports.ts` stage `ai` |
| 관리자 조치·후속 확인·인계 | 없음 | 코드 검색 결과 없음 |
| 수급자별 목록·상세·타임라인 | 없음 → 1단계 구현 | |
| 항목별 관찰 상태(`*_domains_json`) | 불완전 — 컬럼과 표시 로직은 있으나 **현재 현장 흐름이 저장하지 않는다**(CareApp이 `observedDomains` 등을 PATCH하지 않음, 데모 저장소 매핑만 존재). 그래서 대부분 보고는 "항목별 상태 저장 없음"으로 보인다 | `src/pilot/care/CareApp.tsx`, `api/care/reports.ts` |
| 관찰 시각 | 없음 — `report_date`(KST 생성일)·`started_at`·`submitted_at`만 있음 | |
| 관리자 첫 열람 시각 | 동작(2026-09-12 운영 적용 기록) | `admin_first_viewed_at` |
| 감사 로그 | 동작 | `api/_lib/audit.ts` |
| 대시보드·연구 지표 | 동작 — 이번에 정의 변경 없음 | `shared/statsCalc.ts` |
| 데모·표준상황 연습 분리 | 동작 | `?demo=1`, `report_source='scenario'` |
| 운영 배포 | 동작 — Vercel GitHub 연동, master push → Production | GitHub deployments API: 40e7c34 Production success |
| 운영 DB 실제 스키마·데이터 | 확인 불가 — Supabase 자격증명 없음 | |

## 2. 1단계 구현 내용

PSST 대응: "매일 기록을 직접 대조해야 하는 부담" → 관리자가 **어떤 수급자의 무엇을 왜** 봐야 하는지 찾고,
그 수급자의 과거 보고를 한 흐름에서 본다. 새 AI·문서 처리·조치 기능은 넣지 않았다.

- **기관 범위(서버 권한)**: 관리자 세션 JWT에 기관 ID(`orgId`)를 담는다. 모든 관리자 데이터 API(reports·stats·
  export·participants·recipients)는 `requireAdminOrganization`으로 세션 기관을 확인하고, 요청의 `org` 쿼리가 세션
  기관과 다르면 403이다. 기관 클레임이 없는 기존 세션은 이 배포의 기관으로 읽는다(재로그인 강제 없음). 기관 정의:
  `shared/organization.ts` — 이 배포는 기관 한 곳(가드림365재가복지센터, `gadream365`)의 데이터만 담는다.
  다기관 가입·과금·최고관리자는 만들지 않았다.
- **수급자 허브 API**: `GET /api/admin/recipients?org=` (수급자 목록 + 검토 대기 목록),
  `GET /api/admin/recipients?org=&code=&period=7|30|all` (수급자 타임라인). 읽기 전용(감사 로그만 기록).
  표준상황 연습·삭제 보고 제외. 계산은 `shared/recipientHub.ts`(서버·데모 공통).
- **화면**: `/admin`(기관 첫 화면에 "검토할 보고와 이유" 목록 — 기존 숫자 타일·연구 지표 유지),
  `/admin/org/:org/recipients`(수급자 목록), `/admin/org/:org/recipients/:code`(상단 요약 + 기간 선택 + 보고
  타임라인), `/admin/reports/:id`(기존 보고 상세·승인/반려). 화면 상태를 주소에 담아 새로고침·직접 URL·뒤로가기가
  동작한다. `?demo=1`은 이동 시 유지된다.
- **타임라인 한 건**: 제출 시각·보고일·작성자(요양보호사 코드)·검토상태 → 확인할 이유(검토 대기일 때) → 항목별
  상태(저장된 값만) → ① 보고 원문(보고자 진술)과 추가 질문·답변 ② 구조화 기록(요양보호사 확인본, AI/규칙 초안은
  접어서) ③ 관리자 검토(상태·처리 시각·첫 열람·검토본·메모 공개 여부·이력 수) → "원본 보고 열기 · 승인/반려".
- **검토 대기 이유**(저장된 값만): 승인·반려 기록 없음 / 응급 표현 감지(규칙 기반) / 저장된 변화 보고 항목 /
  요양보호사 초기 선택(평소와 다름·확인 필요·평소와 비슷함) / 저장된 미관찰·불확실 항목 / 요양보호사 본인 지원
  요청(어르신 상태와 별개) / AI 대체 처리 / 관찰 정보 없는 보고. 정렬은 응급 표현 표시 → 제출 오래된 순이며
  위험도 점수가 아니다.
- **상태 표시 원칙**: 항목별 상태는 `평소와 같음/변화 보고/미관찰/불확실`만 저장값 그대로 보인다. 저장 안 된 항목은
  보이지 않고, 보고에 저장값이 없으면 "저장되지 않았습니다 — 정상·이상으로 해석하지 않습니다"라고 쓴다.
  **"미응답"은 항목별로 저장되는 값이 없어 표시하지 않는다**(질문하지 않은 항목을 미응답으로 세지 않음).
  보고 전체 상태(승인/반려)로 항목 상태를 대신하지 않는다.
- **DB 변경 없음**(마이그레이션 없음). 운영 DB에 적용할 것이 없다.

## 3. 2단계 전 확인 사항 (사용자 요청, 1단계 중 확인한 범위 — 코드 기준, 운영 DB 값은 확인 불가)

사용자가 2026-09-15에 `AI365_Dashboard_Integration_Stages2to6_v3.md`를 전달하며 1단계 보고에 아래 확인을 요청했다.
그 문서는 2단계부터 단계별로 적용하며, 1단계에서는 실행하지 않았다.

- **DomainStatus**(`shared/careTypes.ts`): `same_as_usual`, `changed`, `not_observed`, `uncertain`, `not_mentioned` 5개.
  "미응답" 값은 없다. **세부 영역 키**: `meal`, `hydration`, `mobility`, `fall`, `excretion`, `cognition_communication`,
  `emotion_behavior`, `pain_breathing`, `sleep`, `skin_hygiene`, `medication`, `other`, `not_checked` + 과거 기록 전용
  `meal_hydration`, `mobility_fall`. 저장 위치는 `reports`의 `observed_/changed_/unobserved_/uncertain_domains_json`
  4개 JSON 컬럼. 서버(`api/care/reports.ts`)는 받으면 저장하지만 현재 현장 화면은 이 값을 보내지 않는다(§1).
  분류는 원문 키워드 규칙(`shared/noChangeEngine.ts` `classifyDomainsFromText`)이며 요양보호사가 항목을 직접 고른 값이 아니다.
- **안전 신호**: `reports.emergency_flagged`(boolean) — 현장 발화의 정규식 감지(`shared/emergency.ts`, 임상 판정 아님).
  제출 전 초안에도 즉시 저장된다. 현장은 119/센터 전화 안내 화면으로 분기한다. 관리자 쪽은 🔴 배지와 "우선 확인
  필요(응급신호·미확인)" 숫자(= `emergency_flagged` 이면서 `review_status='pending'`, 브라우저에서 계산)로 보인다.
  **별도의 안전 검토 기록은 없다** — 지금은 보고 승인/반려가 끝나면 "미확인"에서 빠진다(보고 검토와 안전 검토가
  같은 필드). 1단계는 이 구조를 바꾸지 않고 검토 대기 목록의 정렬·이유 표시에만 썼다.
- **시각 저장**: `started_at`(시작), `submitted_at`(제출 시 1회 — 제출된 기록은 조건부 갱신으로 다시 제출되지 않음),
  `admin_first_viewed_at`(관리자 첫 열람 1회, 2026-09-12 운영 적용 기록), `reviewed_at`(승인/반려 시각 — **재검토하면
  덮어쓴다**, 이전 값은 `review_history[].at`에 남음). 따라서 "최초 검토 시각"은 이력이 있으면 `review_history[0].at`,
  없으면 `reviewed_at`로 재구성할 수 있을 뿐 불변 이벤트 기록은 없다. 관찰 시각 컬럼은 없다. 관리자 행위자 신원은 없다.
- **관리자 인증**: 공유 비밀번호 1개(`CARE_PILOT_ADMIN_PASSWORD_HASH` bcrypt) → 14일 httpOnly JWT 쿠키(`role:'admin'`,
  1단계부터 `orgId`). 개인 계정·역할 구분 없음. 검토 이력은 "공유 관리자 계정(개인 식별 불가)"으로만 표시한다.
- **운영 집계 위치**: (1) `/api/admin/stats` — 서버에서 `reports` 전체(`select('*')`, 최대 5000건)로 `shared/statsCalc.ts`
  연구 지표 계산. (2) 기관 첫 화면 숫자 타일(`PriorityCareStrip`)과 보고 목록의 3지표 — **브라우저에서** `/api/admin/reports`
  목록(최신 500건)으로 계산. (3) 1단계 검토 대기·수급자 요약 — 서버(`/api/admin/recipients`, 최대 5000건). 즉 같은 화면의
  타일(500건 기준)과 검토 대기 목록(5000건 기준)의 범위가 다르다 — 파일럿 규모에선 같지만 2단계에서 서버 집계로 통일 필요.

## 4. 다기관을 실제로 받기 전에 필요한 것 (이번 범위 아님)

1. `organizations` 테이블과 `recipients`/`participants`의 기관 소속 컬럼 추가(추가형 마이그레이션).
2. 기존 행의 소속은 사용자가 확인한 값으로만 채운다(추정으로 파일럿 기관에 몰아넣지 않음).
3. 기관별 관리자 계정(현재 공유 비밀번호 1개) — 로그인 시 `setAdminSessionCookie(res, orgId)`에 해당 기관을 넣는다.
4. `api/admin/recipients.ts`·`reports.ts` 등의 조회에 기관 소속 조건을 추가한다(지금은 배포 = 기관 한 곳).
