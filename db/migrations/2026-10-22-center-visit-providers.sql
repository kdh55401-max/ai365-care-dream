-- Additive provider validation. Source: authenticated-patient/inline-25.js:248-250.
-- This is an observed plan/UI rule, not a billing eligibility determination.
begin;
create function public.validate_center_visit_providers() returns trigger
language plpgsql set search_path='' as $$
declare provider_json jsonb; provider_ids uuid[]; provider_count integer; matched_count integer; expected_count integer;
begin
 -- Pure archive must keep working for historical single-provider bath records.
 if tg_op='UPDATE' then
  if not old.archived and new.archived and new.data is not distinct from old.data
   and new.worker_id=old.worker_id and new.patient_id=old.patient_id
   and new.organization_code=old.organization_code and new.id=old.id then return new; end if;
 end if;
 if jsonb_typeof(new.data->'service') is distinct from 'string'
  or nullif(btrim(new.data->>'service'),'') is null then raise exception 'CENTER_OP_400 invalid visit service';end if;
 expected_count:=case when btrim(new.data->>'service') in ('목욕','방문목욕') then 2 else 1 end;
 provider_json:=case when new.data ? 'workerIds' then new.data->'workerIds' else jsonb_build_array(new.worker_id::text) end;
 if jsonb_typeof(provider_json) is distinct from 'array' then raise exception 'CENTER_OP_400 workerIds array required';end if;
 provider_count:=jsonb_array_length(provider_json);
 if provider_count<>expected_count then raise exception 'CENTER_OP_400 invalid provider count';end if;
 if exists(select 1 from jsonb_array_elements(provider_json) entry(value)
  where jsonb_typeof(entry.value) is distinct from 'string' or (entry.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 then raise exception 'CENTER_OP_400 invalid provider identifier';end if;
 select array_agg((entry.value #>> '{}')::uuid order by entry.ordinality) into provider_ids
 from jsonb_array_elements(provider_json) with ordinality entry(value,ordinality);
 if (select count(distinct provider_id) from unnest(provider_ids) ids(provider_id))<>provider_count then raise exception 'CENTER_OP_400 duplicate provider';end if;
 if provider_ids[1] is distinct from new.worker_id then raise exception 'CENTER_OP_400 primary provider mismatch';end if;
 if jsonb_typeof(new.data->'workerId') is distinct from 'string'
  or (new.data->>'workerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or (new.data->>'workerId')::uuid is distinct from new.worker_id then raise exception 'CENTER_OP_400 primary provider mismatch';end if;
 -- RPC holds the same center-operations:org advisory lock as people/imports/documents.
 perform 1 from public.center_people where organization_code=new.organization_code
  and id=any(provider_ids) and kind='worker' and not archived order by id for share;
 get diagnostics matched_count=row_count;
 if matched_count<>provider_count then raise exception 'CENTER_OP_400 invalid active provider reference';end if;
 new.data:=jsonb_set(new.data,'{workerIds}',to_jsonb(provider_ids),true);
 return new;
exception when invalid_text_representation then raise exception 'CENTER_OP_400 invalid provider identifier';
end$$;
create trigger center_visits_providers_guard before insert or update on public.center_visits
for each row execute function public.validate_center_visit_providers();
revoke all on function public.validate_center_visit_providers() from public,anon,authenticated,service_role;

create function public.guard_center_person_provider_archive() returns trigger
language plpgsql set search_path='' as $$
begin
 if not old.archived and new.archived and exists(
  select 1 from public.center_visits visit where visit.organization_code=old.organization_code and not visit.archived
   and (visit.worker_id=old.id or visit.patient_id=old.id or exists(
    select 1 from jsonb_array_elements_text(case when jsonb_typeof(visit.data->'workerIds')='array' then visit.data->'workerIds' else '[]'::jsonb end) provider(id)
    where lower(provider.id)=old.id::text)))
 then raise exception 'CENTER_OP_409 active visit provider reference';end if;
 return new;
end$$;
create trigger center_people_provider_archive_guard before update on public.center_people
for each row execute function public.guard_center_person_provider_archive();
revoke all on function public.guard_center_person_provider_archive() from public,anon,authenticated,service_role;
-- A new application must fail closed if this migration has not been applied.
create function public.center_visit_provider_support() returns integer
language sql stable set search_path='' as $$select 1$$;
revoke all on function public.center_visit_provider_support() from public,anon,authenticated;
grant execute on function public.center_visit_provider_support() to service_role;
commit;
