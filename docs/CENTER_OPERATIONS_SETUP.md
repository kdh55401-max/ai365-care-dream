## 관리기록 달력·검색 검증

저장된 관리기록의 연도·월·내용/최근저장자 검색 및 날짜별 집계는 클라이언트 조회이며 추가 SQL이 필요하지 않다. 조회 건수는 서비스 수행이나 평가 완료를 뜻하지 않는다.

격리 UI 검증은 먼저 `npm run build` 후 PowerShell에서 `$env:PW_BUNDLED='1'`, `$env:PW_BASE_URL='http://localhost'`를 설정하여 `npx playwright test e2e/center-patient-memo-calendar.spec.ts e2e/center-patient-memos.spec.ts --workers=1`로 실행한다. 이 fixture는 로컬 dist 파일을 요청에 직접 응답하므로 실제 HTTP/API·운영 인증 연결 시험과 구분한다. 환경변수를 해제하면 기존 live server 검증 경로다. 인수인계 소스 ZIP에는 dist와 브라우저 바이너리를 포함하지 않는다.

## 수급자 관리기록

operations 이후 2026-10-23-center-patient-memos.sql 검토 적용. 날짜별 복수 메모, 서버 최근저장자, soft archive. 운영 미적용.

## 본인부담률 이력

operations 이후 2026-10-23-center-patient-rates.sql 검토 적용. dated history only; 기본정보·청구 변경 없음. 운영 미적용.

## 2026-10-23 수급자 등급·인정이력

2026-10-23-center-patient-recognitions.sql은 operations 이후 검토 적용한다. 운영 적용은 실행하지 않았다. 저장과 기본정보 적용은 별도이며 apply는 category만 갱신하고 계약기간/다른 인물필드를 보존한다. 인정번호·확장·기간은 이력에 저장한다. 공단 번호/등급 검증·인정서 첨부·자동 기간 산정·청구 적용이 아니다. 기존 백업·적용 이력을 확인하고 무조건 재실행/자료 초기화를 하지 않는다. 360px 흐름은 확인했으나390px 로컬 연결 검증은 미완료다.

## 2026-10-23 수급자 계약이력

2026-10-23-center-patient-contracts.sql은 operations 이후 검토 적용한다. 운영 적용은 실행하지 않았다. 기존 적용·백업 이력 확인 후 적용하고 무조건 재실행/기록 초기화를 하지 않는다. 새 API는 기관 관리자와 수급자 참조·이력/인물 버전·영수증을 검사한다. 이력 저장과 기본정보 적용은 별도이며 적용은 계약일(start)·만료일(end)만 변경한다. 계약기간 시작/급여구분은 이력에 보존한다. 공단 등록·서명·정산 적용이 아니다. 기존 기본정보를 직접 바꾸면 마지막 적용 이력과 달라질 수 있어 재조회/불일치 안내를 따른다.

## 2026-10-23 월 일정 검토 잠금 추가

2026-10-23-center-month-schedule.sql을 operations 이후 검토 적용한다. 전체 앱의 provider/assignment/weekly-plan/application 순서와 기존 적용·백업 이력을 확인한다. 운영 적용은 실행하지 않았다. 이 잠금은 내부 편집 보호이며 공단 금액·RFID·확정·청구를 완료로 처리하지 않는다. 실제 일정 변경 RPC 및 계획 일괄 반영이 공통 트리거에 의해 차단되며 해제는 별도 사용자 확인과 예상 버전·일정 목록 대조가 필요하다. 무조건 재실행·자료 초기화·기존 장부 삭제로 복구하지 않는다.

## 2026-10-23 월 계획 반영

2026-10-23-center-plan-application.sql은 operations, visit-providers, weekly-plans 뒤에 검토 적용한다. 운영 적용은 아직 실행하지 않았다. 기존 백업·적용 이력을 확인하고 무조건 재실행하지 않는다. 출처/반영 영수증을 추가하며 기존 일정·돌봄기록을 초기화하지 않는다. 전체 반영 RPC는 동일 기관 잠금과 한 트랜잭션으로 신규 계획 일정을 생성한다. 원본 계획의 변경은 이미 반영한 일정을 자동 덮어쓰지 않으며 일정확정·공단 전송과 별개다. 기존 수동 일정 저장 경로의 전역 충돌 검사와 두 세션 실제 운영 검증은 남는다.

## 2026-10-22 주간계획 추가 배포 전제

`2026-10-22-center-weekly-plans.sql`은 operations 이후 적용한다. 기존 provider/assignment 추가 SQL도 현재 앱의 선행 변경이다. 이 파일은 아직 운영에 적용하지 않았다. 기존 적용 이력과 백업을 확인하고 검토 후 적용하며 무조건 재실행하지 않는다. 새 `weekly-plans` API는 저장소 부재 시 오류를 반환한다. 계획 저장과 월 예상 내역 조회는 실제 방문일정·확정·청구와 분리된다. 요일 겹침 검사는 선택 수급자·선택 계획·같은 서비스·공통요일에 한정하며 기관 전체 직원 가용성 검사로 해석하지 않는다.

## 2026-10-22 최신: 수급자 담당 배정 연결

center-assignments.sql은 operations 이후 적용한다. providers/imports/patient-documents와 독립이다. 기존 caregiver_assignments·회원계정을 바꾸지 않는다. 실제 운영에는 아직 적용하지 않았다. 새 assignments API는 기관을 세션에서 결정하고 미승인/다른 역할/교차 출처 쓰기를 거절한다. 마이그레이션이 없거나 조회 실패면503이며 미배정0명으로 바꾸지 않는다.

수급자관리 → 이름 → 담당: 체크 선택/해제 시 저장, 담당 명수/버전 재조회, 실패 시 선택 유지와 같은 요청 재시도, 새로 조회하면 저장값으로 초기화. 원본의 체크 변경 저장을 참고했으며 친족요양사 관계/유효기간은 별도 후속 기능이다. 담당 배정은 일정별 실제 제공자·공단 전송·회원 로그인 권한과 별개다.

배정 직원으로 방문일정 추가는 해당 수급자와 첫 담당자를 기본 선택한다. 서비스별 실제 제공자는 일정 폼에서 별도로 선택한다. 담당 변경이 기존 방문일정 담당자를 자동으로 바꾸지는 않는다. 직원/수급자 보관은 비어 있지 않은 배정이 있으면 차단하며, 배정 해제 후에도 기존 일정 참조가 있으면 그 일정의 보관이 먼저 필요하다.

데모는 별도 브라우저 키 gadream365:center-assignments:demo:v1를 사용한다. 기관 API 오류를 데모 성공으로 우회하지 않는다. 설치한 테스트 브라우저와 SQL 임시 파일은 .gitignore의 /test-temp/로 소스에서 제외한다.

## 2026-10-22 최신: 방문일정 복수 제공자 배포 순서

기본 업무 재구현을 먼저 진행한다. 새 db/migrations/2026-10-22-center-visit-providers.sql은 operations 이후 적용한다(imports/patient-documents와는 독립). 기존 함수/RLS/요청 이력을 교체하거나 과거 행을 일괄 갱신하지 않는다. 운영에는 아직 적용하지 않았다.

반드시 **DB 마이그레이션 성공 → 새 앱 배포** 순서다. 앱은 upsertVisit 전 center_visit_provider_support()=1을 확인하고 없거나 실패하면503으로 실제 저장을 호출하지 않는다. API에만 배포하고 기존 RPC가 보조 제공자를 검증한다고 가정하지 않는다. 모의/격리 검사는 운영 마이그레이션 실행이 아니다.

목욕/방문목욕은 서로 다른 활성 직원2명, 요양/간호 및 기존 기타 서비스는1명이다. workerId는 대표 제공자이고 workerIds는 전체 제공자 순서다. 기존 workerIds 없는 1인 목욕 기록은 조회·보관 가능, 새 수정 저장 시2명 필요. 연결된 보조 직원도 일정 보관 전에는 보관 불가다. 기존 영수증 재전송은 과거 응답을 유지한다.

로컬 브라우저 검증 준비: `$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) 'test-temp/pw-browsers'`; 해당 경로에 `playwright install chromium --only-shell` 설치를 완료했다. 같은 환경변수를 설정하고 center-visits.spec.ts를 실행한다. 개인 PC의 전역 브라우저 설치를 가정하지 않는다. 설치 바이너리는 소스/워크스페이스 ZIP에서 제외한다.

원본 주간 방문계획의 같은 서비스·요일 중복검사에는 D 예외와2시간 간격 경고가 있어, 이를 월 달력 전체 차단 규칙으로 일반화하지 않는다. 주간 급여계획·담당 배정·월별 공단 비교/확정/취소는 아직 후속 구현이다. 실제 서명·공단 등록·청구 확정을 대신하지 않는다.

### 마지막 확인의 정정 · 2026-10-22

로컬 서버 Vite 시작 로그는 확인했지만 이번 턴 IAB·Edge 접속과 HTTP 확인은 시간 초과됐다. 따라서 http://127.0.0.1:5191/center 는 소스의 로그인 경로이며, 지금 사용자에게 보이는 최신 화면 링크로 검증된 상태가 아니다. 기존 운영 사이트는 이번 변경이 반영되지 않았다. 배포 서버 환경은 기존 Vercel 계정 로그인 전까지 미확인이다. GitHub 커넥터 권한은 별도이며 Vercel 로그인에 자동 적용되지 않았다. 비밀 값은 출력·저장하지 않았다.

전체387개 검사 통과 뒤 세션 교체 시 진행 중 저장의 상태 경합을 추가 수정했다. 추가 회귀와 관련 검사 결과는 최종 보고를 따른다. 기존 전체 검사를 이후 변경의 재실행으로 오해하지 않는다.

# 센터 업무 저장·AI 자료 입력 운영 연결

2026-10-22. 운영 적용 전 검토용이며 아직 배포하지 않았다.

## 기존 계정부터 확인

기존 저장소 kdh55401-max/ai365-care-dream에 GitHub 연결 계정의 관리자·쓰기 권한이 확인됐다. 로컬 Vercel 연결 파일과 CLI 인증, 실제 .env 파일은 없다. Edge에서 Vercel의 GitHub 로그인 입력 화면까지 확인했다. 가장 작은 필요한 사용자 조치는 기존 Vercel 계정 로그인이다. 로그인 후 기존 프로젝트의 환경변수 이름·Production/Preview 적용 범위를 먼저 점검하고, 값은 채팅·문서·브라우저 캡처에 출력하지 않는다. 운영 설정이 없다고 단정하거나 새 키를 먼저 요구하지 않는다.

## 적용할 추가형 변경

기존 Supabase 백업과 복구 가능 여부를 먼저 확인한다. 기존 회원·돌봄 자료를 삭제하거나 초기화하지 않는다. 검토 후 다음 순서로 적용한다.

1. db/migrations/2026-10-20-center-membership.sql
2. db/migrations/2026-10-21-center-documents.sql
3. db/migrations/2026-10-22-center-operations.sql
4. db/migrations/2026-10-22-center-imports.sql
5. db/migrations/2026-10-22-center-patient-documents.sql (documents + operations 적용 후)

동일 SQL의 무조건 재실행을 전제하지 않는다. 기존 테이블·함수·적용 이력과 대조한다. 이 단계는 자동 실행하지 않았다.

## 서버 구성

기존 배포 설정에서 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CENTER_SESSION_SECRET(32자 이상), CENTER_MASTER_ID, CENTER_MASTER_PASSWORD_HASH(bcrypt), CENTER_MASTER_ORGANIZATION_CODE와 활성 기관 행을 확인한다. 일반 가입에는 Supabase 이메일 확인과 redirect 설정도 필요하다. 서비스 키와 마스터 해시는 브라우저에 노출하지 않는다.

실제 외부 AI 처리를 활성화하려면 CENTER_PERSON_IMPORT_AI_ENABLED=true를 명시한다. CARE_AI_PROVIDER 및 실제 계정에서 사용 가능한 CARE_AI_MODEL을 확인한다. Gemini는 GEMINI_API_KEY, Vertex는 GOOGLE_VERTEX_PROJECT_ID·GOOGLE_VERTEX_LOCATION·GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON 구성과 권한이 필요하다. 학교 앱 구독이 API 비용을 충당한다고 가정하지 않는다. 현재 기본 모델의 실계정 사용 가능 여부도 미검증이다. 예제의 활성화 기본값은 false다.

## 실제 기관 연결 후 검증

실자료 대신 가상 직원·수급자를 사용한다. 승인 전 차단, 기관 간 접근 차단, 마스터 승인과 역할 분기를 확인한다. 인물 등록·수정, 일정 등록, 새로고침·로그아웃·재로그인 재조회, 오래된 버전 저장 거부, 동일 요청 중복 방지를 확인한다. AI에는 명시적 폼 확인 후 가상 TXT만 보내고 실제 provider 응답과 근거·빈 값·저장 결과를 검증한다. 동일 원문 재전송은 새 인물을 만들지 않아야 하며 동명이인·충돌은 검토 상태로 남아야 한다. 운영 문서 최종 확정을 대신 실행하지 않는다.

## 복구와 남은 한계

실패하면 직전 앱 버전으로 되돌리고 추가 테이블과 원본·초안은 보존한다. DROP/초기화는 복구책으로 실행하지 않는다. DB 관리 백업의 실제 복원 시험은 아직 수행하지 않았다. 운영 목록 GET은 전체 백업이 아니다. 실패/장시간 processing인 자료의 운영 복구 도구와 충돌 수동 병합 UI는 아직 없다. 일정 편집·보관 UI, PDF/HWPX/이미지 추출 및 실제 서식 다운로드도 남아 있다.

로컬 검증: TypeScript, 45개 파일 387개 Vitest, lint(기존 경고 4건), Vite build 통과. provider는 mock, DB는 PGlite이며 운영 인증·DB·외부 API E2E 성공을 뜻하지 않는다.

최종 추가 검증: 세션 교체 회귀를 포함한 operationsRepo.test.ts **9/9 통과**. 추가 수정 후 TypeScript·lint·Vite build 재실행 통과(lint 기존 경고4, 빌드 청크 경고). 직전 전체 실행은 45파일387검사 통과이며, 이후 추가 검사 1개는 이 9건 재검증에 포함됐다.
