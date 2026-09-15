-- 2026-09-15 · 돌봄 연속성 2단계: 관리자 판단 · 조치 · 의무 기한 · 안전 신호 검토 · 보고 이벤트
--
-- 적용: Supabase 대시보드 > SQL Editor에서 이 파일 전체를 한 번 실행한다(여러 번 실행해도 안전).
-- 성격: 추가형(additive)만 — 새 테이블·함수·트리거. 기존 reports 등의 컬럼과 데이터는 바꾸지 않는다.
--       과거 보고의 제출·검토 이벤트를 소급 생성하지 않는다(적용 시점 이후부터 기록된다).
-- 이전 앱과의 호환: 이전 버전 앱은 새 테이블을 읽지 않으므로 그대로 동작한다. 새 앱은 이 파일이
--       적용되기 전에는 판단·조치·안전 검토 기능을 "준비 중"으로 비활성화한다.
--
-- 적용 후 확인(아래를 실행해 7행 모두 true인지 본다):
--   select to_regclass('public.report_events') is not null as report_events,
--          to_regclass('public.admin_decisions') is not null as admin_decisions,
--          to_regclass('public.safety_reviews') is not null as safety_reviews,
--          to_regclass('public.care_actions') is not null as care_actions,
--          to_regclass('public.action_obligations') is not null as action_obligations,
--          to_regclass('public.action_events') is not null as action_events,
--          exists(select 1 from pg_trigger where tgname = 'reports_capture_events') as report_trigger;
--
-- 되돌리기(문제 시): 보고 이벤트 수집만 멈추려면
--   drop trigger if exists reports_capture_events on reports;
-- 앱 쪽은 이전 커밋으로 되돌리면 된다. 쌓인 판단·조치·이력 테이블은 지우지 않는다(기록 보존) —
-- 정말 제거가 필요하면 사용자가 백업 후 별도로 결정한다.

create extension if not exists pgcrypto;

-- ── 1. 보고 이벤트: 제출·승인·반려 순간을 한 번씩 남기는 불변 기록 ─────────────
create table if not exists report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id),
  event_type text not null check (event_type in ('submitted', 'review_approved', 'review_rejected')),
  occurred_at timestamptz not null,
  -- 실제 인증 범위: 제출은 요양보호사 세션(참여자 코드), 검토는 기관 공유 관리자 계정.
  actor_scope text not null,
  actor_ref text,
  request_id text,
  recorded_at timestamptz not null default now()
);
create unique index if not exists report_events_one_submit_idx on report_events (report_id) where event_type = 'submitted';
create index if not exists report_events_report_idx on report_events (report_id, occurred_at);

-- ── 2. 관리자 판단(보고 승인/반려와 별개) — 새 판단은 이전 판단을 대체하되 지우지 않는다 ──
create table if not exists admin_decisions (
  id uuid primary key,
  organization_id text not null,
  report_id uuid not null references reports(id),
  decision text not null check (decision in ('no_action_needed', 'observe_more', 'action_needed', 'on_hold')),
  reason text,
  decided_at timestamptz not null default now(),
  actor_scope text not null,
  entered_by_label text,
  request_id text not null unique,
  previous_decision_id uuid references admin_decisions(id)
);
create index if not exists admin_decisions_report_idx on admin_decisions (report_id, decided_at);

-- ── 3. 조치(현재 상태 + 버전) ───────────────────────────────────────────────
create table if not exists care_actions (
  id uuid primary key,
  organization_id text not null,
  recipient_code text not null references recipients(code),
  source_report_id uuid references reports(id),
  decision_id uuid references admin_decisions(id),
  kind text not null check (kind in ('field_request', 'admin_direct')),
  purpose text not null check (length(btrim(purpose)) > 0),
  action_content text,
  field_message_draft text,
  field_message_status text not null check (field_message_status in ('unpublished', 'not_applicable')),
  internal_note text,
  owner_label text,
  status text not null check (status in ('draft', 'open', 'completed', 'cancelled')),
  version integer not null check (version >= 1),
  current_cycle integer not null default 1 check (current_cycle >= 1),
  completion_evidence text,
  completion_remaining text,
  completed_at timestamptz,
  cancel_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_scope text not null,
  create_request_id text not null unique,
  check (status <> 'completed' or (completion_evidence is not null and completed_at is not null)),
  check (status <> 'cancelled' or (cancel_reason is not null and cancelled_at is not null))
);
create index if not exists care_actions_recipient_idx on care_actions (recipient_code, status);
create index if not exists care_actions_report_idx on care_actions (source_report_id);

-- ── 4. 의무(현장 응답기한 / 관리자 재확인기한 / 관리자 직접 수행기한) ─────────────
-- initial_* 는 만든 뒤 바뀌지 않는다(아래 트리거). 기한 변경은 current_* 와 action_events로 남는다.
-- 재개하면 cycle_no가 늘어난 새 의무가 생기고 이전 주기의 기록은 그대로 남는다.
create table if not exists action_obligations (
  id uuid primary key,
  action_id uuid not null references care_actions(id),
  cycle_no integer not null check (cycle_no >= 1),
  obligation_type text not null check (obligation_type in ('field_response', 'admin_verification', 'admin_execution')),
  initial_due_kind text not null check (initial_due_kind in ('datetime', 'next_actual_visit', 'unset')),
  initial_due_at timestamptz,
  current_due_kind text not null check (current_due_kind in ('datetime', 'next_actual_visit', 'unset')),
  current_due_at timestamptz,
  status text not null check (status in ('inactive', 'pending_publish', 'active', 'fulfilled', 'cancelled')),
  activated_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  -- '특정 일시'일 때만 날짜가 있다 — '다음 실제 방문'·'미정'에 날짜를 만들어 넣지 않는다.
  check ((initial_due_kind = 'datetime') = (initial_due_at is not null)),
  check ((current_due_kind = 'datetime') = (current_due_at is not null)),
  check (obligation_type = 'field_response' or (initial_due_kind <> 'next_actual_visit' and current_due_kind <> 'next_actual_visit')),
  unique (action_id, cycle_no, obligation_type)
);
create index if not exists action_obligations_action_idx on action_obligations (action_id);

-- ── 5. 조치 이력(요청 하나 = 한 줄, request_id로 재시도 중복 방지) ───────────────
create table if not exists action_events (
  id uuid primary key,
  action_id uuid not null references care_actions(id),
  obligation_id uuid references action_obligations(id),
  event_type text not null check (event_type in ('created', 'activated', 'updated', 'due_changed', 'completed', 'cancelled', 'reopened')),
  reason text,
  detail jsonb not null default '{}'::jsonb,
  actor_scope text not null,
  entered_by_label text,
  owner_label_at_event text,
  request_id text not null unique,
  occurred_at timestamptz not null default now()
);
create index if not exists action_events_action_idx on action_events (action_id, occurred_at);

-- ── 6. 안전 신호 검토(보고 승인과 별개) ─────────────────────────────────────
create table if not exists safety_reviews (
  id uuid primary key,
  organization_id text not null,
  report_id uuid not null references reports(id),
  signal_source text not null check (signal_source in ('emergency_flagged')),
  report_status_at_review text not null check (report_status_at_review in ('draft', 'submitted')),
  report_updated_at_at_review timestamptz not null,
  outcome text not null check (outcome in ('action_linked', 'no_further_action', 'signal_not_applicable')),
  reason text not null check (length(btrim(reason)) > 0),
  related_action_id uuid references care_actions(id),
  reviewed_at timestamptz not null default now(),
  actor_scope text not null,
  entered_by_label text,
  request_id text not null unique,
  previous_review_id uuid references safety_reviews(id),
  check (outcome <> 'action_linked' or related_action_id is not null)
);
create index if not exists safety_reviews_report_idx on safety_reviews (report_id, reviewed_at);

-- ── 7. 불변 보호: 이력 테이블은 수정·삭제 불가, 의무의 최초 기한은 수정 불가 ───────
create or replace function workflow_forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% 는 이력 테이블이라 % 할 수 없습니다', tg_table_name, tg_op;
end $$;

drop trigger if exists report_events_append_only on report_events;
create trigger report_events_append_only before update or delete on report_events
  for each row execute function workflow_forbid_change();
drop trigger if exists admin_decisions_append_only on admin_decisions;
create trigger admin_decisions_append_only before update or delete on admin_decisions
  for each row execute function workflow_forbid_change();
drop trigger if exists safety_reviews_append_only on safety_reviews;
create trigger safety_reviews_append_only before update or delete on safety_reviews
  for each row execute function workflow_forbid_change();
drop trigger if exists action_events_append_only on action_events;
create trigger action_events_append_only before update or delete on action_events
  for each row execute function workflow_forbid_change();
drop trigger if exists care_actions_no_delete on care_actions;
create trigger care_actions_no_delete before delete on care_actions
  for each row execute function workflow_forbid_change();
drop trigger if exists action_obligations_no_delete on action_obligations;
create trigger action_obligations_no_delete before delete on action_obligations
  for each row execute function workflow_forbid_change();

create or replace function action_obligations_keep_initial() returns trigger language plpgsql as $$
begin
  if new.initial_due_kind is distinct from old.initial_due_kind
     or new.initial_due_at is distinct from old.initial_due_at
     or new.action_id is distinct from old.action_id
     or new.cycle_no is distinct from old.cycle_no
     or new.obligation_type is distinct from old.obligation_type
     or new.created_at is distinct from old.created_at then
    raise exception '의무의 최초 기한·소속은 바꿀 수 없습니다(현재 기한만 변경 가능)';
  end if;
  return new;
end $$;
drop trigger if exists action_obligations_keep_initial on action_obligations;
create trigger action_obligations_keep_initial before update on action_obligations
  for each row execute function action_obligations_keep_initial();

-- ── 8. 보고 제출·검토 순간을 같은 트랜잭션에서 이벤트로 남긴다 ─────────────────
-- 기존 앱 코드(api/care/reports.ts 제출, api/admin/reports.ts 승인/반려)를 바꾸지 않고 수집한다.
-- 이벤트 기록이 어떤 이유로 실패해도 현장 제출·관리자 검토 자체는 막지 않는다(경고만 남김) —
-- 보고 저장이 부수 기록 때문에 실패하면 안 되기 때문이다.
create or replace function reports_capture_events() returns trigger language plpgsql as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    begin
      insert into report_events (report_id, event_type, occurred_at, actor_scope, actor_ref)
      values (new.id, 'submitted', coalesce(new.submitted_at, now()), 'caregiver_session', new.participant_code)
      on conflict do nothing;
    exception when others then
      raise warning 'report_events submitted 기록 실패: %', sqlerrm;
    end;
  end if;
  if new.review_status in ('approved', 'rejected') and new.reviewed_at is not null
     and (tg_op = 'INSERT' or new.reviewed_at is distinct from old.reviewed_at or new.review_status is distinct from old.review_status) then
    begin
      insert into report_events (report_id, event_type, occurred_at, actor_scope, request_id)
      values (new.id, 'review_' || new.review_status, new.reviewed_at, 'org_admin_shared', new.last_review_request_id);
    exception when others then
      raise warning 'report_events review 기록 실패: %', sqlerrm;
    end;
  end if;
  return new;
end $$;
drop trigger if exists reports_capture_events on reports;
create trigger reports_capture_events after insert or update on reports
  for each row execute function reports_capture_events();

-- ── 9. 원자적 쓰기 함수(서버 전용) ─────────────────────────────────────────
-- 업무 규칙은 앱(shared/workflow.ts)이 계산하고, 이 함수들은 한 트랜잭션 안에서
-- (1) 대상 행 잠금 (2) 같은 request_id 재전송이면 중복으로 응답 (3) 버전/최신 판단 대조
-- (4) 여러 테이블 쓰기를 한꺼번에 적용한다. 반환: {status: ok|duplicate|conflict|not_found|invalid}.

create or replace function workflow_append_decision(p jsonb) returns jsonb language plpgsql as $$
declare
  v_report reports%rowtype;
  v_latest uuid;
  v_row admin_decisions%rowtype;
begin
  select * into v_report from reports where id = (p->>'report_id')::uuid for update;
  if not found or v_report.deleted then return jsonb_build_object('status', 'not_found'); end if;
  select * into v_row from admin_decisions where request_id = p->>'request_id';
  if found then return jsonb_build_object('status', 'duplicate', 'row', to_jsonb(v_row)); end if;
  if v_report.status <> 'submitted' then
    return jsonb_build_object('status', 'invalid', 'message', '제출된 보고에만 관리자 판단을 남길 수 있습니다.');
  end if;
  select id into v_latest from admin_decisions where report_id = v_report.id order by decided_at desc, id desc limit 1;
  if v_latest is distinct from nullif(p->>'previous_decision_id', '')::uuid then
    return jsonb_build_object('status', 'conflict');
  end if;
  insert into admin_decisions select * from jsonb_populate_record(null::admin_decisions, p) returning * into v_row;
  return jsonb_build_object('status', 'ok', 'row', to_jsonb(v_row));
end $$;

create or replace function workflow_append_safety_review(p jsonb) returns jsonb language plpgsql as $$
declare
  v_report reports%rowtype;
  v_latest uuid;
  v_row safety_reviews%rowtype;
begin
  select * into v_report from reports where id = (p->>'report_id')::uuid for update;
  if not found or v_report.deleted then return jsonb_build_object('status', 'not_found'); end if;
  select * into v_row from safety_reviews where request_id = p->>'request_id';
  if found then return jsonb_build_object('status', 'duplicate', 'row', to_jsonb(v_row)); end if;
  if not v_report.emergency_flagged then
    return jsonb_build_object('status', 'invalid', 'message', '안전 신호가 기록되지 않은 보고입니다.');
  end if;
  select id into v_latest from safety_reviews where report_id = v_report.id order by reviewed_at desc, id desc limit 1;
  if v_latest is distinct from nullif(p->>'previous_review_id', '')::uuid then
    return jsonb_build_object('status', 'conflict');
  end if;
  if nullif(p->>'related_action_id', '') is not null then
    perform 1 from care_actions where id = (p->>'related_action_id')::uuid and recipient_code = v_report.recipient_code;
    if not found then
      return jsonb_build_object('status', 'invalid', 'message', '같은 수급자의 조치만 연결할 수 있습니다.');
    end if;
  end if;
  insert into safety_reviews select * from jsonb_populate_record(null::safety_reviews, p) returning * into v_row;
  return jsonb_build_object('status', 'ok', 'row', to_jsonb(v_row));
end $$;

create or replace function workflow_create_action(p jsonb) returns jsonb language plpgsql as $$
declare
  v_action jsonb := p->'action';
  v_id uuid;
begin
  select id into v_id from care_actions where create_request_id = v_action->>'create_request_id';
  if found then return jsonb_build_object('status', 'duplicate', 'action_id', v_id); end if;
  if nullif(v_action->>'source_report_id', '') is not null then
    perform 1 from reports where id = (v_action->>'source_report_id')::uuid and recipient_code = v_action->>'recipient_code' and not deleted;
    if not found then return jsonb_build_object('status', 'invalid', 'message', '근거 보고가 이 수급자의 보고가 아닙니다.'); end if;
  end if;
  if nullif(v_action->>'decision_id', '') is not null then
    perform 1 from admin_decisions d join reports r on r.id = d.report_id
      where d.id = (v_action->>'decision_id')::uuid and r.recipient_code = v_action->>'recipient_code';
    if not found then return jsonb_build_object('status', 'invalid', 'message', '연결할 판단이 이 수급자의 보고 판단이 아닙니다.'); end if;
  end if;
  begin
    insert into care_actions select * from jsonb_populate_record(null::care_actions, v_action);
    insert into action_obligations select * from jsonb_populate_recordset(null::action_obligations, coalesce(p->'obligations', '[]'::jsonb));
    insert into action_events select * from jsonb_populate_record(null::action_events, p->'event');
  exception when unique_violation then
    -- 같은 요청이 동시에 두 번 들어온 경우 — 이 블록의 쓰기는 모두 되돌려진다.
    select id into v_id from care_actions where create_request_id = v_action->>'create_request_id';
    return jsonb_build_object('status', 'duplicate', 'action_id', v_id);
  end;
  return jsonb_build_object('status', 'ok', 'action_id', (v_action->>'id')::uuid);
end $$;

create or replace function workflow_apply_action_change(p jsonb) returns jsonb language plpgsql as $$
declare
  v_cur care_actions%rowtype;
  v_new care_actions%rowtype;
begin
  select * into v_cur from care_actions where id = (p->>'action_id')::uuid for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if exists (select 1 from action_events where request_id = p->>'request_id') then
    return jsonb_build_object('status', 'duplicate', 'version', v_cur.version);
  end if;
  if v_cur.version <> (p->>'expected_version')::int then
    return jsonb_build_object('status', 'conflict', 'version', v_cur.version);
  end if;
  v_new := jsonb_populate_record(null::care_actions, p->'action');
  if v_new.version <> v_cur.version + 1 or v_new.id <> v_cur.id then
    return jsonb_build_object('status', 'invalid', 'message', '버전 정보가 올바르지 않습니다.');
  end if;
  begin
    -- 수급자·종류·근거 보고·판단·생성 정보는 바꾸지 않는다.
    update care_actions set
      purpose = v_new.purpose,
      action_content = v_new.action_content,
      field_message_draft = v_new.field_message_draft,
      field_message_status = v_new.field_message_status,
      internal_note = v_new.internal_note,
      owner_label = v_new.owner_label,
      status = v_new.status,
      version = v_new.version,
      current_cycle = v_new.current_cycle,
      completion_evidence = v_new.completion_evidence,
      completion_remaining = v_new.completion_remaining,
      completed_at = v_new.completed_at,
      cancel_reason = v_new.cancel_reason,
      cancelled_at = v_new.cancelled_at,
      updated_at = v_new.updated_at
    where id = v_cur.id;
    update action_obligations o set
      current_due_kind = u.current_due_kind,
      current_due_at = u.current_due_at,
      status = u.status,
      activated_at = u.activated_at,
      fulfilled_at = u.fulfilled_at,
      cancelled_at = u.cancelled_at
    from jsonb_populate_recordset(null::action_obligations, coalesce(p->'obligation_updates', '[]'::jsonb)) u
    where o.id = u.id and o.action_id = v_cur.id;
    insert into action_obligations select * from jsonb_populate_recordset(null::action_obligations, coalesce(p->'obligation_inserts', '[]'::jsonb));
    insert into action_events select * from jsonb_populate_record(null::action_events, p->'event');
  exception when unique_violation then
    return jsonb_build_object('status', 'duplicate', 'version', v_cur.version);
  end;
  return jsonb_build_object('status', 'ok', 'version', v_new.version);
end $$;

-- ── 10. 접근: 브라우저 키(anon·authenticated)는 막고 서버(Service Role)만 쓴다 ────
alter table report_events enable row level security;
alter table admin_decisions enable row level security;
alter table safety_reviews enable row level security;
alter table care_actions enable row level security;
alter table action_obligations enable row level security;
alter table action_events enable row level security;

revoke all on function workflow_append_decision(jsonb) from public;
revoke all on function workflow_append_safety_review(jsonb) from public;
revoke all on function workflow_create_action(jsonb) from public;
revoke all on function workflow_apply_action_change(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function workflow_append_decision(jsonb), workflow_append_safety_review(jsonb), workflow_create_action(jsonb), workflow_apply_action_change(jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function workflow_append_decision(jsonb), workflow_append_safety_review(jsonb), workflow_create_action(jsonb), workflow_apply_action_change(jsonb) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function workflow_append_decision(jsonb), workflow_append_safety_review(jsonb), workflow_create_action(jsonb), workflow_apply_action_change(jsonb) to service_role';
  end if;
end $$;

-- API(PostgREST)가 새 테이블·함수를 바로 인식하도록 스키마 캐시를 새로 읽게 한다.
notify pgrst, 'reload schema';
