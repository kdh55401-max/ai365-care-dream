-- 2026-09-08 — ai_fallback_used / ai_fallback_stage 컬럼만 추가하는 최소 마이그레이션.
-- db/schema.sql 전체를 다시 실행하는 대신, 이번 변경에 필요한 두 컬럼만 안전하게
-- 추가한다. 데이터 삭제·수정, 권한(grant/revoke) 변경은 전혀 없다 — 아래 두 줄이
-- 전부다. 여러 번 실행해도 안전(멱등)하다.
--
-- 실행 후에는 반드시 아래 "적용 확인" 쿼리로 컬럼이 생겼는지 확인할 것. 이 파일은
-- Claude가 대신 실행한 것이 아니라 관리자가 Supabase SQL Editor에서 직접 실행해야
-- 하는 스크립트다.

alter table reports add column if not exists ai_fallback_used boolean;
alter table reports add column if not exists ai_fallback_stage text check (ai_fallback_stage in ('final_report'));

-- ── 적용 확인 ──────────────────────────────────────────────────────────
-- 아래 쿼리 결과에 ai_fallback_used(boolean)와 ai_fallback_stage(text) 두 행이
-- 나오면 정상 적용된 것이다. is_nullable이 YES인지도 확인할 것 — NOT NULL이거나
-- 기본값이 false로 잡혀 있으면(예: 다른 도구가 임의로 기본값을 넣은 경우) 기존
-- 기록이 전부 false("AI 정상 처리")로 채워져 실제로는 알 수 없는 값이 "확인됨"으로
-- 둔갑한다 — 반드시 column_default가 비어 있고 is_nullable=YES인지 확인한다.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'reports' and column_name in ('ai_fallback_used', 'ai_fallback_stage')
order by column_name;

-- (참고) 적용 후 기존 기록이 전부 NULL(확인 불가)로 남아있는지 별도로도 확인하려면:
-- select count(*) as total, count(ai_fallback_used) as tracked
-- from reports where deleted = false;
-- tracked가 0이어야 정상이다(방금 컬럼을 추가했으므로 아직 아무 기록도 값이 없어야
-- 함 — 0보다 크면 예상 밖의 값이 채워진 것이니 바로 확인이 필요하다).
