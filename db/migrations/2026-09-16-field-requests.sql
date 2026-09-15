-- 2026-09-16 · 돌봄 연속성 3단계: 현장 요청 게시 · 현장 응답 · 관리자 결과 확인
--
-- 적용 순서: 반드시 2026-09-15-admin-workflow.sql(2단계)을 먼저 적용한 뒤 이 파일을 실행한다.
--           Supabase 대시보드 > SQL Editor에 이 파일 전체를 붙여 한 번 실행한다(여러 번 실행해도 안전).
-- 성격: 추가형 — 새 테이블 3개, care_actions 컬럼 1개(closure_outcome) 추가, 상태 허용값 확장(기존 값 유지),
--       2단계 쓰기 함수(workflow_apply_action_change)를 같은 입력을 받는 상위 호환 버전으로 교체, 새 함수 1개.
--       기존 행·이력을 바꾸거나 과거 게시·응답을 만들어 넣지 않는다.
-- 이전 앱과의 호환: 2단계 앱은 새 테이블을 읽지 않고, 교체된 함수는 2단계 입력도 그대로 처리한다.
--
-- 적용 후 확인(모두 true인지 본다):
--   select to_regclass('public.field_requests') is not null as field_requests,
--          to_regclass('public.field_responses') is not null as field_responses,
--          to_regclass('public.action_verifications') is not null as action_verifications,
--          exists(select 1 from information_schema.columns where table_name = 'care_actions' and column_name = 'closure_outcome') as closure_outcome,
--          exists(select 1 from pg_proc where proname = 'workflow_record_field_response') as response_fn;
--
-- 되돌리기(문제 시): 앱을 이전 커밋으로 되돌리면 새 테이블은 읽히지 않는다. 쌓인 요청·응답·결과 확인
-- 기록은 지우지 않는다(돌봄 이력 보존) — 제거가 꼭 필요하면 사용자가 백업 후 별도로 결정한다.

do $$
begin
  if to_regclass('public.care_actions') is null or to_regclass('public.action_events') is null then
    raise exception '먼저 db/migrations/2026-09-15-admin-workflow.sql(2단계)을 적용하세요.';
  end if;
end $$;

-- ── 1. 기존 2단계 테이블의 허용값 확장(추가만, 기존 값은 그대로 유효) ─────────────
alter table care_actions add column if not exists closure_outcome text;
alter table care_actions drop constraint if exists care_actions_closure_outcome_check;
alter table care_actions add constraint care_actions_closure_outcome_check
  check (closure_outcome is null or closure_outcome in ('improved', 'no_change', 'unable_to_confirm', 'refused', 'unreachable', 'external_handoff'));
alter table care_actions drop constraint if exists care_actions_field_message_status_check;
alter table care_actions add constraint care_actions_field_message_status_check
  check (field_message_status in ('unpublished', 'published', 'not_applicable'));
alter table action_events drop constraint if exists action_events_event_type_check;
alter table action_events add constraint action_events_event_type_check
  check (event_type in ('created', 'activated', 'updated', 'due_changed', 'completed', 'cancelled', 'reopened',
                        'published', 'withdrawn', 'retargeted', 'response_received', 'verified'));

-- ── 2. 현장 요청(관리자가 명시적으로 게시한 인계) ────────────────────────────
create table if not exists field_requests (
  id uuid primary key,
  organization_id text not null,
  action_id uuid not null references care_actions(id),
  obligation_id uuid not null references action_obligations(id),
  cycle_no integer not null check (cycle_no >= 1),
  recipient_code text not null references recipients(code),
  -- 게시 시점의 문구로 고정 — 내부 메모는 이 테이블에 없다(현장 API는 이 테이블만 읽는다).
  message text not null check (length(btrim(message)) > 0),
  target_mode text not null check (target_mode in ('recipient_assignees', 'specific_caregiver')),
  target_caregiver_code text references participants(code),
  status text not null check (status in ('published', 'answered', 'withdrawn', 'closed')),
  published_at timestamptz not null,
  -- 요양보호사 화면에 실제로 처음 표시된 시각(한 번만). 게시만으로 추정해 채우지 않는다.
  first_shown_at timestamptz,
  first_shown_to text,
  answered_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  version integer not null default 1 check (version >= 1),
  publish_request_id text not null unique,
  check ((target_mode = 'specific_caregiver') = (target_caregiver_code is not null)),
  check (status not in ('withdrawn', 'closed') or (ended_at is not null and end_reason is not null))
);
-- 한 조치의 한 후속 주기에는 살아 있는(게시·응답) 요청이 하나만.
create unique index if not exists field_requests_one_live_per_cycle_idx on field_requests (action_id, cycle_no) where status in ('published', 'answered');
create index if not exists field_requests_recipient_idx on field_requests (recipient_code, status);

-- ── 3. 현장 응답(새 보고에 붙어 온다, 수정·삭제 불가) ──────────────────────────
create table if not exists field_responses (
  id uuid primary key,
  field_request_id uuid not null references field_requests(id),
  action_id uuid not null references care_actions(id),
  obligation_id uuid not null references action_obligations(id),
  report_id uuid not null references reports(id),
  recipient_code text not null references recipients(code),
  responder_code text not null references participants(code),
  response_status text not null check (response_status in ('observed', 'performed', 'not_observed', 'refused', 'other')),
  response_text text,
  evidence_excerpt text,
  evidence_source text check (evidence_source is null or evidence_source in ('report_text', 'typed')),
  request_state_at_response text not null check (request_state_at_response in ('published', 'answered', 'withdrawn', 'closed')),
  fulfilled_obligation boolean not null,
  submitted_at timestamptz not null default now(),
  request_id text not null unique
);
-- 같은 보고를 두 번 제출(재시도)해도 같은 요청에 대한 응답은 한 건.
create unique index if not exists field_responses_one_per_report_idx on field_responses (field_request_id, report_id);
create index if not exists field_responses_action_idx on field_responses (action_id, submitted_at);

-- ── 4. 관리자 결과 확인(요약·시각·근거, 수정·삭제 불가) ─────────────────────────
create table if not exists action_verifications (
  id uuid primary key,
  action_id uuid not null references care_actions(id),
  cycle_no integer not null check (cycle_no >= 1),
  outcome text not null check (outcome in ('improved', 'no_change', 'unable_to_confirm', 'refused', 'unreachable', 'external_handoff')),
  summary text not null check (length(btrim(summary)) > 0),
  evidence text not null check (length(btrim(evidence)) > 0),
  response_ids jsonb not null default '[]'::jsonb,
  remaining_issue text,
  next_responsibility text,
  closes_action boolean not null,
  verified_at timestamptz not null default now(),
  actor_scope text not null,
  entered_by_label text,
  request_id text not null unique,
  -- 확인 불가·거절·연락 불가·외부 인계는 남은 문제와 다음 책임을 반드시 남긴다.
  check (outcome not in ('unable_to_confirm', 'refused', 'unreachable', 'external_handoff')
         or (remaining_issue is not null and length(btrim(remaining_issue)) > 0
             and next_responsibility is not null and length(btrim(next_responsibility)) > 0))
);
create index if not exists action_verifications_action_idx on action_verifications (action_id, verified_at);

-- ── 5. 불변 보호 ───────────────────────────────────────────────────────────
drop trigger if exists field_responses_append_only on field_responses;
create trigger field_responses_append_only before update or delete on field_responses
  for each row execute function workflow_forbid_change();
drop trigger if exists action_verifications_append_only on action_verifications;
create trigger action_verifications_append_only before update or delete on action_verifications
  for each row execute function workflow_forbid_change();
drop trigger if exists field_requests_no_delete on field_requests;
create trigger field_requests_no_delete before delete on field_requests
  for each row execute function workflow_forbid_change();

create or replace function field_requests_keep_fixed() returns trigger language plpgsql as $$
begin
  if new.message is distinct from old.message
     or new.action_id is distinct from old.action_id
     or new.obligation_id is distinct from old.obligation_id
     or new.cycle_no is distinct from old.cycle_no
     or new.recipient_code is distinct from old.recipient_code
     or new.published_at is distinct from old.published_at
     or new.publish_request_id is distinct from old.publish_request_id
     or (old.first_shown_at is not null and new.first_shown_at is distinct from old.first_shown_at) then
    raise exception '게시된 요청의 문구·소속·게시 시각·첫 표시 시각은 바꿀 수 없습니다';
  end if;
  if old.status in ('withdrawn', 'closed') and new.status is distinct from old.status then
    raise exception '철회·종결된 요청은 다시 열 수 없습니다(새 후속 주기에서 새로 게시)';
  end if;
  return new;
end $$;
drop trigger if exists field_requests_keep_fixed on field_requests;
create trigger field_requests_keep_fixed before update on field_requests
  for each row execute function field_requests_keep_fixed();

-- ── 6. 관리자 쪽 원자적 쓰기 — 2단계 함수를 상위 호환으로 교체 ─────────────────
-- 2단계 입력(action·obligation_updates·obligation_inserts·event)은 그대로 처리하고,
-- 3단계 입력(request_inserts·request_updates·verification_inserts)을 같은 트랜잭션에서 더 적용한다.
-- request_updates는 요청 버전을 대조한다 — 그 사이 현장 응답이 도착해 요청이 바뀌었으면 충돌로 되돌린다.
create or replace function workflow_apply_action_change(p jsonb) returns jsonb language plpgsql as $$
declare
  v_cur care_actions%rowtype;
  v_new care_actions%rowtype;
  v_expected integer;
  v_changed integer;
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
      closure_outcome = v_new.closure_outcome,
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
    insert into field_requests select * from jsonb_populate_recordset(null::field_requests, coalesce(p->'request_inserts', '[]'::jsonb));
    v_expected := jsonb_array_length(coalesce(p->'request_updates', '[]'::jsonb));
    update field_requests f set
      status = u.status,
      target_mode = u.target_mode,
      target_caregiver_code = u.target_caregiver_code,
      answered_at = u.answered_at,
      ended_at = u.ended_at,
      end_reason = u.end_reason,
      version = u.version
    from jsonb_populate_recordset(null::field_requests, coalesce(p->'request_updates', '[]'::jsonb)) u
    where f.id = u.id and f.action_id = v_cur.id and f.version = u.version - 1;
    get diagnostics v_changed = row_count;
    if v_changed <> v_expected then
      raise exception using errcode = 'WF409', message = '현장 요청이 그 사이 바뀌었습니다';
    end if;
    insert into action_verifications select * from jsonb_populate_recordset(null::action_verifications, coalesce(p->'verification_inserts', '[]'::jsonb));
    insert into action_events select * from jsonb_populate_record(null::action_events, p->'event');
  exception
    when unique_violation then
      return jsonb_build_object('status', 'duplicate', 'version', v_cur.version);
    when sqlstate 'WF409' then
      return jsonb_build_object('status', 'conflict', 'version', v_cur.version);
  end;
  return jsonb_build_object('status', 'ok', 'version', v_new.version);
end $$;

-- ── 7. 현장 응답 기록(요양보호사 보고 제출 뒤 서버가 호출) ───────────────────────
-- 권한·상태 판단을 DB 안에서 다시 한다(잠근 뒤의 최신 상태 기준): 본인의 제출된 실제 보고인지,
-- 지금 이 수급자에게 배정돼 있는지, 지정 대상이면 본인인지. 게시 중이던 요청의 첫 응답만
-- 현장 응답 의무를 이행으로 바꾸고, 철회·종결 뒤 늦은 응답은 기록만 남긴다(조치를 되살리지 않음).
-- 잠금 순서는 관리자 쓰기와 같게 조치 → 요청.
create or replace function workflow_record_field_response(p jsonb) returns jsonb language plpgsql as $$
declare
  v_req field_requests%rowtype;
  v_action care_actions%rowtype;
  v_report reports%rowtype;
  v_existing field_responses%rowtype;
  v_state text;
  v_fulfill boolean;
  v_responder text := p->>'responder_code';
  v_action_id uuid;
begin
  select action_id into v_action_id from field_requests where id = (p->>'field_request_id')::uuid;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into v_action from care_actions where id = v_action_id for update;
  select * into v_req from field_requests where id = (p->>'field_request_id')::uuid for update;

  select * into v_existing from field_responses
    where request_id = p->>'request_id' or (field_request_id = v_req.id and report_id = (p->>'report_id')::uuid)
    limit 1;
  if found then return jsonb_build_object('status', 'duplicate', 'response_id', v_existing.id); end if;

  select * into v_report from reports where id = (p->>'report_id')::uuid;
  if not found or v_report.deleted then return jsonb_build_object('status', 'not_found'); end if;
  if v_report.status <> 'submitted' or v_report.report_source <> 'live' then
    return jsonb_build_object('status', 'invalid', 'message', '제출된 실제 보고에만 답변을 연결할 수 있습니다.');
  end if;
  if v_report.participant_code <> v_responder or v_report.recipient_code <> v_req.recipient_code then
    return jsonb_build_object('status', 'forbidden', 'message', '본인이 이 수급자에 대해 쓴 보고에만 답변을 연결할 수 있습니다.');
  end if;
  perform 1 from caregiver_assignments where caregiver_code = v_responder and recipient_code = v_req.recipient_code and active;
  if not found then return jsonb_build_object('status', 'forbidden', 'message', '지금 배정되지 않은 수급자의 요청에는 답할 수 없습니다.'); end if;
  if v_req.target_mode = 'specific_caregiver' and v_req.target_caregiver_code <> v_responder then
    return jsonb_build_object('status', 'forbidden', 'message', '다른 요양보호사에게 보낸 요청입니다.');
  end if;

  v_state := v_req.status;
  v_fulfill := v_state = 'published';
  insert into field_responses (id, field_request_id, action_id, obligation_id, report_id, recipient_code, responder_code,
                               response_status, response_text, evidence_excerpt, evidence_source,
                               request_state_at_response, fulfilled_obligation, submitted_at, request_id)
  values ((p->>'response_id')::uuid, v_req.id, v_req.action_id, v_req.obligation_id, v_report.id, v_req.recipient_code, v_responder,
          p->>'response_status', nullif(btrim(coalesce(p->>'response_text', '')), ''), nullif(btrim(coalesce(p->>'evidence_excerpt', '')), ''),
          nullif(p->>'evidence_source', ''), v_state, v_fulfill, now(), p->>'request_id');
  if v_fulfill then
    -- 응답 도착 = 현장 응답 대기 해소. 관리자 결과 확인 의무는 그대로 남는다(완료 아님).
    update field_requests set status = 'answered', answered_at = now(), version = version + 1 where id = v_req.id;
    update action_obligations set status = 'fulfilled', fulfilled_at = now() where id = v_req.obligation_id and status = 'active';
    update care_actions set version = version + 1, updated_at = now() where id = v_action.id;
  end if;
  insert into action_events (id, action_id, obligation_id, event_type, reason, detail, actor_scope, entered_by_label, owner_label_at_event, request_id, occurred_at)
  values ((p->>'event_id')::uuid, v_action.id, v_req.obligation_id, 'response_received', null,
          jsonb_build_object('field_request_id', v_req.id, 'response_id', (p->>'response_id')::uuid, 'report_id', v_report.id,
                             'response_status', p->>'response_status', 'request_state_at_response', v_state,
                             'fulfilled_obligation', v_fulfill, 'late', v_state in ('withdrawn', 'closed'),
                             'action_status_at_response', v_action.status),
          'caregiver_session', null, v_action.owner_label, p->>'request_id', now());
  return jsonb_build_object('status', 'ok', 'response_id', (p->>'response_id')::uuid, 'fulfilled_obligation', v_fulfill, 'request_state_at_response', v_state);
exception when unique_violation then
  return jsonb_build_object('status', 'duplicate');
end $$;

-- ── 8. 접근: 브라우저 키는 막고 서버(Service Role)만 쓴다 ─────────────────────────
alter table field_requests enable row level security;
alter table field_responses enable row level security;
alter table action_verifications enable row level security;

revoke all on function workflow_apply_action_change(jsonb) from public;
revoke all on function workflow_record_field_response(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function workflow_apply_action_change(jsonb), workflow_record_field_response(jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function workflow_apply_action_change(jsonb), workflow_record_field_response(jsonb) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function workflow_apply_action_change(jsonb), workflow_record_field_response(jsonb) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
