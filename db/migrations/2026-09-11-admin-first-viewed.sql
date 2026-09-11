-- 2026-09-11 — admin_first_viewed_at 컬럼만 추가하는 최소 마이그레이션.
-- 관리자가 보고 상세를 처음 연 시각을 1회만 기록한다(재열람으로 갱신하지 않음).
-- 기존 reviewed_at(승인/반려 처리 시각)과는 다른 시점이다 — 이 둘의 차이가 사업계획서가
-- 약속한 핵심 실증 지표("관리자 재확인·수정 시간")의 원재료가 된다. 컬럼이 생기기 전
-- 기록은 전부 null이며, 과거 열람 시각을 추정해서 채우지 않는다.
-- 여러 번 실행해도 안전(멱등)하다. 데이터 삭제·수정, 권한(grant/revoke) 변경 없음.
--
-- 이 파일은 Claude가 대신 실행한 것이 아니라 관리자가 Supabase SQL Editor에서 직접
-- 실행해야 하는 스크립트다.

alter table reports add column if not exists admin_first_viewed_at timestamptz;

-- ── 적용 확인 ──────────────────────────────────────────────────────────
-- 아래 쿼리 결과에 admin_first_viewed_at(timestamptz, is_nullable=YES)
-- 한 행이 나오면 정상 적용된 것이다.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'reports' and column_name = 'admin_first_viewed_at';

-- (참고) 적용 직후에는 전부 null이어야 정상이다(과거 열람을 소급 기록하지 않으므로):
-- select count(*) as total, count(*) filter (where admin_first_viewed_at is not null) as viewed
-- from reports where deleted = false;
-- viewed가 0이어야 정상이다.
