-- Internal patient contract history; never an NHIS registration or signature.
begin;
create table public.center_patient_contracts(organization_code text not null references public.center_organizations(code),patient_id uuid not null,version integer not null check(version>0),active_id uuid,entries jsonb not null check(jsonb_typeof(entries)='array' and jsonb_array_length(entries)<=500),updated_at timestamptz not null default now(),primary key(organization_code,patient_id),foreign key(organization_code,patient_id) references public.center_people(organization_code,id));
create table public.center_patient_contract_requests(organization_code text not null references public.center_organizations(code),request_id uuid not null,actor_id text not null,mutation jsonb not null,response jsonb not null,created_at timestamptz not null default now(),primary key(organization_code,request_id));
alter table public.center_patient_contracts enable row level security;
alter table public.center_patient_contract_requests enable row level security;
revoke all on public.center_patient_contracts,public.center_patient_contract_requests from public,anon,authenticated,service_role;
create function public.inspect_center_patient_contract(p_organization_code text,p_patient_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;state public.center_patient_contracts%rowtype;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_CONTRACT_403 inactive organization';end if;
 if p_patient_id is null or p_patient_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'CENTER_CONTRACT_400 patient';end if;pid:=p_patient_id::uuid;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 if not exists(select 1 from public.center_people where organization_code=p_organization_code and id=pid and kind='patient') then raise exception 'CENTER_CONTRACT_404 patient';end if;
 select * into state from public.center_patient_contracts where organization_code=p_organization_code and patient_id=pid;
 return jsonb_build_object('patientId',pid,'version',coalesce(state.version,0),'activeId',state.active_id,'entries',coalesce(state.entries,'[]'::jsonb));
end$$;
create function public.save_center_patient_contract(p_organization_code text,p_actor_id text,p_mutation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare req uuid;pid uuid;entry_id uuid;expected integer;person_expected integer;act text;contract jsonb;entry jsonb;all_entries jsonb;new_services jsonb;day text;day_value date;state public.center_patient_contracts%rowtype;person public.center_people%rowtype;receipt public.center_patient_contract_requests%rowtype;result jsonb;saved_state jsonb;next_active uuid;next_version integer;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_CONTRACT_403 inactive organization';end if;
 if p_actor_id is null or btrim(p_actor_id)='' then raise exception 'CENTER_CONTRACT_403 actor';end if;
 if jsonb_typeof(p_mutation) is distinct from 'object' or (p_mutation-array['requestId','patientId','expectedVersion','action','contract','id','expectedPersonVersion'])<>'{}'::jsonb or p_mutation->>'requestId' is null or p_mutation->>'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_mutation->>'patientId' is null or p_mutation->>'patientId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p_mutation->'expectedVersion') is distinct from 'number' or p_mutation->>'expectedVersion' !~ '^[0-9]{1,10}$' then raise exception 'CENTER_CONTRACT_400 mutation';end if;
 req:=(p_mutation->>'requestId')::uuid;pid:=(p_mutation->>'patientId')::uuid;expected:=(p_mutation->>'expectedVersion')::integer;act:=p_mutation->>'action';
 if act is null or act not in ('save','archive','apply') or (act='save' and p_mutation ? 'id') or (act<>'save' and p_mutation ? 'contract') or (act<>'apply' and p_mutation ? 'expectedPersonVersion') then raise exception 'CENTER_CONTRACT_400 action';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into receipt from public.center_patient_contract_requests where organization_code=p_organization_code and request_id=req;
 if found then if receipt.actor_id<>p_actor_id or receipt.mutation<>p_mutation then raise exception 'CENTER_CONTRACT_409 reused request';end if;return receipt.response;end if;
 select * into person from public.center_people where organization_code=p_organization_code and id=pid and kind='patient' for update;
 if not found then raise exception 'CENTER_CONTRACT_404 patient';end if;
 if person.archived then raise exception 'CENTER_CONTRACT_409 archived patient';end if;
 select * into state from public.center_patient_contracts where organization_code=p_organization_code and patient_id=pid for update;
 if expected<>coalesce(state.version,0) then raise exception 'CENTER_CONTRACT_409 version';end if;
 all_entries:=coalesce(state.entries,'[]'::jsonb);next_active:=state.active_id;next_version:=coalesce(state.version,0)+1;
 if act='save' then
  contract:=p_mutation->'contract';
  if jsonb_typeof(contract) is distinct from 'object' or (contract-array['id','contractDate','periodStart','periodEnd','services','note'])<>'{}'::jsonb or contract->>'id' is null or contract->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(contract->'note') is distinct from 'string' or length(contract->>'note')>2000 then raise exception 'CENTER_CONTRACT_400 contract';end if;
  entry_id:=(contract->>'id')::uuid;
  foreach day in array array['contractDate','periodStart','periodEnd'] loop
   if jsonb_typeof(contract->day) is distinct from 'string' or contract->>day !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'CENTER_CONTRACT_400 date';end if;
   day_value:=(contract->>day)::date;if day_value::text<>contract->>day then raise exception 'CENTER_CONTRACT_400 date';end if;
  end loop;
  if contract->>'periodStart'>contract->>'periodEnd' then raise exception 'CENTER_CONTRACT_400 period';end if;
  if jsonb_typeof(contract->'services') is distinct from 'array' then raise exception 'CENTER_CONTRACT_400 services';end if;
  if jsonb_array_length(contract->'services') not between 1 and 3 or exists(select 1 from jsonb_array_elements(contract->'services') s where jsonb_typeof(s) is distinct from 'string' or s#>>'{}' not in ('요양','간호','목욕')) or (select count(*)<>count(distinct value) from jsonb_array_elements(contract->'services')) then raise exception 'CENTER_CONTRACT_400 services';end if;
  select jsonb_agg(s order by ordinal) into new_services from (values('요양'::text,1),('간호',2),('목욕',3)) as kinds(s,ordinal) where contract->'services' ? s;
  contract:=contract||jsonb_build_object('id',entry_id,'services',new_services,'archived',false);
 else
  if p_mutation->>'id' is null or p_mutation->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'CENTER_CONTRACT_400 id';end if;entry_id:=(p_mutation->>'id')::uuid;
 end if;
 select value into entry from jsonb_array_elements(all_entries) where (value->>'id')::uuid=entry_id;
 if act='save' then
  if state.active_id=entry_id or coalesce((entry->>'archived')::boolean,false) then raise exception 'CENTER_CONTRACT_409 immutable contract';end if;
  if entry is null then
   if jsonb_array_length(all_entries)>=500 then raise exception 'CENTER_CONTRACT_400 history limit';end if;
   all_entries:=all_entries||jsonb_build_array(contract);
  else select jsonb_agg(case when (value->>'id')::uuid=entry_id then contract else value end order by ordinal) into all_entries from jsonb_array_elements(all_entries) with ordinality as rows(value,ordinal);
  end if;
 else
  if entry is null then raise exception 'CENTER_CONTRACT_404 contract';end if;
  if coalesce((entry->>'archived')::boolean,false) then raise exception 'CENTER_CONTRACT_409 archived contract';end if;
  if act='archive' then
   if state.active_id=entry_id then raise exception 'CENTER_CONTRACT_409 active contract';end if;
   select jsonb_agg(case when (value->>'id')::uuid=entry_id then value||'{"archived":true}'::jsonb else value end order by ordinal) into all_entries from jsonb_array_elements(all_entries) with ordinality as rows(value,ordinal);
  else
   if jsonb_typeof(p_mutation->'expectedPersonVersion') is distinct from 'number' or p_mutation->>'expectedPersonVersion' !~ '^[1-9][0-9]{0,9}$' then raise exception 'CENTER_CONTRACT_400 person version';end if;person_expected:=(p_mutation->>'expectedPersonVersion')::integer;
   if person.version<>person_expected then raise exception 'CENTER_CONTRACT_409 person version';end if;
   update public.center_people set data=data||jsonb_build_object('start',entry->>'contractDate','end',entry->>'periodEnd'),version=version+1,updated_at=now() where organization_code=p_organization_code and id=pid returning * into person;
   next_active:=entry_id;
  end if;
 end if;
 insert into public.center_patient_contracts(organization_code,patient_id,version,active_id,entries) values(p_organization_code,pid,next_version,next_active,all_entries) on conflict(organization_code,patient_id) do update set version=excluded.version,active_id=excluded.active_id,entries=excluded.entries,updated_at=now();
 saved_state:=jsonb_build_object('patientId',pid,'version',next_version,'activeId',next_active,'entries',all_entries);result:=jsonb_build_object('state',saved_state);
 if act='apply' then result:=result||jsonb_build_object('person',person.data||jsonb_build_object('version',person.version,'archived',person.archived));end if;
 insert into public.center_patient_contract_requests(organization_code,request_id,actor_id,mutation,response) values(p_organization_code,req,p_actor_id,p_mutation,result);return result;
 exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'CENTER_CONTRACT_400 invalid input';
end$$;
revoke all on function public.inspect_center_patient_contract(text,text),public.save_center_patient_contract(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.inspect_center_patient_contract(text,text),public.save_center_patient_contract(text,text,jsonb) to service_role;
commit;
