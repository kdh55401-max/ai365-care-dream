-- 2026-10-03 · ERP 전환 2단계: 수급자 인적사항(이름·장기요양인정번호·등급·유효기간 등)
--
-- 적용 방법: Supabase 대시보드 > SQL Editor에 이 파일 전체를 붙여 한 번 실행한다(여러 번 실행해도 안전).
-- 선행 조건: db/migrations/2026-10-02-recipient-registration.sql 을 먼저 적용해야 한다(recipient_register/update 함수를 감싼다).
-- 성격: 추가형 — 기존 행·컬럼·보고를 바꾸거나 지우지 않는다.
--   · recipients 에 인적사항 컬럼 추가(full_name, birth_date, ltc_number, ltc_grade, ltc_valid_from, ltc_valid_to, address, phone)
--   · 장기요양인정번호는 중복 불가(값이 있을 때만)
--   · recipient_register_erp / recipient_update_erp: 기존 등록·수정 함수 + 인적사항을 한 트랜잭션으로 저장
--     (인적사항이 잘못되면 등록·배정도 함께 취소된다)
-- 개인정보: 이 값들은 실제 수급자 정보다. 관리자 서버(Service Role)만 읽고 쓰며 브라우저(anon)에는 열지 않는다.
--           변경 이력(recipient_admin_log)에는 값이 아니라 바뀐 항목 이름만 남긴다.
--
-- 적용 후 확인(모두 true인지 본다):
--   select exists(select 1 from information_schema.columns where table_name='recipients' and column_name='ltc_number') as ltc_column,
--          exists(select 1 from pg_proc where proname = 'recipient_register_erp') as register_erp_fn,
--          exists(select 1 from pg_proc where proname = 'recipient_update_erp') as update_erp_fn;

alter table recipients add column if not exists full_name text;
alter table recipients add column if not exists birth_date date;
alter table recipients add column if not exists ltc_number text;
alter table recipients add column if not exists ltc_grade text;
alter table recipients add column if not exists ltc_valid_from date;
alter table recipients add column if not exists ltc_valid_to date;
alter table recipients add column if not exists address text;
alter table recipients add column if not exists phone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipients_ltc_number_format') then
    alter table recipients add constraint recipients_ltc_number_format
      check (ltc_number is null or ltc_number ~ '^L[0-9]{10}-[0-9]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipients_ltc_grade_values') then
    alter table recipients add constraint recipients_ltc_grade_values
      check (ltc_grade is null or ltc_grade in ('1등급', '2등급', '3등급', '4등급', '5등급', '인지지원등급'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipients_ltc_valid_order') then
    alter table recipients add constraint recipients_ltc_valid_order
      check (ltc_valid_from is null or ltc_valid_to is null or ltc_valid_from <= ltc_valid_to);
  end if;
end $$;

create unique index if not exists recipients_ltc_number_uniq on recipients (ltc_number) where ltc_number is not null;

-- 인적사항을 반영한다. prof에 키가 있으면 그 값으로 바꾸고(빈 문자열은 비움), 없는 키는 그대로 둔다.
-- 문제가 없으면 null, 있으면 사용자에게 보일 문장을 돌려준다(호출한 쪽이 그 문장으로 전체를 취소한다).
create or replace function recipient_profile_apply(v_code text, prof jsonb) returns text language plpgsql as $$
declare
  r recipients%rowtype;
  v_full text; v_birth date; v_ltc text; v_grade text; v_from date; v_to date; v_addr text; v_phone text;
  v_changed jsonb := '[]'::jsonb;
begin
  if prof is null or jsonb_typeof(prof) <> 'object' then return null; end if;
  select * into r from recipients where code = v_code for update;
  if not found then return '수급자를 찾을 수 없습니다.'; end if;

  v_full  := case when prof ? 'full_name'      then nullif(btrim(prof->>'full_name'), '')      else r.full_name end;
  v_ltc   := case when prof ? 'ltc_number'     then upper(nullif(btrim(prof->>'ltc_number'), '')) else r.ltc_number end;
  v_grade := case when prof ? 'ltc_grade'      then nullif(btrim(prof->>'ltc_grade'), '')      else r.ltc_grade end;
  v_addr  := case when prof ? 'address'        then nullif(btrim(prof->>'address'), '')        else r.address end;
  v_phone := case when prof ? 'phone'          then nullif(btrim(prof->>'phone'), '')          else r.phone end;
  begin
    v_birth := case when prof ? 'birth_date'     then nullif(btrim(prof->>'birth_date'), '')::date     else r.birth_date end;
    v_from  := case when prof ? 'ltc_valid_from' then nullif(btrim(prof->>'ltc_valid_from'), '')::date else r.ltc_valid_from end;
    v_to    := case when prof ? 'ltc_valid_to'   then nullif(btrim(prof->>'ltc_valid_to'), '')::date   else r.ltc_valid_to end;
  exception when others then
    return '날짜 형식이 올바르지 않습니다(예: 1956-02-24).';
  end;

  if v_full is not null and char_length(v_full) > 30 then return '이름은 30자 이내로 입력해 주세요.'; end if;
  if v_ltc is not null and v_ltc !~ '^L[0-9]{10}-[0-9]{3}$' then return '장기요양인정번호 형식이 올바르지 않습니다(예: L0011097739-103).'; end if;
  if v_grade is not null and v_grade not in ('1등급', '2등급', '3등급', '4등급', '5등급', '인지지원등급') then return '장기요양등급 값이 올바르지 않습니다.'; end if;
  if v_from is not null and v_to is not null and v_from > v_to then return '인정 유효기간의 시작일이 종료일보다 늦습니다.'; end if;
  if v_addr is not null and char_length(v_addr) > 200 then return '주소는 200자 이내로 입력해 주세요.'; end if;
  if v_phone is not null and (char_length(v_phone) > 20 or v_phone !~ '^[0-9+() -]+$') then return '전화번호는 숫자와 하이픈만 20자 이내로 입력해 주세요.'; end if;

  if v_full  is distinct from r.full_name      then v_changed := v_changed || '"full_name"'::jsonb; end if;
  if v_birth is distinct from r.birth_date     then v_changed := v_changed || '"birth_date"'::jsonb; end if;
  if v_ltc   is distinct from r.ltc_number     then v_changed := v_changed || '"ltc_number"'::jsonb; end if;
  if v_grade is distinct from r.ltc_grade      then v_changed := v_changed || '"ltc_grade"'::jsonb; end if;
  if v_from  is distinct from r.ltc_valid_from then v_changed := v_changed || '"ltc_valid_from"'::jsonb; end if;
  if v_to    is distinct from r.ltc_valid_to   then v_changed := v_changed || '"ltc_valid_to"'::jsonb; end if;
  if v_addr  is distinct from r.address        then v_changed := v_changed || '"address"'::jsonb; end if;
  if v_phone is distinct from r.phone          then v_changed := v_changed || '"phone"'::jsonb; end if;

  update recipients set full_name = v_full, birth_date = v_birth, ltc_number = v_ltc, ltc_grade = v_grade,
    ltc_valid_from = v_from, ltc_valid_to = v_to, address = v_addr, phone = v_phone, updated_at = now()
    where code = v_code;
  if jsonb_array_length(v_changed) > 0 then
    insert into recipient_admin_log (recipient_code, event_type, detail)
      values (v_code, 'updated', jsonb_build_object('changed', v_changed, 'profile', true));
  end if;
  return null;
end $$;

-- 등록 + 인적사항 + 배정을 한 트랜잭션으로. 인적사항 문제·인정번호 중복이면 등록·배정도 남지 않는다.
create or replace function recipient_register_erp(p jsonb) returns jsonb language plpgsql as $$
declare r jsonb; msg text;
begin
  r := recipient_register(p);
  if r->>'status' = 'ok' and p ? 'profile' then
    msg := recipient_profile_apply(r->>'code', p->'profile');
    if msg is not null then raise exception 'profile_invalid:%', msg; end if;
  end if;
  return r;
exception
  when unique_violation then
    return jsonb_build_object('status', 'duplicate_ltc', 'message', '이미 등록된 장기요양인정번호입니다.');
  when others then
    if sqlerrm like 'profile_invalid:%' then
      return jsonb_build_object('status', 'invalid', 'message', substring(sqlerrm from 17));
    end if;
    raise;
end $$;

create or replace function recipient_update_erp(p jsonb) returns jsonb language plpgsql as $$
declare r jsonb; msg text;
begin
  r := recipient_update(p);
  if r->>'status' = 'ok' and p ? 'profile' then
    msg := recipient_profile_apply(r->>'code', p->'profile');
    if msg is not null then raise exception 'profile_invalid:%', msg; end if;
  end if;
  return r;
exception
  when unique_violation then
    return jsonb_build_object('status', 'duplicate_ltc', 'message', '이미 등록된 장기요양인정번호입니다.');
  when others then
    if sqlerrm like 'profile_invalid:%' then
      return jsonb_build_object('status', 'invalid', 'message', substring(sqlerrm from 17));
    end if;
    raise;
end $$;

revoke all on function recipient_profile_apply(text, jsonb) from public;
revoke all on function recipient_register_erp(jsonb) from public;
revoke all on function recipient_update_erp(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function recipient_profile_apply(text, jsonb) from anon';
    execute 'revoke all on function recipient_register_erp(jsonb) from anon';
    execute 'revoke all on function recipient_update_erp(jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function recipient_profile_apply(text, jsonb) from authenticated';
    execute 'revoke all on function recipient_register_erp(jsonb) from authenticated';
    execute 'revoke all on function recipient_update_erp(jsonb) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function recipient_profile_apply(text, jsonb) to service_role';
    execute 'grant execute on function recipient_register_erp(jsonb) to service_role';
    execute 'grant execute on function recipient_update_erp(jsonb) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── 복구 ─────────────────────────────────────────────────────────────────
-- 앱을 이전 배포로 되돌린다. 추가된 컬럼·함수는 이전 앱에 영향이 없다. 잘못 입력한 인적사항은 관리자 화면에서 고치거나
-- update recipients set ltc_number = null where code = '…'; 처럼 해당 값만 비운다(수급자 행 자체는 삭제하지 않는다).
