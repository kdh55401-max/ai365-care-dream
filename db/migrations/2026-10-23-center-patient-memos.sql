-- Internal dated memo history only; no person, billing or NHIS mutation.
begin;
create table public.center_patient_memos(organization_code text not null references public.center_organizations(code),patient_id uuid not null,version integer not null check(version>0),entries jsonb not null check(jsonb_typeof(entries)='array' and jsonb_array_length(entries)<=500),updated_at timestamptz not null default now(),primary key(organization_code,patient_id),foreign key(organization_code,patient_id) references public.center_people(organization_code,id));
create table public.center_patient_memo_requests(organization_code text not null references public.center_organizations(code),request_id uuid not null,actor_id text not null,mutation jsonb not null,response jsonb not null,created_at timestamptz not null default now(),primary key(organization_code,request_id));
alter table public.center_patient_memos enable row level security;
alter table public.center_patient_memo_requests enable row level security;
revoke all on public.center_patient_memos,public.center_patient_memo_requests from public,anon,authenticated,service_role;
create function public.inspect_center_patient_memo(p_organization_code text,p_patient_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;state public.center_patient_memos%rowtype;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_MEMO_403 inactive organization';end if;
 if p_patient_id is null or p_patient_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'CENTER_MEMO_400 patient';end if;pid:=p_patient_id::uuid;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 if not exists(select 1 from public.center_people where organization_code=p_organization_code and id=pid and kind='patient') then raise exception 'CENTER_MEMO_404 patient';end if;
 select * into state from public.center_patient_memos where organization_code=p_organization_code and patient_id=pid;
 return jsonb_build_object('patientId',pid,'version',coalesce(state.version,0),'entries',coalesce(state.entries,'[]'::jsonb));
end$$;
create function public.save_center_patient_memo(p_organization_code text,p_actor_id text,p_mutation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare req uuid;pid uuid;entry_id uuid;expected integer;act text;memo jsonb;entry jsonb;all_entries jsonb;effective_date date;state public.center_patient_memos%rowtype;person public.center_people%rowtype;receipt public.center_patient_memo_requests%rowtype;result jsonb;next_version integer;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_MEMO_403 inactive organization';end if;
 if p_actor_id is null or btrim(p_actor_id)='' or length(p_actor_id)>200 then raise exception 'CENTER_MEMO_403 actor';end if;
 if jsonb_typeof(p_mutation) is distinct from 'object' or (p_mutation-array['requestId','patientId','expectedVersion','action','memo','id'])<>'{}'::jsonb or p_mutation->>'requestId' is null or p_mutation->>'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_mutation->>'patientId' is null or p_mutation->>'patientId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p_mutation->'expectedVersion') is distinct from 'number' or p_mutation->>'expectedVersion' !~ '^[0-9]{1,10}$' then raise exception 'CENTER_MEMO_400 mutation';end if;
 req:=(p_mutation->>'requestId')::uuid;pid:=(p_mutation->>'patientId')::uuid;expected:=(p_mutation->>'expectedVersion')::integer;act:=p_mutation->>'action';
 if act is null or act not in ('save','archive') or (act='save' and p_mutation ? 'id') or (act<>'save' and p_mutation ? 'memo') then raise exception 'CENTER_MEMO_400 action';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into receipt from public.center_patient_memo_requests where organization_code=p_organization_code and request_id=req;
 if found then if receipt.actor_id<>p_actor_id or receipt.mutation<>p_mutation then raise exception 'CENTER_MEMO_409 reused request';end if;return receipt.response;end if;
 select * into person from public.center_people where organization_code=p_organization_code and id=pid and kind='patient' for update;
 if not found then raise exception 'CENTER_MEMO_404 patient';end if;
 if person.archived then raise exception 'CENTER_MEMO_409 archived patient';end if;
 select * into state from public.center_patient_memos where organization_code=p_organization_code and patient_id=pid for update;
 if expected<>coalesce(state.version,0) then raise exception 'CENTER_MEMO_409 version';end if;
 all_entries:=coalesce(state.entries,'[]'::jsonb);next_version:=coalesce(state.version,0)+1;
 if act='save' then
  memo:=p_mutation->'memo';
  if jsonb_typeof(memo) is distinct from 'object' or (memo-array['id','date','text'])<>'{}'::jsonb or memo->>'id' is null or memo->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(memo->'text') is distinct from 'string' or length(memo->>'text')>4000 or regexp_replace(memo->>'text','[[:space:]]','','g')='' or jsonb_typeof(memo->'date') is distinct from 'string' or memo->>'date' !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'CENTER_MEMO_400 memo';end if;
  effective_date:=(memo->>'date')::date;if effective_date::text<>memo->>'date' then raise exception 'CENTER_MEMO_400 date';end if;
  entry_id:=(memo->>'id')::uuid;memo:=memo||jsonb_build_object('id',entry_id,'archived',false,'writer',p_actor_id);
 else
  if p_mutation->>'id' is null or p_mutation->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'CENTER_MEMO_400 id';end if;entry_id:=(p_mutation->>'id')::uuid;
 end if;
 select value into entry from jsonb_array_elements(all_entries) where (value->>'id')::uuid=entry_id;
 if act='save' then
  if coalesce((entry->>'archived')::boolean,false) then raise exception 'CENTER_MEMO_409 archived memo';end if;
  if entry is null then
   if jsonb_array_length(all_entries)>=500 then raise exception 'CENTER_MEMO_400 history limit';end if;
   all_entries:=all_entries||jsonb_build_array(memo);
  else select jsonb_agg(case when (value->>'id')::uuid=entry_id then memo else value end order by ordinal) into all_entries from jsonb_array_elements(all_entries) with ordinality as rows(value,ordinal);
  end if;
 else
  if entry is null then raise exception 'CENTER_MEMO_404 memo';end if;
  if coalesce((entry->>'archived')::boolean,false) then raise exception 'CENTER_MEMO_409 archived memo';end if;
  select jsonb_agg(case when (value->>'id')::uuid=entry_id then value||'{"archived":true}'::jsonb else value end order by ordinal) into all_entries from jsonb_array_elements(all_entries) with ordinality as rows(value,ordinal);
 end if;
 insert into public.center_patient_memos(organization_code,patient_id,version,entries) values(p_organization_code,pid,next_version,all_entries) on conflict(organization_code,patient_id) do update set version=excluded.version,entries=excluded.entries,updated_at=now();
 result:=jsonb_build_object('state',jsonb_build_object('patientId',pid,'version',next_version,'entries',all_entries));
 insert into public.center_patient_memo_requests(organization_code,request_id,actor_id,mutation,response) values(p_organization_code,req,p_actor_id,p_mutation,result);return result;
 exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'CENTER_MEMO_400 invalid input';
end$$;
revoke all on function public.inspect_center_patient_memo(text,text),public.save_center_patient_memo(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.inspect_center_patient_memo(text,text),public.save_center_patient_memo(text,text,jsonb) to service_role;
commit;
