-- 2026-09-10 — review_note_visible_to_caregiver 컬럼만 추가하는 최소 마이그레이션.
-- review_note(관리자 검토 메모)는 지금까지 관리자 화면에만 보였다. 이번 변경으로
-- 요양보호사의 "내가 남긴 돌봄기록" 상세 화면에도 관리자 응답을 보여줄 수 있게
-- 되므로, "이 메모가 요양보호사에게 공개된 응답인지"를 명시적으로 구분하는 컬럼이
-- 필요하다. 기본값 false이므로 이 컬럼이 생기기 전에 저장된 모든 review_note는
-- 자동으로 "비공개(관리자 전용)" 상태를 유지한다 — 과거 메모를 소급 공개하지 않는다.
-- 여러 번 실행해도 안전(멱등)하다. 데이터 삭제·수정, 권한(grant/revoke) 변경 없음.
--
-- 이 파일은 Claude가 대신 실행한 것이 아니라 관리자가 Supabase SQL Editor에서 직접
-- 실행해야 하는 스크립트다.

alter table reports add column if not exists review_note_visible_to_caregiver boolean not null default false;

-- ── 적용 확인 ──────────────────────────────────────────────────────────
-- 아래 쿼리 결과에 review_note_visible_to_caregiver(boolean, is_nullable=NO,
-- column_default=false) 한 행이 나오면 정상 적용된 것이다.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'reports' and column_name = 'review_note_visible_to_caregiver';

-- (참고) 적용 직후 기존 기록이 전부 false인지 별도로도 확인하려면:
-- select count(*) as total, count(*) filter (where review_note_visible_to_caregiver) as visible
-- from reports where deleted = false;
-- visible이 0이어야 정상이다(방금 컬럼을 추가했으므로 아직 아무 기록도 공개 처리된 적이
-- 없어야 함 — 0보다 크면 예상 밖의 값이니 바로 확인이 필요하다).
