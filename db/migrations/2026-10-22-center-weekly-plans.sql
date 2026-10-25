-- Additive after center-operations. Plans are separate from visits and claims.
begin;
create table public.center_weekly_plans(
 id uuid primary key,organization_code text not null references public.center_organizations(code),patient_id uuid not null,
 month text not null check(month ~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$'),note text not null default '' check(length(note)<=2000),
 entries jsonb not null default '[]'::jsonb check(jsonb_typeof(entries)='array' and jsonb_array_length(entries)<=100),
 version integer not null default 1 check(version>0),archived boolean not null default false,updated_at timestamptz not null default now(),
 foreign key(organization_code,patient_id) references public.center_people(organization_code,id)
);
create index center_weekly_plans_org_patient_month on public.center_weekly_plans(organization_code,patient_id,month,id);
create table public.center_weekly_plan_requests(organization_code text not null references public.center_organizations(code),request_id uuid not null,actor_id text not null,mutation jsonb not null,response jsonb not null,created_at timestamptz not null default now(),primary key(organization_code,request_id));
alter table public.center_weekly_plans enable row level security;
alter table public.center_weekly_plan_requests enable row level security;
revoke all on public.center_weekly_plans,public.center_weekly_plan_requests from public,anon,authenticated,service_role;
grant select on public.center_weekly_plans to service_role;
create policy center_weekly_plans_service_read on public.center_weekly_plans for select to service_role using(true);
create function public.guard_center_weekly_plan() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' then raise exception 'CENTER_PLAN_409 archive required';end if;
 if old.archived or new.id<>old.id or new.organization_code<>old.organization_code or new.patient_id<>old.patient_id or new.version<>old.version+1 then raise exception 'CENTER_PLAN_409 immutable identity/version';end if;
 if new.archived and (new.month is distinct from old.month or new.note is distinct from old.note or new.entries is distinct from old.entries) then raise exception 'CENTER_PLAN_409 archive cannot revise plan';end if;
 return new;
end$$;
create trigger center_weekly_plans_guard before update or delete on public.center_weekly_plans for each row execute function public.guard_center_weekly_plan();
revoke all on function public.guard_center_weekly_plan() from public,anon,authenticated,service_role;
create function public.save_center_weekly_plan(p_organization_code text,p_actor_id text,p_mutation jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare act text;req uuid;expected integer;plan_id uuid;patient_uuid uuid;plan_month text;plan_note text;
 normalized_entries jsonb:='[]'::jsonb;raw_entry jsonb;normalized_entry jsonb;entry_uuid uuid;entry_ids uuid[]:='{}'::uuid[];
 providers uuid[];days jsonb;matched integer;changes integer;candidate jsonb;other_entry jsonb;
 start_min integer;end_min integer;other_start integer;other_end integer;
 receipt public.center_weekly_plan_requests%rowtype;current_plan public.center_weekly_plans%rowtype;saved_plan public.center_weekly_plans%rowtype;exists_plan boolean;result jsonb;
 uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 if p_actor_id is null or btrim(p_actor_id)='' or jsonb_typeof(p_mutation) is distinct from 'object' then raise exception 'CENTER_PLAN_400 invalid actor/mutation';end if;
 act:=p_mutation->>'action';
 if act is null or act not in ('save','archive') then raise exception 'CENTER_PLAN_400 action';end if;
 if exists(select 1 from jsonb_object_keys(p_mutation) field(key) where not(field.key=any(case when act='save' then array['action','requestId','expectedVersion','plan'] else array['action','requestId','expectedVersion','id'] end))) then raise exception 'CENTER_PLAN_400 unsupported fields';end if;
 if jsonb_typeof(p_mutation->'requestId') is distinct from 'string' or (p_mutation->>'requestId') !~* uuid_pattern or jsonb_typeof(p_mutation->'expectedVersion') is distinct from 'number' or (p_mutation->>'expectedVersion') !~ '^(0|[1-9][0-9]*)$' then raise exception 'CENTER_PLAN_400 request/version';end if;
 req:=(p_mutation->>'requestId')::uuid;expected:=(p_mutation->>'expectedVersion')::integer;
 perform 1 from public.center_organizations where code=p_organization_code and active for share;
 if not found then raise exception 'CENTER_PLAN_403 inactive organization';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into receipt from public.center_weekly_plan_requests where organization_code=p_organization_code and request_id=req;
 if found then
  if receipt.actor_id<>p_actor_id or receipt.mutation<>p_mutation then raise exception 'CENTER_PLAN_409 reused request';end if;
  return receipt.response;
 end if;
 if act='save' then
  if jsonb_typeof(p_mutation->'plan') is distinct from 'object' then raise exception 'CENTER_PLAN_400 plan required';end if;
  if exists(select 1 from jsonb_object_keys(p_mutation->'plan') field(key) where not(field.key=any(array['id','patientId','month','note','entries']))) then raise exception 'CENTER_PLAN_400 plan fields';end if;
  if jsonb_typeof(p_mutation#>'{plan,id}') is distinct from 'string' or (p_mutation#>>'{plan,id}') !~* uuid_pattern
   or jsonb_typeof(p_mutation#>'{plan,patientId}') is distinct from 'string' or (p_mutation#>>'{plan,patientId}') !~* uuid_pattern
   or jsonb_typeof(p_mutation#>'{plan,month}') is distinct from 'string' or (p_mutation#>>'{plan,month}') !~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$'
   or jsonb_typeof(p_mutation#>'{plan,note}') is distinct from 'string' or length(p_mutation#>>'{plan,note}')>2000
   or jsonb_typeof(p_mutation#>'{plan,entries}') is distinct from 'array' then raise exception 'CENTER_PLAN_400 plan values';end if;
  if jsonb_array_length(p_mutation#>'{plan,entries}')>100 then raise exception 'CENTER_PLAN_400 too many entries';end if;
  plan_id:=(p_mutation#>>'{plan,id}')::uuid;patient_uuid:=(p_mutation#>>'{plan,patientId}')::uuid;plan_month:=p_mutation#>>'{plan,month}';plan_note:=p_mutation#>>'{plan,note}';
 else
  if jsonb_typeof(p_mutation->'id') is distinct from 'string' or (p_mutation->>'id') !~* uuid_pattern then raise exception 'CENTER_PLAN_400 plan id';end if;
  plan_id:=(p_mutation->>'id')::uuid;
 end if;
 select * into current_plan from public.center_weekly_plans where organization_code=p_organization_code and id=plan_id for update;
 exists_plan:=found;
 if not exists_plan then
  if act='archive' or expected<>0 then raise exception 'CENTER_PLAN_404 plan not found';end if;
  if jsonb_array_length(p_mutation#>'{plan,entries}')<>0 then raise exception 'CENTER_PLAN_400 create empty plan first';end if;
 elsif current_plan.archived or expected<>current_plan.version then raise exception 'CENTER_PLAN_409 stale/archived plan';end if;
 if act='archive' then
  update public.center_weekly_plans set archived=true,version=version+1,updated_at=now() where organization_code=p_organization_code and id=plan_id returning * into saved_plan;
 else
  if exists_plan and current_plan.patient_id<>patient_uuid then raise exception 'CENTER_PLAN_409 immutable patient';end if;
  perform 1 from public.center_people where organization_code=p_organization_code and id=patient_uuid and kind='patient' and not archived for share;
  if not found then raise exception 'CENTER_PLAN_400 invalid active patient';end if;
  for raw_entry in select value from jsonb_array_elements(p_mutation#>'{plan,entries}') loop
   if jsonb_typeof(raw_entry) is distinct from 'object' then raise exception 'CENTER_PLAN_400 entry object';end if;
   if exists(select 1 from jsonb_object_keys(raw_entry) field(key) where not(field.key=any(array['id','service','weekdays','start','end','workerIds','nursingDual']))) then raise exception 'CENTER_PLAN_400 entry fields';end if;
   if jsonb_typeof(raw_entry->'id') is distinct from 'string' or (raw_entry->>'id') !~* uuid_pattern
    or jsonb_typeof(raw_entry->'service') is distinct from 'string' or (raw_entry->>'service') not in ('요양','간호','목욕')
    or jsonb_typeof(raw_entry->'start') is distinct from 'string' or (raw_entry->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or jsonb_typeof(raw_entry->'end') is distinct from 'string' or (raw_entry->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or raw_entry->>'start'=raw_entry->>'end' or jsonb_typeof(raw_entry->'weekdays') is distinct from 'array' or jsonb_typeof(raw_entry->'workerIds') is distinct from 'array' then raise exception 'CENTER_PLAN_400 invalid entry';end if;
   entry_uuid:=(raw_entry->>'id')::uuid;
   if entry_uuid=any(entry_ids) then raise exception 'CENTER_PLAN_400 duplicate entry';end if;
   entry_ids:=array_append(entry_ids,entry_uuid);
   if raw_entry ? 'nursingDual' and jsonb_typeof(raw_entry->'nursingDual') is distinct from 'boolean' then raise exception 'CENTER_PLAN_400 nursing option';end if;
   if coalesce((raw_entry->>'nursingDual')::boolean,false) and raw_entry->>'service'<>'간호' then raise exception 'CENTER_PLAN_400 nursing-only option';end if;
   if jsonb_array_length(raw_entry->'weekdays') not between 1 and 7 or exists(select 1 from jsonb_array_elements(raw_entry->'weekdays') day(value) where jsonb_typeof(day.value) is distinct from 'number' or (day.value#>>'{}') !~ '^[0-6]$') then raise exception 'CENTER_PLAN_400 weekdays';end if;
   if (select count(distinct day.value) from jsonb_array_elements(raw_entry->'weekdays') day(value))<>jsonb_array_length(raw_entry->'weekdays') then raise exception 'CENTER_PLAN_400 duplicate weekdays';end if;
   select jsonb_agg((day.value#>>'{}')::integer order by (day.value#>>'{}')::integer) into days from jsonb_array_elements(raw_entry->'weekdays') day(value);
   if jsonb_array_length(raw_entry->'workerIds')<>(case when raw_entry->>'service'='목욕' then 2 else 1 end) or exists(select 1 from jsonb_array_elements(raw_entry->'workerIds') worker(value) where jsonb_typeof(worker.value) is distinct from 'string' or (worker.value#>>'{}') !~* uuid_pattern) then raise exception 'CENTER_PLAN_400 providers';end if;
   select array_agg((worker.value#>>'{}')::uuid order by worker.ordinality) into providers from jsonb_array_elements(raw_entry->'workerIds') with ordinality worker(value,ordinality);
   if (select count(distinct worker_id) from unnest(providers) ids(worker_id))<>cardinality(providers) then raise exception 'CENTER_PLAN_400 duplicate provider';end if;
   perform 1 from public.center_people where organization_code=p_organization_code and id=any(providers) and kind='worker' and not archived order by id for share;
   get diagnostics matched=row_count;
   if matched<>cardinality(providers) then raise exception 'CENTER_PLAN_400 invalid active provider';end if;
   normalized_entry:=raw_entry||jsonb_build_object('id',entry_uuid::text,'weekdays',days,'workerIds',to_jsonb(providers),'nursingDual',coalesce((raw_entry->>'nursingDual')::boolean,false));
   normalized_entries:=normalized_entries||jsonb_build_array(normalized_entry);
  end loop;
  if exists_plan then
   select count(*) into changes from jsonb_array_elements(current_plan.entries) old_entry(value) full join jsonb_array_elements(normalized_entries) new_entry(value) on old_entry.value->>'id'=new_entry.value->>'id' where old_entry.value is distinct from new_entry.value;
   if changes>1 then raise exception 'CENTER_PLAN_400 change one entry at a time';end if;
   select new_entry.value into candidate from jsonb_array_elements(normalized_entries) new_entry(value) left join jsonb_array_elements(current_plan.entries) old_entry(value) on old_entry.value->>'id'=new_entry.value->>'id' where old_entry.value is distinct from new_entry.value limit 1;
   if candidate is not null and not (candidate->>'nursingDual')::boolean then
    start_min:=substring(candidate->>'start',1,2)::integer*60+substring(candidate->>'start',4,2)::integer;
    end_min:=substring(candidate->>'end',1,2)::integer*60+substring(candidate->>'end',4,2)::integer;
    if end_min<start_min then end_min:=end_min+1440;end if;
    for other_entry in select value from jsonb_array_elements(normalized_entries) where value->>'id'<>candidate->>'id' and value->>'service'=candidate->>'service' loop
     if exists(select 1 from jsonb_array_elements_text(candidate->'weekdays') a(day) join jsonb_array_elements_text(other_entry->'weekdays') b(day) on a.day=b.day) then
      other_start:=substring(other_entry->>'start',1,2)::integer*60+substring(other_entry->>'start',4,2)::integer;
      other_end:=substring(other_entry->>'end',1,2)::integer*60+substring(other_entry->>'end',4,2)::integer;
      if other_end<other_start then other_end:=other_end+1440;end if;
      if start_min<other_end and other_start<end_min then raise exception 'CENTER_PLAN_400 overlapping plan entry';end if;
     end if;
    end loop;
   end if;
  end if;
  if exists_plan then
   update public.center_weekly_plans set month=plan_month,note=plan_note,entries=normalized_entries,version=version+1,updated_at=now() where organization_code=p_organization_code and id=plan_id returning * into saved_plan;
  else
   insert into public.center_weekly_plans(id,organization_code,patient_id,month,note,entries) values(plan_id,p_organization_code,patient_uuid,plan_month,plan_note,normalized_entries) returning * into saved_plan;
  end if;
 end if;
 result:=jsonb_build_object('id',saved_plan.id,'patientId',saved_plan.patient_id,'month',saved_plan.month,'note',saved_plan.note,'entries',saved_plan.entries,'version',saved_plan.version,'archived',saved_plan.archived);
 insert into public.center_weekly_plan_requests(organization_code,request_id,actor_id,mutation,response) values(p_organization_code,req,p_actor_id,p_mutation,result);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception 'CENTER_PLAN_400 invalid plan fields';
 when unique_violation then raise exception 'CENTER_PLAN_409 duplicate plan';
end$$;
revoke all on function public.save_center_weekly_plan(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_center_weekly_plan(text,text,jsonb) to service_role;
create function public.guard_center_weekly_plan_person_archive() returns trigger language plpgsql set search_path='' as $$begin
 if not old.archived and new.archived and exists(select 1 from public.center_weekly_plans plan where plan.organization_code=old.organization_code and not plan.archived and jsonb_array_length(plan.entries)>0 and (plan.patient_id=old.id or exists(select 1 from jsonb_array_elements(plan.entries) entry(value) where entry.value->'workerIds' @> jsonb_build_array(old.id::text)))) then raise exception 'CENTER_OP_409 active weekly plan reference';end if;
 return new;
end$$;
create trigger center_people_weekly_plan_archive_guard before update on public.center_people for each row execute function public.guard_center_weekly_plan_person_archive();
revoke all on function public.guard_center_weekly_plan_person_archive() from public,anon,authenticated,service_role;
commit;
