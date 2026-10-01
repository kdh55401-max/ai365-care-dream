-- 2026-10-03 · 직원(담당 요양보호사) 변경 상담일지
--
-- 적용 방법: Supabase 대시보드 > SQL Editor에 이 파일 전체를 붙여 한 번 실행한다(여러 번 실행해도 안전).
-- 선행 조건: 2026-10-02-recipient-registration.sql 이 먼저 적용되어 있어야 한다(recipient_admin_log 표를 참조한다).
-- 성격: 추가형 — 새 표 1개(staff_change_notes)와 쓰기 함수 1개(staff_change_note_save)만 만든다. 기존 표·행·함수는 바꾸지 않는다.
-- 앱 호환: 이 마이그레이션 없이도 기존 화면은 그대로 동작한다(수급자 관리의 상담일지 구역만 "준비 중").
-- 되돌리기: 앱을 이전 배포로 되돌린다. 일지가 쌓인 뒤에는 표를 지우지 말 것(평가 때 확인하는 기록이다).
--
-- 일지는 "담당이 해제된 변경"(recipient_admin_log.detail.caregivers_removed 가 비어 있지 않은 'updated' 이벤트) 하나에 하나씩 붙는다.
-- 변경 사실(전/후 담당)은 그 이력에서 가져오고, 사유·상담 방법·대상자(관계)·안내 및 동의 내용은 사람이 입력한다.
-- 수급자(보호자)의 의견·동의 여부는 글이 아니라 선택값(consent: agreed / agreed_with_opinion / not_agreed / not_reached)으로 저장한다 — 확정하려면 반드시 있어야 한다.
-- (이 파일을 먼저 적용한 DB에서 다시 실행해도 consent 컬럼·제약·함수가 안전하게 추가·교체된다.)
-- 확정(confirmed)된 일지는 수정·삭제할 수 없다(수정이 필요하면 새 기록이 아니라 사유와 함께 별도 협의 — 지금은 지원하지 않는다).
--
-- 적용 후 확인(모두 true인지 본다):
--   select exists(select 1 from information_schema.tables where table_name='staff_change_notes') as notes_table,
--          exists(select 1 from pg_proc where proname = 'staff_change_note_save') as save_fn;

create table if not exists staff_change_notes (
  id bigserial primary key,
  change_log_id bigint not null unique references recipient_admin_log(id),
  recipient_code text not null references recipients(code),
  changed_on date not null,
  from_caregivers text[] not null default '{}',
  to_caregivers text[] not null default '{}',
  reason text not null default '',
  counsel_method text check (counsel_method is null or counsel_method in ('visit', 'phone', 'other')),
  counselee_relation text not null default '',
  content text not null default '',
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_change_notes_lengths check (
    char_length(reason) <= 500 and char_length(content) <= 2000 and char_length(counselee_relation) <= 30
  )
);

-- 의견·동의 여부(선택값). 예전 버전을 먼저 적용한 DB에서도 다시 실행하면 추가된다.
alter table staff_change_notes add column if not exists consent text;
alter table staff_change_notes drop constraint if exists staff_change_notes_consent_values;
alter table staff_change_notes add constraint staff_change_notes_consent_values
  check (consent is null or consent in ('agreed', 'agreed_with_opinion', 'not_agreed', 'not_reached')) not valid;
-- 확정하려면 필수 항목(동의 여부 포함)이 모두 채워져 있어야 한다. not valid = 이미 확정된 예전 행은 건드리지 않고 새 확정부터 적용.
alter table staff_change_notes drop constraint if exists staff_change_notes_confirmed_complete;
alter table staff_change_notes add constraint staff_change_notes_confirmed_complete
  check (
    status <> 'confirmed'
    or (btrim(reason) <> '' and counsel_method is not null and consent is not null and btrim(counselee_relation) <> '' and btrim(content) <> '' and confirmed_at is not null)
  ) not valid;
create index if not exists staff_change_notes_recipient_idx on staff_change_notes (recipient_code, changed_on);

-- 확정된 일지는 바꾸거나 지울 수 없다.
create or replace function staff_change_notes_forbid_confirmed_change() returns trigger language plpgsql as $$
begin
  if old.status = 'confirmed' then
    raise exception '확정된 상담일지는 수정하거나 삭제할 수 없습니다.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists staff_change_notes_confirmed_lock on staff_change_notes;
create trigger staff_change_notes_confirmed_lock before update or delete on staff_change_notes
  for each row execute function staff_change_notes_forbid_confirmed_change();

-- 초안 저장 또는 확정. 일지가 없으면 변경 이력에서 전/후 담당을 가져와 만들고, 있으면 수정한다(행 잠금·충돌 검사).
-- p: change_log_id, changed_on, reason, counsel_method, counselee_relation, content, confirm(boolean), expected_updated_at
create or replace function staff_change_note_save(p jsonb) returns jsonb language plpgsql as $$
declare
  v_log_id bigint := nullif(p->>'change_log_id', '')::bigint;
  v_log recipient_admin_log%rowtype;
  v_note staff_change_notes%rowtype;
  v_changed_on date;
  v_reason text := btrim(coalesce(p->>'reason', ''));
  v_method text := nullif(btrim(coalesce(p->>'counsel_method', '')), '');
  v_consent text := nullif(btrim(coalesce(p->>'consent', '')), '');
  v_relation text := btrim(coalesce(p->>'counselee_relation', ''));
  v_content text := btrim(coalesce(p->>'content', ''));
  v_confirm boolean := coalesce((p->>'confirm')::boolean, false);
  v_from text[];
  v_to text[];
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_saved staff_change_notes%rowtype;
begin
  if v_log_id is null then
    return jsonb_build_object('status', 'invalid', 'message', '담당 변경 번호가 올바르지 않습니다.');
  end if;
  perform pg_advisory_xact_lock(hashtext('staff_change_note:' || v_log_id::text));

  select * into v_log from recipient_admin_log where id = v_log_id and event_type = 'updated';
  if not found then
    return jsonb_build_object('status', 'not_found', 'message', '담당 변경 기록을 찾을 수 없습니다.');
  end if;
  v_from := coalesce(array(select jsonb_array_elements_text(coalesce(v_log.detail->'caregivers_removed', '[]'::jsonb))), '{}');
  v_to := coalesce(array(select jsonb_array_elements_text(coalesce(v_log.detail->'caregivers_added', '[]'::jsonb))), '{}');
  if cardinality(v_from) = 0 then
    return jsonb_build_object('status', 'not_found', 'message', '담당자가 바뀐 변경에만 상담일지를 쓸 수 있습니다.');
  end if;

  begin
    v_changed_on := (p->>'changed_on')::date;
  exception when others then
    return jsonb_build_object('status', 'invalid', 'message', '변경일자를 날짜로 입력해 주세요.');
  end;
  if v_changed_on is null then
    return jsonb_build_object('status', 'invalid', 'message', '변경일자를 날짜로 입력해 주세요.');
  end if;
  if v_changed_on > v_today then
    return jsonb_build_object('status', 'invalid', 'message', '변경일자는 오늘보다 뒤일 수 없습니다.');
  end if;
  if v_method is not null and v_method not in ('visit', 'phone', 'other') then
    return jsonb_build_object('status', 'invalid', 'message', '상담 방법이 올바르지 않습니다.');
  end if;
  if v_consent is not null and v_consent not in ('agreed', 'agreed_with_opinion', 'not_agreed', 'not_reached') then
    return jsonb_build_object('status', 'invalid', 'message', '의견·동의 여부 값이 올바르지 않습니다.');
  end if;
  if char_length(v_reason) > 500 or char_length(v_content) > 2000 or char_length(v_relation) > 30 then
    return jsonb_build_object('status', 'invalid', 'message', '입력한 글이 너무 깁니다.');
  end if;
  if v_confirm and (v_reason = '' or v_method is null or v_consent is null or v_relation = '' or v_content = '') then
    return jsonb_build_object('status', 'invalid', 'message', '확정하려면 변경 사유·상담 방법·상담 대상자(관계)·의견·동의 여부·상담 내용을 모두 입력해 주세요.');
  end if;

  select * into v_note from staff_change_notes where change_log_id = v_log_id for update;
  if not found then
    if nullif(p->>'expected_updated_at', '') is not null then
      return jsonb_build_object('status', 'conflict', 'message', '다른 곳에서 먼저 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.');
    end if;
    insert into staff_change_notes (change_log_id, recipient_code, changed_on, from_caregivers, to_caregivers, reason, counsel_method,
                                    consent, counselee_relation, content, status, confirmed_at)
      values (v_log_id, v_log.recipient_code, v_changed_on, v_from, v_to, v_reason, v_method, v_consent, v_relation, v_content,
              case when v_confirm then 'confirmed' else 'draft' end, case when v_confirm then now() end)
      returning * into v_saved;
  else
    if v_note.status = 'confirmed' then
      return jsonb_build_object('status', 'locked', 'message', '이미 확정된 상담일지는 수정할 수 없습니다.');
    end if;
    if nullif(p->>'expected_updated_at', '') is null
       or v_note.updated_at <> (p->>'expected_updated_at')::timestamptz then
      return jsonb_build_object('status', 'conflict', 'message', '다른 곳에서 먼저 수정되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.');
    end if;
    update staff_change_notes
       set changed_on = v_changed_on, reason = v_reason, counsel_method = v_method, consent = v_consent, counselee_relation = v_relation, content = v_content,
           status = case when v_confirm then 'confirmed' else 'draft' end,
           confirmed_at = case when v_confirm then now() end,
           updated_at = clock_timestamp()
     where id = v_note.id
     returning * into v_saved;
  end if;
  return jsonb_build_object('status', 'ok', 'change_log_id', v_saved.change_log_id, 'note_status', v_saved.status,
                            'updated_at', to_char(v_saved.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;

-- 모든 접근은 서버(Service Role)만. 브라우저(anon·authenticated)에는 열지 않는다.
alter table staff_change_notes enable row level security;
revoke all on function staff_change_note_save(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function staff_change_note_save(jsonb) from anon';
    execute 'revoke all on staff_change_notes from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function staff_change_note_save(jsonb) from authenticated';
    execute 'revoke all on staff_change_notes from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function staff_change_note_save(jsonb) to service_role';
    execute 'grant all on staff_change_notes to service_role';
    execute 'grant usage, select on sequence staff_change_notes_id_seq to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
