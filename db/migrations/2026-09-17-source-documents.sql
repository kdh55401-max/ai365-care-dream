-- 2026-09-17 · 돌봄 연속성 4단계: 기준문서 원본 · 관리자 확인 기준정보 · 조치 근거 연결
--
-- 적용 순서: 2026-09-15-admin-workflow.sql(2단계) → 2026-09-16-field-requests.sql(3단계) → 이 파일.
--           Supabase 대시보드 > SQL Editor에 이 파일 전체를 붙여 한 번 실행한다(여러 번 실행해도 안전).
-- 성격: 추가형 — 새 테이블 4개, 비공개 저장소 버킷 1개(care-source-documents), action_events 이벤트 종류 2개 추가
--       (기존 값 유지), 원자적 쓰기 함수 1개. 기존 보고·조치·요청 행은 바꾸지 않고 과거 기준정보를 만들어 넣지 않는다.
-- 이전 앱과의 호환: 3단계 앱은 새 테이블·버킷을 읽지 않는다.
--
-- 적용 후 확인(모두 true인지 본다):
--   select to_regclass('public.source_documents') is not null as source_documents,
--          to_regclass('public.baseline_entries') is not null as baseline_entries,
--          to_regclass('public.baseline_reference_choices') is not null as reference_choices,
--          to_regclass('public.action_baseline_links') is not null as action_links,
--          exists(select 1 from pg_proc where proname = 'baseline_apply') as apply_fn,
--          exists(select 1 from storage.buckets where id = 'care-source-documents' and public = false) as private_bucket;
--
-- 되돌리기(문제 시): 앱을 이전 커밋으로 되돌리면 새 테이블·버킷은 읽히지 않는다. 올린 원본 파일과 기준정보
-- 기록은 지우지 않는다(돌봄 근거 보존) — 제거가 꼭 필요하면 사용자가 백업 후 별도로 결정한다.

do $$
begin
  if to_regclass('public.field_requests') is null or to_regclass('public.care_actions') is null then
    raise exception '먼저 2026-09-15-admin-workflow.sql(2단계)과 2026-09-16-field-requests.sql(3단계)을 순서대로 적용하세요.';
  end if;
end $$;

-- ── 1. 조치 이력에 근거 연결·해제 이벤트 추가(기존 값 유지) ─────────────────────
alter table action_events drop constraint if exists action_events_event_type_check;
alter table action_events add constraint action_events_event_type_check
  check (event_type in ('created', 'activated', 'updated', 'due_changed', 'completed', 'cancelled', 'reopened',
                        'published', 'withdrawn', 'retargeted', 'response_received', 'verified',
                        'baseline_linked', 'baseline_unlinked'));

-- ── 2. 원본 문서(수급자별, 비공개 저장소의 파일 참조) ─────────────────────────────
create table if not exists source_documents (
  id uuid primary key,
  organization_id text not null,
  recipient_code text not null references recipients(code),
  doc_type text not null check (doc_type in ('care_plan', 'ltc_use_plan', 'fall_assessment', 'pressure_ulcer_assessment',
                                             'cognitive_assessment', 'other_assessment', 'other')),
  title text,
  document_date date,            -- 문서 기준일. 모르면 null(업로드일로 대신하지 않음)
  source_label text,             -- 출처. 모르면 null
  original_filename text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 4194304),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket text not null,
  storage_path text not null unique,
  uploaded_at timestamptz not null,
  uploaded_by_scope text not null,
  uploaded_by_label text,
  replaces_document_id uuid references source_documents(id),
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  withdrawn_at timestamptz,
  withdrawn_reason text,
  withdraw_request_id text,
  version integer not null default 1,
  request_id text not null unique,
  check ((status = 'withdrawn') = (withdrawn_at is not null and withdrawn_reason is not null))
);
create index if not exists source_documents_recipient_idx on source_documents (organization_id, recipient_code, uploaded_at);

-- ── 3. 기준정보(항목별 버전 행 — 수정은 새 버전) ─────────────────────────────────
create table if not exists baseline_entries (
  id uuid primary key,
  organization_id text not null,
  recipient_code text not null references recipients(code),
  lineage_id uuid not null,
  version integer not null check (version >= 1),
  supersedes_entry_id uuid references baseline_entries(id),
  kind text not null check (kind in ('observation_assessment', 'plan_goal', 'scale_result', 'admin_note')),
  domain text,
  statement text,
  value_text text,
  value_numeric numeric,
  unit text,
  tool_name text,
  tool_version text,
  reference_date date,           -- 기준일(척도는 측정일). 모르면 null
  valid_until date,
  source_type text not null check (source_type in ('document', 'admin_input')),
  document_id uuid references source_documents(id),
  page_ref text,
  excerpt text,
  source_note text,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'retracted')),
  created_at timestamptz not null,
  created_by_scope text not null,
  entered_by_label text,
  confirmed_at timestamptz,
  confirmed_by_label text,
  retracted_at timestamptz,
  retract_reason text,
  superseded_at timestamptz,
  status_request_id text,
  row_version integer not null default 1,
  request_id text not null unique,
  unique (lineage_id, version),
  check ((source_type = 'document') = (document_id is not null)),
  check (statement is not null or value_text is not null or value_numeric is not null),
  -- 정식 척도는 도구명·버전·측정값·단위·측정일·출처가 모두 있을 때만(자동 채점 없음)
  check (kind <> 'scale_result' or (tool_name is not null and tool_version is not null and unit is not null
         and reference_date is not null and (value_numeric is not null or value_text is not null)
         and (document_id is not null or source_note is not null))),
  check (valid_until is null or reference_date is null or valid_until >= reference_date),
  check ((status = 'confirmed') <= (confirmed_at is not null)),
  check ((status = 'retracted') = (retracted_at is not null and retract_reason is not null))
);
create index if not exists baseline_entries_recipient_idx on baseline_entries (organization_id, recipient_code);

-- ── 4. 상충 값 중 관리자가 고른 현재 참고값(추가만) ─────────────────────────────
create table if not exists baseline_reference_choices (
  id uuid primary key,
  organization_id text not null,
  recipient_code text not null references recipients(code),
  group_key text not null,
  chosen_entry_id uuid not null references baseline_entries(id),
  reason text not null,
  chosen_at timestamptz not null,
  chosen_by_scope text not null,
  entered_by_label text,
  request_id text not null unique
);

-- ── 5. 조치 ↔ 기준정보 근거 연결(연결 당시 버전 행을 가리킨다) ─────────────────
create table if not exists action_baseline_links (
  id uuid primary key,
  action_id uuid not null references care_actions(id),
  entry_id uuid not null references baseline_entries(id),
  document_id uuid references source_documents(id),
  note text,
  linked_at timestamptz not null,
  linked_by_scope text not null,
  entered_by_label text,
  request_id text not null unique,
  removed_at timestamptz,
  removed_reason text,
  removed_request_id text unique,
  check ((removed_at is null) = (removed_reason is null))
);
create unique index if not exists action_baseline_links_active on action_baseline_links (action_id, entry_id) where removed_at is null;

-- ── 6. 기록 보존 트리거 ───────────────────────────────────────────────────────
drop trigger if exists source_documents_no_delete on source_documents;
create trigger source_documents_no_delete before delete on source_documents for each row execute function workflow_forbid_change();
drop trigger if exists baseline_entries_no_delete on baseline_entries;
create trigger baseline_entries_no_delete before delete on baseline_entries for each row execute function workflow_forbid_change();
drop trigger if exists baseline_reference_choices_append_only on baseline_reference_choices;
create trigger baseline_reference_choices_append_only before update or delete on baseline_reference_choices for each row execute function workflow_forbid_change();
drop trigger if exists action_baseline_links_no_delete on action_baseline_links;
create trigger action_baseline_links_no_delete before delete on action_baseline_links for each row execute function workflow_forbid_change();

create or replace function source_documents_keep_fixed() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['status', 'withdrawn_at', 'withdrawn_reason', 'withdraw_request_id', 'version'])
     is distinct from (to_jsonb(old) - array['status', 'withdrawn_at', 'withdrawn_reason', 'withdraw_request_id', 'version']) then
    raise exception '올린 문서의 원본·메타데이터는 바꿀 수 없습니다(교체본을 새로 올리세요)';
  end if;
  if old.status = 'withdrawn' then
    raise exception '철회된 문서는 되돌리지 않습니다';
  end if;
  return new;
end $$;
drop trigger if exists source_documents_keep_fixed on source_documents;
create trigger source_documents_keep_fixed before update on source_documents for each row execute function source_documents_keep_fixed();

create or replace function baseline_entries_keep_fixed() returns trigger language plpgsql as $$
declare
  v_mutable text[] := array['status', 'confirmed_at', 'confirmed_by_label', 'retracted_at', 'retract_reason', 'superseded_at', 'status_request_id', 'row_version'];
begin
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception '기준정보 내용은 바꿀 수 없습니다(새 버전으로 입력하세요)';
  end if;
  if old.status = 'retracted' and new.status <> 'retracted' then raise exception '철회된 기준정보는 되돌리지 않습니다'; end if;
  if old.status = 'confirmed' and new.status = 'draft' then raise exception '확인된 기준정보를 초안으로 되돌리지 않습니다'; end if;
  if old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at then raise exception '확인 시각은 바꿀 수 없습니다'; end if;
  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then raise exception '이전 버전 표시는 바꿀 수 없습니다'; end if;
  return new;
end $$;
drop trigger if exists baseline_entries_keep_fixed on baseline_entries;
create trigger baseline_entries_keep_fixed before update on baseline_entries for each row execute function baseline_entries_keep_fixed();

create or replace function action_baseline_links_keep_fixed() returns trigger language plpgsql as $$
declare
  v_mutable text[] := array['removed_at', 'removed_reason', 'removed_request_id'];
begin
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) or old.removed_at is not null then
    raise exception '근거 연결 기록은 바꿀 수 없습니다(해제는 한 번만 기록)';
  end if;
  return new;
end $$;
drop trigger if exists action_baseline_links_keep_fixed on action_baseline_links;
create trigger action_baseline_links_keep_fixed before update on action_baseline_links for each row execute function action_baseline_links_keep_fixed();

-- ── 7. 원자적 쓰기(서버만 호출) ───────────────────────────────────────────────
-- 규칙 계산은 shared/baseline.ts가 하고, 이 함수는 잠근 뒤의 최신 상태로 핵심 조건을 다시 확인해 한 트랜잭션에 쓴다.
-- 같은 요청 식별자의 재전송은 'duplicate'로 한 번만 반영된다.
create or replace function baseline_apply(p jsonb) returns jsonb language plpgsql as $$
declare
  v_op text := p->>'op';
  v_doc source_documents%rowtype;
  v_old source_documents%rowtype;
  v_entry baseline_entries%rowtype;
  v_prev baseline_entries%rowtype;
  v_choice baseline_reference_choices%rowtype;
  v_link action_baseline_links%rowtype;
  v_cur action_baseline_links%rowtype;
  v_action care_actions%rowtype;
  v_changed integer;
begin
  if v_op = 'register_document' then
    v_doc := jsonb_populate_record(null::source_documents, p->'document');
    if exists (select 1 from source_documents where request_id = v_doc.request_id) then
      return jsonb_build_object('status', 'duplicate', 'id', (select id from source_documents where request_id = v_doc.request_id));
    end if;
    if not exists (select 1 from recipients where code = v_doc.recipient_code) then
      return jsonb_build_object('status', 'not_found', 'message', '수급자를 찾을 수 없습니다.');
    end if;
    if v_doc.replaces_document_id is not null then
      select * into v_old from source_documents where id = v_doc.replaces_document_id for update;
      if not found or v_old.organization_id <> v_doc.organization_id or v_old.recipient_code <> v_doc.recipient_code then
        return jsonb_build_object('status', 'invalid', 'message', '교체할 문서가 이 수급자의 문서가 아닙니다.');
      end if;
      if v_old.status <> 'active' then return jsonb_build_object('status', 'conflict', 'message', '철회된 문서는 교체할 수 없습니다.'); end if;
    end if;
    insert into source_documents select v_doc.*;
    return jsonb_build_object('status', 'ok', 'id', v_doc.id);

  elsif v_op = 'withdraw_document' then
    select * into v_old from source_documents where id = (p->>'document_id')::uuid and organization_id = p->>'organization_id' for update;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
    if v_old.withdraw_request_id = p->>'request_id' then return jsonb_build_object('status', 'duplicate', 'id', v_old.id); end if;
    if v_old.version <> (p->>'expected_version')::int or v_old.status <> 'active' then return jsonb_build_object('status', 'conflict'); end if;
    update source_documents set status = 'withdrawn', withdrawn_at = (p->>'at')::timestamptz, withdrawn_reason = p->>'reason',
      withdraw_request_id = p->>'request_id', version = v_old.version + 1
    where id = v_old.id;
    return jsonb_build_object('status', 'ok', 'id', v_old.id);

  elsif v_op = 'save_entry' then
    v_entry := jsonb_populate_record(null::baseline_entries, p->'entry');
    if exists (select 1 from baseline_entries where request_id = v_entry.request_id) then
      return jsonb_build_object('status', 'duplicate', 'id', (select id from baseline_entries where request_id = v_entry.request_id));
    end if;
    if not exists (select 1 from recipients where code = v_entry.recipient_code) then
      return jsonb_build_object('status', 'not_found', 'message', '수급자를 찾을 수 없습니다.');
    end if;
    if v_entry.document_id is not null then
      select * into v_old from source_documents where id = v_entry.document_id for share;
      if not found or v_old.organization_id <> v_entry.organization_id or v_old.recipient_code <> v_entry.recipient_code then
        return jsonb_build_object('status', 'invalid', 'message', '근거 문서가 이 수급자의 문서가 아닙니다.');
      end if;
      if v_old.status <> 'active' then return jsonb_build_object('status', 'conflict', 'message', '철회된 문서는 근거로 쓸 수 없습니다.'); end if;
    end if;
    if v_entry.supersedes_entry_id is not null then
      select * into v_prev from baseline_entries where id = v_entry.supersedes_entry_id for update;
      if not found or v_prev.organization_id <> v_entry.organization_id or v_prev.recipient_code <> v_entry.recipient_code
         or v_prev.lineage_id <> v_entry.lineage_id or v_prev.kind <> v_entry.kind then
        return jsonb_build_object('status', 'invalid', 'message', '고칠 기준정보가 올바르지 않습니다.');
      end if;
      if v_prev.status = 'retracted' or v_entry.version <> v_prev.version + 1
         or exists (select 1 from baseline_entries where lineage_id = v_prev.lineage_id and version > v_prev.version) then
        return jsonb_build_object('status', 'conflict');
      end if;
    elsif v_entry.version <> 1 or v_entry.lineage_id <> v_entry.id then
      return jsonb_build_object('status', 'invalid', 'message', '새 항목의 버전 정보가 올바르지 않습니다.');
    end if;
    if v_entry.status <> 'draft' then return jsonb_build_object('status', 'invalid', 'message', '새 기준정보는 미확인 초안으로 저장합니다.'); end if;
    insert into baseline_entries select v_entry.*;
    return jsonb_build_object('status', 'ok', 'id', v_entry.id);

  elsif v_op = 'set_entry_status' then
    select * into v_prev from baseline_entries where id = (p->>'entry_id')::uuid and organization_id = p->>'organization_id' for update;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
    if v_prev.status_request_id = p->>'request_id' then return jsonb_build_object('status', 'duplicate', 'id', v_prev.id); end if;
    if v_prev.row_version <> (p->>'expected_row_version')::int then return jsonb_build_object('status', 'conflict'); end if;
    if p->>'status' = 'confirmed' then
      if v_prev.status <> 'draft' or exists (select 1 from baseline_entries where lineage_id = v_prev.lineage_id and version > v_prev.version) then
        return jsonb_build_object('status', 'conflict');
      end if;
      update baseline_entries set status = 'confirmed', confirmed_at = (p->>'at')::timestamptz, confirmed_by_label = p->>'entered_by_label',
        status_request_id = p->>'request_id', row_version = row_version + 1
      where id = v_prev.id;
      update baseline_entries set superseded_at = (p->>'at')::timestamptz, row_version = row_version + 1
      where lineage_id = v_prev.lineage_id and version < v_prev.version and superseded_at is null;
    elsif p->>'status' = 'retracted' then
      if v_prev.status = 'retracted' or v_prev.superseded_at is not null then return jsonb_build_object('status', 'conflict'); end if;
      update baseline_entries set status = 'retracted', retracted_at = (p->>'at')::timestamptz, retract_reason = p->>'reason',
        status_request_id = p->>'request_id', row_version = row_version + 1
      where id = v_prev.id;
    else
      return jsonb_build_object('status', 'invalid', 'message', '알 수 없는 상태입니다.');
    end if;
    return jsonb_build_object('status', 'ok', 'id', v_prev.id);

  elsif v_op = 'choose_reference' then
    v_choice := jsonb_populate_record(null::baseline_reference_choices, p->'choice');
    if exists (select 1 from baseline_reference_choices where request_id = v_choice.request_id) then
      return jsonb_build_object('status', 'duplicate');
    end if;
    select * into v_prev from baseline_entries where id = v_choice.chosen_entry_id for share;
    if not found or v_prev.organization_id <> v_choice.organization_id or v_prev.recipient_code <> v_choice.recipient_code then
      return jsonb_build_object('status', 'not_found');
    end if;
    if v_prev.status <> 'confirmed' or v_prev.superseded_at is not null then return jsonb_build_object('status', 'conflict'); end if;
    if v_prev.kind = 'admin_note' or v_prev.domain is null
       or v_choice.group_key <> v_prev.kind || '|' || v_prev.domain || '|' || lower(trim(coalesce(v_prev.tool_name, ''))) then
      return jsonb_build_object('status', 'invalid', 'message', '참고값 묶음이 올바르지 않습니다.');
    end if;
    insert into baseline_reference_choices select v_choice.*;
    return jsonb_build_object('status', 'ok', 'id', v_choice.id);

  elsif v_op = 'link_action' then
    v_link := jsonb_populate_record(null::action_baseline_links, p->'link');
    if exists (select 1 from action_baseline_links where request_id = v_link.request_id) then return jsonb_build_object('status', 'duplicate'); end if;
    select * into v_action from care_actions where id = v_link.action_id and organization_id = p->>'organization_id' for update;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
    if v_action.status not in ('draft', 'open') then return jsonb_build_object('status', 'conflict', 'message', '완료·취소된 조치입니다.'); end if;
    select * into v_prev from baseline_entries where id = v_link.entry_id for share;
    if not found or v_prev.organization_id <> v_action.organization_id or v_prev.recipient_code <> v_action.recipient_code then
      return jsonb_build_object('status', 'invalid', 'message', '다른 수급자의 기준정보입니다.');
    end if;
    if v_prev.status <> 'confirmed' or v_prev.superseded_at is not null then return jsonb_build_object('status', 'conflict', 'message', '관리자 확인된 현재 버전만 연결합니다.'); end if;
    v_link.document_id := v_prev.document_id;  -- 연결 당시 근거 문서를 함께 남긴다
    begin
      insert into action_baseline_links select v_link.*;
      insert into action_events select * from jsonb_populate_record(null::action_events, p->'event');
    exception when unique_violation then
      return jsonb_build_object('status', 'conflict', 'message', '이미 연결된 기준정보입니다.');
    end;
    return jsonb_build_object('status', 'ok', 'id', v_link.id);

  elsif v_op = 'unlink_action' then
    select l.* into v_cur from action_baseline_links l join care_actions a on a.id = l.action_id
    where l.id = (p->>'link_id')::uuid and a.organization_id = p->>'organization_id' for update of l;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
    if v_cur.removed_request_id = p->>'request_id' then return jsonb_build_object('status', 'duplicate'); end if;
    select * into v_action from care_actions where id = v_cur.action_id for update;
    if v_cur.removed_at is not null or v_action.status not in ('draft', 'open') then return jsonb_build_object('status', 'conflict'); end if;
    update action_baseline_links set removed_at = (p->>'at')::timestamptz, removed_reason = p->>'reason', removed_request_id = p->>'request_id'
    where id = v_cur.id;
    get diagnostics v_changed = row_count;
    insert into action_events select * from jsonb_populate_record(null::action_events, p->'event');
    return jsonb_build_object('status', 'ok', 'id', v_cur.id);
  end if;
  return jsonb_build_object('status', 'invalid', 'message', '알 수 없는 요청입니다.');
exception when unique_violation then
  return jsonb_build_object('status', 'duplicate');
end $$;

-- ── 8. 원본 파일 저장소: 비공개 버킷(브라우저 키로는 읽기·쓰기 불가, 서버만 접근) ────────
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('care-source-documents', 'care-source-documents', false, 4194304, array['application/pdf', 'image/jpeg', 'image/png'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- ── 9. 접근: 브라우저 키는 막고 서버(Service Role)만 쓴다 ─────────────────────────
alter table source_documents enable row level security;
alter table baseline_entries enable row level security;
alter table baseline_reference_choices enable row level security;
alter table action_baseline_links enable row level security;

revoke all on function baseline_apply(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function baseline_apply(jsonb) from anon';
    execute 'revoke all on source_documents, baseline_entries, baseline_reference_choices, action_baseline_links from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function baseline_apply(jsonb) from authenticated';
    execute 'revoke all on source_documents, baseline_entries, baseline_reference_choices, action_baseline_links from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function baseline_apply(jsonb) to service_role';
    execute 'grant all on source_documents, baseline_entries, baseline_reference_choices, action_baseline_links to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
