-- 2026-10-02 · 관리자 수급자 등록 · 담당 요양보호사 배정
--
-- 적용 방법: Supabase 대시보드 > SQL Editor에 이 파일 전체를 붙여 한 번 실행한다(여러 번 실행해도 안전).
-- 선행 조건: db/schema.sql(participants·recipients·caregiver_assignments·reports)만 있으면 된다.
--           2~5단계 마이그레이션과는 독립이다(순서 무관).
-- 성격: 추가형 — 기존 행·기존 컬럼·기존 보고를 바꾸거나 지우지 않는다.
--   · recipients.display_name(표시명, 별칭) · recipients.updated_at · caregiver_assignments.updated_at 컬럼 추가
--   · 요청 중복 방지표(recipient_requests)와 변경 이력표(recipient_admin_log, 수정·삭제 불가) 추가
--   · 쓰기 함수 2개 — recipient_register(등록+배정을 한 트랜잭션), recipient_update(정보·배정 변경, 행 잠금·충돌 검사)
-- 앱 호환: 이 마이그레이션 없이도 기존 화면은 그대로 동작한다(수급자 관리 화면만 "DB 준비 중"). 앱 배포 전에 적용해도 안전하다.
-- 되돌리기(필요 시): 아래 "복구" 절을 본다. 데이터가 쌓인 뒤에는 컬럼·표를 지우지 말고 앱만 이전 배포로 되돌린다.
--
-- 적용 후 확인(모두 true인지 본다):
--   select exists(select 1 from information_schema.columns where table_name='recipients' and column_name='display_name') as display_name,
--          exists(select 1 from pg_proc where proname = 'recipient_register') as register_fn,
--          exists(select 1 from pg_proc where proname = 'recipient_update') as update_fn;

alter table recipients add column if not exists display_name text;
alter table recipients add column if not exists updated_at timestamptz not null default now();
alter table caregiver_assignments add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipients_display_name_len') then
    alter table recipients add constraint recipients_display_name_len
      check (display_name is null or char_length(btrim(display_name)) between 1 and 30);
  end if;
end $$;

-- 같은 요청(request_id)이 다시 오면(응답 유실 후 재시도) 한 번만 반영한다.
create table if not exists recipient_requests (
  request_id text primary key,
  recipient_code text not null references recipients(code),
  kind text not null check (kind in ('register', 'update')),
  created_at timestamptz not null default now()
);

-- 등록·수정·배정 변경 이력. 값 자체(표시명)는 남기지 않고 무엇이 바뀌었는지만 남긴다. 수정·삭제 불가.
create table if not exists recipient_admin_log (
  id bigserial primary key,
  recipient_code text not null references recipients(code),
  event_type text not null check (event_type in ('registered', 'updated')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists recipient_admin_log_recipient_idx on recipient_admin_log (recipient_code, created_at);

create or replace function recipient_admin_log_forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'recipient_admin_log는 추가만 가능합니다.';
end $$;
drop trigger if exists recipient_admin_log_append_only on recipient_admin_log;
create trigger recipient_admin_log_append_only before update or delete on recipient_admin_log
  for each row execute function recipient_admin_log_forbid_change();

-- 수급자 코드 자동 번호 매기기와 등록은 한 함수 안에서 잠금(advisory lock)을 잡고 한 트랜잭션으로 처리한다.
-- 동시에 두 명이 등록해도 같은 코드가 나가지 않고, 배정 하나가 잘못되면 수급자도 남지 않는다.
create or replace function recipient_register(p jsonb) returns jsonb language plpgsql as $$
declare
  v_req text := p->>'request_id';
  v_name text := btrim(coalesce(p->>'display_name', ''));
  v_manual text := nullif(btrim(coalesce(p->>'code', '')), '');
  v_active boolean := coalesce((p->>'active')::boolean, true);
  v_caregivers text[];
  v_code text;
  v_n integer;
  v_existing text;
  v_constraint text;
begin
  if v_req is null or char_length(v_req) < 8 then
    return jsonb_build_object('status', 'invalid', 'message', '요청 번호가 올바르지 않습니다.');
  end if;
  select recipient_code into v_existing from recipient_requests where request_id = v_req;
  if found then
    return jsonb_build_object('status', 'duplicate', 'code', v_existing);
  end if;
  if char_length(v_name) not between 1 and 30 then
    return jsonb_build_object('status', 'invalid', 'message', '표시명은 1~30자로 입력해 주세요.');
  end if;
  v_caregivers := coalesce(array(select distinct jsonb_array_elements_text(coalesce(p->'caregiver_codes', '[]'::jsonb))), '{}');
  if exists (select 1 from unnest(v_caregivers) c where not exists (select 1 from participants where code = c and active)) then
    return jsonb_build_object('status', 'invalid_caregiver', 'message', '등록되지 않았거나 사용 중지된 요양보호사는 배정할 수 없습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtext('recipient_code_sequence'));
  if v_manual is not null then
    if v_manual !~ '^A[0-9]{2,6}$' then
      return jsonb_build_object('status', 'invalid', 'message', '수급자 코드는 A와 숫자 2~6자리(예: A10)여야 합니다.');
    end if;
    if exists (select 1 from recipients where code = v_manual) then
      return jsonb_build_object('status', 'duplicate_code', 'message', '이미 사용 중인 수급자 코드입니다.');
    end if;
    v_code := v_manual;
  else
    select coalesce(max(substring(code from 2)::integer), 0) + 1 into v_n from recipients where code ~ '^A[0-9]{1,6}$';
    v_code := 'A' || lpad(v_n::text, 2, '0');
  end if;

  insert into recipients (code, active, display_name) values (v_code, v_active, v_name);
  insert into caregiver_assignments (caregiver_code, recipient_code, active)
    select c, v_code, true from unnest(v_caregivers) c;
  insert into recipient_requests (request_id, recipient_code, kind) values (v_req, v_code, 'register');
  insert into recipient_admin_log (recipient_code, event_type, detail)
    values (v_code, 'registered', jsonb_build_object('active', v_active, 'caregivers_added', to_jsonb(v_caregivers)));
  return jsonb_build_object('status', 'ok', 'code', v_code);
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'recipient_requests_pkey' then
    return jsonb_build_object('status', 'duplicate');
  end if;
  return jsonb_build_object('status', 'duplicate_code', 'message', '이미 사용 중인 수급자 코드입니다.');
end $$;

-- 정보·활성 상태·담당 요양보호사 변경. caregiver_codes를 주면 "지금 담당할 전체 목록"이며, 빠진 사람은 삭제하지 않고
-- active=false(해제)로 둔다 — 배정 이력과 과거 보고의 수급자 연결은 그대로다. expected_updated_at이 있으면 그 사이 다른
-- 관리자가 바꾼 경우 'conflict'로 거부한다.
create or replace function recipient_update(p jsonb) returns jsonb language plpgsql as $$
declare
  v_code text := p->>'code';
  v_req text := p->>'request_id';
  v_row recipients%rowtype;
  v_name text;
  v_active boolean;
  v_caregivers text[];
  v_added text[];
  v_removed text[];
  v_existing text;
  v_changed jsonb := '[]'::jsonb;
begin
  if v_req is null or char_length(v_req) < 8 then
    return jsonb_build_object('status', 'invalid', 'message', '요청 번호가 올바르지 않습니다.');
  end if;
  select recipient_code into v_existing from recipient_requests where request_id = v_req;
  if found then
    return jsonb_build_object('status', 'duplicate', 'code', v_existing);
  end if;
  select * into v_row from recipients where code = v_code for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', '수급자를 찾을 수 없습니다.');
  end if;
  if p ? 'expected_updated_at' and p->>'expected_updated_at' is not null
     and v_row.updated_at <> (p->>'expected_updated_at')::timestamptz then
    return jsonb_build_object('status', 'conflict', 'message', '다른 곳에서 먼저 수정되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.');
  end if;

  v_name := v_row.display_name;
  if p ? 'display_name' then
    v_name := btrim(coalesce(p->>'display_name', ''));
    if char_length(v_name) not between 1 and 30 then
      return jsonb_build_object('status', 'invalid', 'message', '표시명은 1~30자로 입력해 주세요.');
    end if;
    if v_name is distinct from v_row.display_name then v_changed := v_changed || '"display_name"'::jsonb; end if;
  end if;
  v_active := v_row.active;
  if p ? 'active' then
    v_active := (p->>'active')::boolean;
    if v_active <> v_row.active then v_changed := v_changed || '"active"'::jsonb; end if;
  end if;

  v_added := '{}'; v_removed := '{}';
  if p ? 'caregiver_codes' then
    v_caregivers := coalesce(array(select distinct jsonb_array_elements_text(coalesce(p->'caregiver_codes', '[]'::jsonb))), '{}');
    -- 새로 맡기는 사람만 "등록된 사용 중 요양보호사"인지 본다(이미 맡은 사람의 사용 중지가 변경을 막지 않게).
    if exists (
      select 1 from unnest(v_caregivers) c
      where not exists (select 1 from participants where code = c and active)
        and not exists (select 1 from caregiver_assignments a where a.caregiver_code = c and a.recipient_code = v_code and a.active)
    ) then
      return jsonb_build_object('status', 'invalid_caregiver', 'message', '등록되지 않았거나 사용 중지된 요양보호사는 배정할 수 없습니다.');
    end if;
    select coalesce(array_agg(c), '{}') into v_added from unnest(v_caregivers) c
      where not exists (select 1 from caregiver_assignments a where a.caregiver_code = c and a.recipient_code = v_code and a.active);
    select coalesce(array_agg(a.caregiver_code), '{}') into v_removed from caregiver_assignments a
      where a.recipient_code = v_code and a.active and not (a.caregiver_code = any (v_caregivers));
    insert into caregiver_assignments (caregiver_code, recipient_code, active, updated_at)
      select c, v_code, true, now() from unnest(v_added) c
      on conflict (caregiver_code, recipient_code) do update set active = true, updated_at = now();
    update caregiver_assignments set active = false, updated_at = now()
      where recipient_code = v_code and active and caregiver_code = any (v_removed);
    if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then v_changed := v_changed || '"caregivers"'::jsonb; end if;
  end if;

  update recipients set display_name = v_name, active = v_active, updated_at = now() where code = v_code;
  insert into recipient_requests (request_id, recipient_code, kind) values (v_req, v_code, 'update');
  insert into recipient_admin_log (recipient_code, event_type, detail)
    values (v_code, 'updated', jsonb_build_object('changed', v_changed, 'active', v_active,
      'caregivers_added', to_jsonb(v_added), 'caregivers_removed', to_jsonb(v_removed)));
  return jsonb_build_object('status', 'ok', 'code', v_code);
exception when unique_violation then
  return jsonb_build_object('status', 'duplicate');
end $$;

-- 모든 접근은 서버(Service Role)만. 브라우저(anon·authenticated)에는 열지 않는다.
alter table recipient_requests enable row level security;
alter table recipient_admin_log enable row level security;
revoke all on function recipient_register(jsonb) from public;
revoke all on function recipient_update(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function recipient_register(jsonb) from anon';
    execute 'revoke all on function recipient_update(jsonb) from anon';
    execute 'revoke all on recipient_requests from anon';
    execute 'revoke all on recipient_admin_log from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function recipient_register(jsonb) from authenticated';
    execute 'revoke all on function recipient_update(jsonb) from authenticated';
    execute 'revoke all on recipient_requests from authenticated';
    execute 'revoke all on recipient_admin_log from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function recipient_register(jsonb) to service_role';
    execute 'grant execute on function recipient_update(jsonb) to service_role';
    execute 'grant all on recipient_requests to service_role';
    execute 'grant all on recipient_admin_log to service_role';
    execute 'grant usage, select on sequence recipient_admin_log_id_seq to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── 복구(문제가 생겼을 때) ───────────────────────────────────────────────
-- 1) 앱을 이전 배포로 되돌린다(Vercel > Deployments > 이전 배포 > Promote). 새 컬럼·표는 이전 앱에 영향이 없다.
-- 2) 이 기능으로 잘못 등록된 수급자는 삭제하지 말고 비활성화한다(관리자 화면 또는
--    update recipients set active = false where code = '…';).
-- 3) 적용 전 백업: 적용 직전에 Supabase > Database > Backups에서 시점 백업을 확인하거나
--    select * from recipients; select * from caregiver_assignments; 결과를 CSV로 내려 둔다.
