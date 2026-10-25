-- Append-only weekly reviews of state-change records by an institution admin; no person, visit, document, billing or NHIS mutation.
begin;
create table public.center_week_reviews(organization_code text not null references public.center_organizations(code),patient_id uuid not null,version integer not null check(version>0),entries jsonb not null check(jsonb_typeof(entries)='array' and jsonb_array_length(entries)<=2000),updated_at timestamptz not null default now(),primary key(organization_code,patient_id),foreign key(organization_code,patient_id) references public.center_people(organization_code,id));
create table public.center_week_review_requests(organization_code text not null references public.center_organizations(code),request_id uuid not null,actor_id text not null,mutation jsonb not null,response jsonb not null,created_at timestamptz not null default now(),primary key(organization_code,request_id));
alter table public.center_week_reviews enable row level security;
alter table public.center_week_review_requests enable row level security;
revoke all on public.center_week_reviews,public.center_week_review_requests from public,anon,authenticated,service_role;
create function public.inspect_center_week_reviews(p_organization_code text,p_month text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_WEEK_REVIEW_403 inactive organization';end if;
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'CENTER_WEEK_REVIEW_400 month';end if;
 select coalesce(jsonb_agg(jsonb_build_object('patientId',r.patient_id,'version',r.version,'entries',(select coalesce(jsonb_agg(e.value order by e.ordinal),'[]'::jsonb) from jsonb_array_elements(r.entries) with ordinality as e(value,ordinal) where left(e.value->>'weekStart',7)=p_month)) order by r.patient_id),'[]'::jsonb) into result from public.center_week_reviews r where r.organization_code=p_organization_code;
 return jsonb_build_object('month',p_month,'patients',result);
end$$;
create function public.save_center_week_review(p_organization_code text,p_actor_id text,p_mutation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare req uuid;pid uuid;expected integer;next_version integer;item jsonb;stored jsonb:='[]'::jsonb;all_entries jsonb;ids uuid[]:='{}';entry_id uuid;area text;week_date date;state public.center_week_reviews%rowtype;person public.center_people%rowtype;receipt public.center_week_review_requests%rowtype;result jsonb;stamp text;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_WEEK_REVIEW_403 inactive organization';end if;
 if p_actor_id is null or btrim(p_actor_id)='' or length(p_actor_id)>200 then raise exception 'CENTER_WEEK_REVIEW_403 actor';end if;
 if jsonb_typeof(p_mutation) is distinct from 'object' or (p_mutation-array['requestId','patientId','expectedVersion','entries'])<>'{}'::jsonb or p_mutation->>'requestId' is null or p_mutation->>'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_mutation->>'patientId' is null or p_mutation->>'patientId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p_mutation->'expectedVersion') is distinct from 'number' or (p_mutation->>'expectedVersion') !~ '^[0-9]{1,9}$' or jsonb_typeof(p_mutation->'entries') is distinct from 'array' or jsonb_array_length(p_mutation->'entries') not between 1 and 6 then raise exception 'CENTER_WEEK_REVIEW_400 mutation';end if;
 req:=(p_mutation->>'requestId')::uuid;pid:=(p_mutation->>'patientId')::uuid;expected:=(p_mutation->>'expectedVersion')::integer;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into receipt from public.center_week_review_requests where organization_code=p_organization_code and request_id=req;
 if found then if receipt.actor_id<>p_actor_id or receipt.mutation<>p_mutation then raise exception 'CENTER_WEEK_REVIEW_409 reused request';end if;return receipt.response;end if;
 select * into person from public.center_people where organization_code=p_organization_code and id=pid and kind='patient' for update;
 if not found then raise exception 'CENTER_WEEK_REVIEW_404 patient';end if;
 if person.archived then raise exception 'CENTER_WEEK_REVIEW_409 archived patient';end if;
 select * into state from public.center_week_reviews where organization_code=p_organization_code and patient_id=pid for update;
 if expected<>coalesce(state.version,0) then raise exception 'CENTER_WEEK_REVIEW_409 version';end if;
 all_entries:=coalesce(state.entries,'[]'::jsonb);next_version:=coalesce(state.version,0)+1;
 stamp:=to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"');
 for item in select value from jsonb_array_elements(p_mutation->'entries') loop
  if jsonb_typeof(item) is distinct from 'object' or (item-array['id','weekStart','value','areas','note','digest','documentId','batch'])<>'{}'::jsonb then raise exception 'CENTER_WEEK_REVIEW_400 entry';end if;
  if item->>'id' is null or item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'CENTER_WEEK_REVIEW_400 id';end if;
  entry_id:=(item->>'id')::uuid;
  if entry_id=any(ids) or exists(select 1 from jsonb_array_elements(all_entries) old where (old.value->>'id')::uuid=entry_id) then raise exception 'CENTER_WEEK_REVIEW_409 duplicate id';end if;
  ids:=ids||entry_id;
  if jsonb_typeof(item->'weekStart') is distinct from 'string' or item->>'weekStart' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'CENTER_WEEK_REVIEW_400 week';end if;
  week_date:=(item->>'weekStart')::date;if week_date::text<>item->>'weekStart' or week_date<date '2000-01-01' or week_date>date '2199-12-31' then raise exception 'CENTER_WEEK_REVIEW_400 week';end if;
  if jsonb_typeof(item->'value') is distinct from 'string' or item->>'value' not in ('same_as_usual','changed','not_observed') then raise exception 'CENTER_WEEK_REVIEW_400 value';end if;
  if jsonb_typeof(item->'areas') is distinct from 'array' or jsonb_array_length(item->'areas')>6 or (item->>'value'<>'changed' and jsonb_array_length(item->'areas')>0) or (select count(distinct a.value) from jsonb_array_elements(item->'areas') a)<>jsonb_array_length(item->'areas') then raise exception 'CENTER_WEEK_REVIEW_400 areas';end if;
  for area in select a.value #>> '{}' from jsonb_array_elements(item->'areas') a loop
   if area not in ('body','cognition','emotion','nutrition','rehab','safety') then raise exception 'CENTER_WEEK_REVIEW_400 areas';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(item->'areas') a where jsonb_typeof(a.value) is distinct from 'string') then raise exception 'CENTER_WEEK_REVIEW_400 areas';end if;
  if jsonb_typeof(item->'note') is distinct from 'string' or length(item->>'note')>500 then raise exception 'CENTER_WEEK_REVIEW_400 note';end if;
  if jsonb_typeof(item->'digest') is distinct from 'string' or (item->>'digest'<>'' and item->>'digest' !~* '^[0-9a-f]{64}$') then raise exception 'CENTER_WEEK_REVIEW_400 digest';end if;
  if jsonb_typeof(item->'documentId') not in ('null','string') or (jsonb_typeof(item->'documentId')='string' and item->>'documentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'CENTER_WEEK_REVIEW_400 document';end if;
  if jsonb_typeof(item->'batch') is distinct from 'boolean' then raise exception 'CENTER_WEEK_REVIEW_400 batch';end if;
  if item->>'digest'='' and item->>'value'<>'not_observed' then raise exception 'CENTER_WEEK_REVIEW_400 no record to confirm';end if;
  item:=item||jsonb_build_object('reviewer',p_actor_id,'at',stamp);
  stored:=stored||jsonb_build_array(item);
 end loop;
 if jsonb_array_length(all_entries)+jsonb_array_length(stored)>2000 then raise exception 'CENTER_WEEK_REVIEW_400 history limit';end if;
 all_entries:=all_entries||stored;
 insert into public.center_week_reviews(organization_code,patient_id,version,entries) values(p_organization_code,pid,next_version,all_entries) on conflict(organization_code,patient_id) do update set version=excluded.version,entries=excluded.entries,updated_at=now();
 result:=jsonb_build_object('patientId',pid,'version',next_version,'saved',stored);
 insert into public.center_week_review_requests(organization_code,request_id,actor_id,mutation,response) values(p_organization_code,req,p_actor_id,p_mutation,result);return result;
 exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'CENTER_WEEK_REVIEW_400 invalid input';
end$$;
revoke all on function public.inspect_center_week_reviews(text,text),public.save_center_week_review(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.inspect_center_week_reviews(text,text),public.save_center_week_review(text,text,jsonb) to service_role;
commit;
