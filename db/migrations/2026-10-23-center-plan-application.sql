-- Additive after operations, visit-providers and weekly-plans. Planned visits only.
begin;
do $$begin
 if to_regprocedure('public.center_visit_provider_support()') is null or to_regclass('public.center_weekly_plans') is null then raise exception 'Apply visit-provider and weekly-plan migrations first';end if;
end$$;
create unique index center_weekly_plans_org_id_apply on public.center_weekly_plans(organization_code,id);
create unique index center_visits_org_id_apply on public.center_visits(organization_code,id);
create index center_visits_org_date_apply on public.center_visits(organization_code,(data->>'date')) where not archived;
create table public.center_plan_visit_origins(
 organization_code text not null references public.center_organizations(code),plan_id uuid not null,entry_id uuid not null,visit_date date not null,visit_id uuid not null,
 plan_version integer not null check(plan_version>0),disposition text not null check(disposition in ('created','existing_exact')),created_at timestamptz not null default now(),
 primary key(organization_code,plan_id,entry_id,visit_date),
 foreign key(organization_code,plan_id) references public.center_weekly_plans(organization_code,id),
 foreign key(organization_code,visit_id) references public.center_visits(organization_code,id)
);
create table public.center_plan_application_requests(organization_code text not null references public.center_organizations(code),request_id uuid not null,actor_id text not null,mutation jsonb not null,response jsonb not null,created_at timestamptz not null default now(),primary key(organization_code,request_id));
alter table public.center_plan_visit_origins enable row level security;
alter table public.center_plan_application_requests enable row level security;
revoke all on public.center_plan_visit_origins,public.center_plan_application_requests from public,anon,authenticated,service_role;
grant select on public.center_plan_visit_origins to service_role;
create policy center_plan_origins_service_read on public.center_plan_visit_origins for select to service_role using(true);
create function public.guard_center_plan_visit_origin() returns trigger language plpgsql set search_path='' as $$begin raise exception 'CENTER_APPLY_409 application provenance is immutable';end$$;
create trigger center_plan_origins_guard before update or delete on public.center_plan_visit_origins for each row execute function public.guard_center_plan_visit_origin();
revoke all on function public.guard_center_plan_visit_origin() from public,anon,authenticated,service_role;
create function public.apply_center_weekly_plan(p_organization_code text,p_actor_id text,p_mutation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare req uuid;plan_uuid uuid;expected integer;plan_row public.center_weekly_plans%rowtype;receipt public.center_plan_application_requests%rowtype;
 item jsonb;entry_uuid uuid;seen_entries uuid[]:='{}'::uuid[];provider_ids uuid[];existing_providers uuid[];matched integer;
 day_value date;first_day date;last_day date;start_clock time;end_clock time;minutes_value integer;
 candidate_start timestamp;candidate_end timestamp;other_start timestamp;other_end timestamp;other_minutes integer;other_service text;
 existing_exact uuid;new_visit uuid;visit_row public.center_visits%rowtype;created integer:=0;skipped integer:=0;new_ids uuid[]:='{}'::uuid[];payload jsonb;result jsonb;
 uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 if p_actor_id is null or btrim(p_actor_id)='' or jsonb_typeof(p_mutation) is distinct from 'object' then raise exception 'CENTER_APPLY_400 invalid actor/mutation';end if;
 if exists(select 1 from jsonb_object_keys(p_mutation) f(key) where not(f.key=any(array['requestId','planId','expectedVersion']))) then raise exception 'CENTER_APPLY_400 unsupported fields';end if;
 if jsonb_typeof(p_mutation->'requestId') is distinct from 'string' or (p_mutation->>'requestId') !~* uuid_pattern or jsonb_typeof(p_mutation->'planId') is distinct from 'string' or (p_mutation->>'planId') !~* uuid_pattern or jsonb_typeof(p_mutation->'expectedVersion') is distinct from 'number' or (p_mutation->>'expectedVersion') !~ '^[1-9][0-9]*$' then raise exception 'CENTER_APPLY_400 request/plan/version';end if;
 req:=(p_mutation->>'requestId')::uuid;plan_uuid:=(p_mutation->>'planId')::uuid;expected:=(p_mutation->>'expectedVersion')::integer;
 perform 1 from public.center_organizations where code=p_organization_code and active for share;
 if not found then raise exception 'CENTER_APPLY_403 inactive organization';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into receipt from public.center_plan_application_requests where organization_code=p_organization_code and request_id=req;
 if found then
  if receipt.actor_id<>p_actor_id or receipt.mutation<>p_mutation then raise exception 'CENTER_APPLY_409 reused request';end if;
  return receipt.response;
 end if;
 select * into plan_row from public.center_weekly_plans where organization_code=p_organization_code and id=plan_uuid for share;
 if not found then raise exception 'CENTER_APPLY_404 plan not found';end if;
 if plan_row.archived or plan_row.version<>expected then raise exception 'CENTER_APPLY_409 stale/archived plan';end if;
 perform 1 from public.center_people where organization_code=p_organization_code and id=plan_row.patient_id and kind='patient' and not archived for share;
 if not found then raise exception 'CENTER_APPLY_400 inactive patient';end if;
 first_day:=(plan_row.month||'-01')::date;last_day:=(first_day+interval '1 month'-interval '1 day')::date;
 -- Validate every source before any visit write; nursingDual never exempts monthly clashes.
 for item in select value from jsonb_array_elements(plan_row.entries) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'string' or (item->>'id') !~* uuid_pattern or jsonb_typeof(item->'service') is distinct from 'string' or (item->>'service') not in ('요양','간호','목욕') or jsonb_typeof(item->'start') is distinct from 'string' or (item->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(item->'end') is distinct from 'string' or (item->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or item->>'start'=item->>'end' or jsonb_typeof(item->'weekdays') is distinct from 'array' or jsonb_typeof(item->'workerIds') is distinct from 'array' then raise exception 'CENTER_APPLY_400 invalid source entry';end if;
  entry_uuid:=(item->>'id')::uuid;
  if entry_uuid=any(seen_entries) then raise exception 'CENTER_APPLY_400 duplicate source entry';end if;
  seen_entries:=array_append(seen_entries,entry_uuid);
  if jsonb_array_length(item->'weekdays') not between 1 and 7 or exists(select 1 from jsonb_array_elements(item->'weekdays') d(value) where jsonb_typeof(d.value) is distinct from 'number' or (d.value#>>'{}') !~ '^[0-6]$') or (select count(distinct d.value) from jsonb_array_elements(item->'weekdays') d(value))<>jsonb_array_length(item->'weekdays') then raise exception 'CENTER_APPLY_400 invalid source weekdays';end if;
  if jsonb_array_length(item->'workerIds')<>(case when item->>'service'='목욕' then 2 else 1 end) or exists(select 1 from jsonb_array_elements(item->'workerIds') w(value) where jsonb_typeof(w.value) is distinct from 'string' or (w.value#>>'{}') !~* uuid_pattern) then raise exception 'CENTER_APPLY_400 invalid source workers';end if;
  select array_agg((w.value#>>'{}')::uuid order by w.ordinality) into provider_ids from jsonb_array_elements(item->'workerIds') with ordinality w(value,ordinality);
  if (select count(distinct id) from unnest(provider_ids) workers(id))<>cardinality(provider_ids) then raise exception 'CENTER_APPLY_400 duplicate source worker';end if;
  perform 1 from public.center_people where organization_code=p_organization_code and id=any(provider_ids) and kind='worker' and not archived order by id for share;
  get diagnostics matched=row_count;
  if matched<>cardinality(provider_ids) then raise exception 'CENTER_APPLY_400 inactive source worker';end if;
 end loop;
 for day_value in select first_day+offset_value from generate_series(0,last_day-first_day) offsets(offset_value) loop
  for item in select value from jsonb_array_elements(plan_row.entries) where value->'weekdays' @> jsonb_build_array(extract(dow from day_value)::integer) loop
   entry_uuid:=(item->>'id')::uuid;
   if exists(select 1 from public.center_plan_visit_origins where organization_code=p_organization_code and plan_id=plan_uuid and entry_id=entry_uuid and visit_date=day_value) then skipped:=skipped+1;continue;end if;
   select array_agg((w.value#>>'{}')::uuid order by w.ordinality) into provider_ids from jsonb_array_elements(item->'workerIds') with ordinality w(value,ordinality);
   start_clock:=(item->>'start')::time;end_clock:=(item->>'end')::time;minutes_value:=(extract(epoch from(end_clock-start_clock))/60)::integer;
   if minutes_value<0 then minutes_value:=minutes_value+1440;end if;
   candidate_start:=day_value+start_clock;candidate_end:=candidate_start+make_interval(mins=>minutes_value);existing_exact:=null;
   -- One prior/next date covers overnight intervals (visits limited to <=1440 min).
   for visit_row in select * from public.center_visits where organization_code=p_organization_code and not archived and data->>'date'>=(day_value-1)::text and data->>'date'<=(day_value+1)::text loop
    if (visit_row.data->>'date') is null or (visit_row.data->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (visit_row.data->>'time') is null or (visit_row.data->>'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (visit_row.data->>'minutes') is null or (visit_row.data->>'minutes') !~ '^[1-9][0-9]*$' then raise exception 'CENTER_APPLY_503 malformed existing visit';end if;
    begin
     other_start:=(visit_row.data->>'date')::date+(visit_row.data->>'time')::time;other_minutes:=(visit_row.data->>'minutes')::integer;
    exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'CENTER_APPLY_503 malformed existing visit';end;
    if other_minutes not between 1 and 1440 then raise exception 'CENTER_APPLY_503 invalid existing duration';end if;
    other_end:=other_start+make_interval(mins=>other_minutes);
    if not(candidate_start<other_end and other_start<candidate_end) then continue;end if;
    if visit_row.data ? 'workerIds' then
     if jsonb_typeof(visit_row.data->'workerIds') is distinct from 'array' or jsonb_array_length(visit_row.data->'workerIds') not between 1 and 2 or exists(select 1 from jsonb_array_elements(visit_row.data->'workerIds') w(value) where jsonb_typeof(w.value) is distinct from 'string' or (w.value#>>'{}') !~* uuid_pattern) then raise exception 'CENTER_APPLY_503 malformed existing workers';end if;
     select array_agg(distinct worker_uuid) into existing_providers from(select visit_row.worker_id worker_uuid union all select (w.value#>>'{}')::uuid from jsonb_array_elements(visit_row.data->'workerIds') w(value)) workers;
    else existing_providers:=array[visit_row.worker_id];end if;
    if visit_row.patient_id=plan_row.patient_id or provider_ids&&existing_providers then
     other_service:=case btrim(visit_row.data->>'service') when '방문요양' then '요양' when '방문간호' then '간호' when '방문목욕' then '목욕' else btrim(visit_row.data->>'service') end;
     if visit_row.patient_id=plan_row.patient_id and other_start=candidate_start and other_end=candidate_end and other_service=item->>'service' and provider_ids @> existing_providers and existing_providers @> provider_ids then existing_exact:=coalesce(existing_exact,visit_row.id);
     else raise exception 'CENTER_APPLY_409 patient or provider time conflict';end if;
    end if;
   end loop;
   if existing_exact is not null then
    insert into public.center_plan_visit_origins(organization_code,plan_id,entry_id,visit_date,visit_id,plan_version,disposition) values(p_organization_code,plan_uuid,entry_uuid,day_value,existing_exact,plan_row.version,'existing_exact');skipped:=skipped+1;continue;
   end if;
   new_visit:=gen_random_uuid();payload:=jsonb_build_object('id',new_visit,'date',day_value::text,'time',item->>'start','workerId',provider_ids[1],'workerIds',to_jsonb(provider_ids),'patientId',plan_row.patient_id,'service',item->>'service','minutes',minutes_value);
   insert into public.center_visits(id,organization_code,worker_id,patient_id,data) values(new_visit,p_organization_code,provider_ids[1],plan_row.patient_id,payload);
   insert into public.center_plan_visit_origins(organization_code,plan_id,entry_id,visit_date,visit_id,plan_version,disposition) values(p_organization_code,plan_uuid,entry_uuid,day_value,new_visit,plan_row.version,'created');
   created:=created+1;new_ids:=array_append(new_ids,new_visit);
  end loop;
 end loop;
 result:=jsonb_build_object('planId',plan_uuid,'planVersion',plan_row.version,'createdCount',created,'skippedCount',skipped,'visitIds',to_jsonb(new_ids));
 insert into public.center_plan_application_requests(organization_code,request_id,actor_id,mutation,response) values(p_organization_code,req,p_actor_id,p_mutation,result);return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or check_violation or not_null_violation then raise exception 'CENTER_APPLY_400 invalid application source';
 when unique_violation then raise exception 'CENTER_APPLY_409 duplicate application';
end$$;
revoke all on function public.apply_center_weekly_plan(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_center_weekly_plan(text,text,jsonb) to service_role;
commit;
