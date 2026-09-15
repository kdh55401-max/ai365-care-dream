-- 2026-09-18 · 돌봄 연속성 5단계: 반복 보고 후보·값 비교 후보에 대한 관리자 판단
--
-- 적용 순서: 2026-09-15(2단계) → 2026-09-16(3단계) → 2026-09-17(4단계) → 이 파일.
--           Supabase 대시보드 > SQL Editor에 이 파일 전체를 붙여 한 번 실행한다(여러 번 실행해도 안전).
-- 성격: 추가형 — 새 테이블 1개와 쓰기 함수 1개. 후보 자체는 저장하지 않는다(보고·기준정보에서 매번 같은 규칙으로 계산하고,
--       규칙·버전·기준·수급자·세부 영역·에피소드 시작일로 만든 같은 열쇠를 쓴다). 여기에는 관리자 판단만 쌓인다(수정·삭제 없음).
--       기존 보고·조치 행은 바꾸지 않는다.
--
-- 적용 후 확인(모두 true인지 본다):
--   select to_regclass('public.change_candidate_reviews') is not null as reviews,
--          exists(select 1 from pg_proc where proname = 'candidate_review_append') as append_fn;

do $$
begin
  if to_regclass('public.care_actions') is null or to_regclass('public.source_documents') is null then
    raise exception '먼저 2단계·3단계·4단계 마이그레이션(2026-09-15, 2026-09-16, 2026-09-17)을 순서대로 적용하세요.';
  end if;
end $$;

create table if not exists change_candidate_reviews (
  id uuid primary key,
  organization_id text not null,
  candidate_key text not null,
  candidate_kind text not null check (candidate_kind in ('repeat_changed', 'scale_value_diff')),
  rule_id text not null,
  rule_version integer not null check (rule_version >= 1),
  basis text,                      -- 'report_date' 등(값 비교는 null)
  recipient_code text not null references recipients(code),
  domain text,
  evidence jsonb not null,         -- 판단 당시 근거 스냅샷(보고 id·날짜 / 기준정보 id·버전)
  decision text not null check (decision in ('change_confirmed', 'within_usual', 'needs_check', 'not_comparable')),
  reason text not null check (length(trim(reason)) > 0),
  linked_action_id uuid references care_actions(id),
  reviewed_at timestamptz not null,
  actor_scope text not null,
  entered_by_label text,
  request_id text not null unique
);
create index if not exists change_candidate_reviews_key_idx on change_candidate_reviews (organization_id, candidate_key, reviewed_at);
create index if not exists change_candidate_reviews_action_idx on change_candidate_reviews (linked_action_id);

drop trigger if exists change_candidate_reviews_append_only on change_candidate_reviews;
create trigger change_candidate_reviews_append_only before update or delete on change_candidate_reviews
  for each row execute function workflow_forbid_change();

-- 쓰기: 같은 요청 재전송은 'duplicate'. 연결할 조치는 같은 기관·같은 수급자·초안/진행 중이어야 한다.
create or replace function candidate_review_append(p jsonb) returns jsonb language plpgsql as $$
declare
  v_row change_candidate_reviews%rowtype;
  v_action care_actions%rowtype;
begin
  v_row := jsonb_populate_record(null::change_candidate_reviews, p->'review');
  if exists (select 1 from change_candidate_reviews where request_id = v_row.request_id) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  if not exists (select 1 from recipients where code = v_row.recipient_code) then
    return jsonb_build_object('status', 'not_found', 'message', '수급자를 찾을 수 없습니다.');
  end if;
  if v_row.linked_action_id is not null then
    select * into v_action from care_actions where id = v_row.linked_action_id for share;
    if not found or v_action.organization_id <> v_row.organization_id or v_action.recipient_code <> v_row.recipient_code then
      return jsonb_build_object('status', 'invalid', 'message', '같은 수급자의 조치에만 연결합니다.');
    end if;
    if v_action.status not in ('draft', 'open') then
      return jsonb_build_object('status', 'conflict', 'message', '초안·진행 중인 조치에만 연결합니다.');
    end if;
  end if;
  insert into change_candidate_reviews select v_row.*;
  return jsonb_build_object('status', 'ok', 'id', v_row.id);
exception when unique_violation then
  return jsonb_build_object('status', 'duplicate');
end $$;

alter table change_candidate_reviews enable row level security;
revoke all on function candidate_review_append(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function candidate_review_append(jsonb) from anon';
    execute 'revoke all on change_candidate_reviews from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function candidate_review_append(jsonb) from authenticated';
    execute 'revoke all on change_candidate_reviews from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function candidate_review_append(jsonb) to service_role';
    execute 'grant all on change_candidate_reviews to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
