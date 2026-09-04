# 실증 준비 체크리스트 — 2026-09-07 시작 전

## A. Supabase 프로젝트 준비
1. https://supabase.com 에서 새 프로젝트 생성 (또는 기존에 안전하게 구성된
   Supabase 프로젝트가 있다면 그것을 재사용).
2. **SQL Editor**에서 [db/schema.sql](../db/schema.sql) 전체를 실행한다.
   - `participants`(C01~C09), `recipients`(A01~A09), `reports`, `admin_audit_log`
     테이블과 RLS가 생성된다. 참여자 PIN은 아직 `'unset'`이라 로그인이 불가능한
     상태다.
3. **Project Settings → API**에서 `Project URL`과 `service_role` 키를 복사해
   둔다 (아래 C 단계의 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

## B. Gemini API 키
- https://aistudio.google.com/apikey 에서 서버 전용 키를 발급한다. (기존
  `VITE_GEMINI_API_KEY`와는 별개의 값이어야 하며, `GEMINI_API_KEY`라는 이름으로
  서버에만 설정한다.)

## C. 환경변수 설정 (Vercel 프로젝트 설정 → Environment Variables)
`.env.local.example`을 참고해 아래 값을 모두 등록한다 (전부 서버 전용, `VITE_`
접두사 없음 → 브라우저에 노출되지 않음).

| 변수 | 값 |
|---|---|
| `SUPABASE_URL` | A 단계에서 복사한 Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | A 단계에서 복사한 service_role 키 |
| `CARE_PILOT_JWT_SECRET` | 무작위 32자 이상 문자열 (`openssl rand -hex 32`) |
| `CARE_PILOT_ADMIN_PASSWORD_HASH` | 아래 명령으로 생성한 bcrypt 해시 |
| `GEMINI_API_KEY` | B 단계 키 |
| `CARE_PILOT_START_DATE` | `2026-09-07` (기본값, 생략 가능) |
| `CARE_PILOT_END_DATE` | `2026-09-18` (기본값, 생략 가능) |

관리자 비밀번호 해시 생성:
```bash
node -e "require('bcryptjs').hash(process.argv[1],10).then(console.log)" '원하는비밀번호'
```

## D. 배포
```bash
vercel deploy --prod
```
(기존 프로젝트의 Vercel 배포 방식을 그대로 재사용한다. `vercel.json`은 이미
`/api/`를 제외한 모든 경로를 `index.html`로 라우팅하므로 추가 설정이 필요 없다.)

### DB 백업
- Supabase 유료 플랜은 일 단위 자동 백업을 제공한다. 무료 플랜이라면 최소
  주 1회 **관리자 화면의 "전체 CSV" 다운로드**를 백업으로 남기거나, Supabase
  대시보드의 **Database → Backups** 또는 `pg_dump "$SUPABASE_DB_URL" > backup.sql`
  로 수동 백업한다.
- 실증 종료 후에는 전체 CSV로 데이터를 내보낸 뒤, `reports`/`participants`/
  `recipients` 테이블을 삭제하거나 프로젝트 자체를 삭제해 개인정보(가명 코드
  포함) 보유기간을 지킨다.

## E. 참여자 PIN 발급 (C01~C09)
1. `/admin`에 로그인한다.
2. **참여자 관리** 탭에서 각 참여자(C01~C09)마다 **PIN 초기화**를 누른다.
3. 화면에 표시된 새 PIN을 즉시 오프라인(전화/문자/대면)으로 해당 요양보호사에게
   전달한다. **이 PIN은 다시 조회할 수 없으니 그 자리에서 반드시 전달한다.**
4. 실명-코드 대응표는 시스템에 저장하지 않으므로, 관리자가 별도 오프라인
   문서(엑셀 등, 시스템 외부)로 직접 관리한다.

## F. 사전 테스트 절차 (9월 7일 이전)
1. 관리자가 테스트용 참여자 코드(예: C09)로 `/care`에 로그인해 처음부터 끝까지
   보고를 1건 제출해 본다 (음성 1회, 텍스트 1회 모두).
2. `/admin` 보고 목록에서 방금 제출한 보고가 보이는지, 1단계→2단계 평가가
   순서대로만 열리는지 확인한다.
3. 대시보드 참여현황표에 해당 날짜·코드 셀이 반영되는지 확인한다(최대 8초
   대기).
4. CSV(요약/전체) 다운로드가 정상 파일로 열리는지 확인한다(엑셀에서 한글 깨짐
   없는지).
5. 아래 "모바일 실기기 테스트 체크리스트"를 최소 2개 기종(Android/iOS)에서
   수행한다.
6. 테스트로 만든 보고는 관리자가 삭제 사유를 남기고 삭제(소프트 삭제)해 실제
   집계에 섞이지 않게 한다.

## G. 모바일 실기기 테스트 체크리스트
- [ ] `/care` 로그인 화면 글자·버튼이 잘리지 않고 한 화면에 들어온다.
- [ ] 마이크 버튼으로 음성 입력이 되는 기기에서 정상 동작한다.
- [ ] 마이크 권한을 거부해도(또는 음성 인식 미지원 브라우저에서도) 텍스트
      입력만으로 끝까지 보고를 완료할 수 있다.
- [ ] 추가 질문이 화면당 1개씩, 최대 3개까지만 나온다.
- [ ] 보고 제출 후 "센터에 보고되었습니다."가 명확히 보인다.
- [ ] 로그인한 채로 앱을 껐다 켜도(2주 이내) 다시 로그인하지 않는다.
- [ ] 입력 중 새로고침해도 작성 중이던 내용이 복구된다.
- [ ] 상단 센터 전화·119 전화 버튼이 실제로 전화 앱을 연다.
- [ ] 모든 화면 하단에 안전 고지 문구가 보인다.
- [ ] `/admin`이 로그인 없이는 보고 데이터를 보여주지 않는다.
