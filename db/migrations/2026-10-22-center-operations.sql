begin;
create table public.center_people (
 id uuid primary key, organization_code text not null references public.center_organizations(code), kind text not null check(kind in ('worker','patient')), data jsonb not null check(jsonb_typeof(data)='object'), version integer not null default 1 check(version>0), archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_code,id)
);
create table public.center_visits (
 id uuid primary key,organization_code text not null references public.center_organizations(code),worker_id uuid not null,patient_id uuid not null,data jsonb not null check(jsonb_typeof(data)='object'),version integer not null default 1 check(version>0),archived boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(organization_code,worker_id) references public.center_people(organization_code,id),foreign key(organization_code,patient_id) references public.center_people(organization_code,id)
);
create table public.center_operation_requests (organization_code text not null references public.center_organizations(code),request_id uuid not null,actor_id text not null,mutation jsonb not null,response jsonb not null,created_at timestamptz not null default now(),primary key(organization_code,request_id));
alter table public.center_people enable row level security;
alter table public.center_visits enable row level security;
alter table public.center_operation_requests enable row level security;
revoke all on public.center_people,public.center_visits,public.center_operation_requests from public,anon,authenticated,service_role;
grant select on public.center_people,public.center_visits to service_role;
create function public.center_operation_guard() returns trigger language plpgsql set search_path='' as $$begin
 if TG_OP='DELETE' then raise exception 'CENTER_OP_409 archive required';end if;
 if new.id<>old.id or new.organization_code<>old.organization_code or new.created_at<>old.created_at or old.archived or new.version<>old.version+1 then raise exception 'CENTER_OP_409 immutable metadata';end if;
 if TG_TABLE_NAME='center_people' then if new.kind<>old.kind then raise exception 'CENTER_OP_409 immutable kind';end if;end if;
 return new;end$$;
create trigger center_people_guard before update or delete on public.center_people for each row execute function public.center_operation_guard();
create trigger center_visits_guard before update or delete on public.center_visits for each row execute function public.center_operation_guard();
create function public.mutate_center_operation(p_organization_code text,p_actor_id text,p_mutation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare act text:=p_mutation->>'action'; req uuid; entity uuid; expected integer; payload jsonb; old_version integer; old_archived boolean; result jsonb; receipt public.center_operation_requests%rowtype; saved jsonb;person_kind text; wid uuid;pid uuid;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_OP_403 inactive organization';end if;
 if p_actor_id is null or btrim(p_actor_id)='' then raise exception 'CENTER_OP_403 missing actor';end if;
 if act not in ('upsertPerson','upsertVisit','archivePerson','archiveVisit') or act is null then raise exception 'CENTER_OP_400 action';end if;
 req:=(p_mutation->>'requestId')::uuid;expected:=(p_mutation->>'expectedVersion')::integer;
 if req is null or expected is null or expected<0 then raise exception 'CENTER_OP_400 request/version';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into receipt from public.center_operation_requests where organization_code=p_organization_code and request_id=req;
 if found then if receipt.actor_id<>p_actor_id or receipt.mutation<>p_mutation then raise exception 'CENTER_OP_409 reused request';end if;return receipt.response;end if;
 payload:=case act when 'upsertPerson' then p_mutation->'person' when 'upsertVisit' then p_mutation->'visit' else null end;
 entity:=(case when payload is null then p_mutation->>'id' else payload->>'id' end)::uuid;
 if entity is null then raise exception 'CENTER_OP_400 id';end if;
 if act in ('upsertPerson','archivePerson') then
 select version,archived,kind into old_version,old_archived,person_kind from public.center_people where organization_code=p_organization_code and id=entity for update;
 else
 select version,archived into old_version,old_archived from public.center_visits where organization_code=p_organization_code and id=entity for update;
 end if;
 if old_version is null and (expected<>0 or act like 'archive%') then raise exception 'CENTER_OP_404 missing entity';end if;
 if old_version is not null and (old_version<>expected or old_archived) then raise exception 'CENTER_OP_409 version/archive';end if;
 if act='upsertPerson' then
 if payload->>'kind' is null or payload->>'kind' not in ('worker','patient') or nullif(btrim(payload->>'name'),'') is null or jsonb_typeof(payload->'notes') is distinct from 'object' then raise exception 'CENTER_OP_400 person';end if;
 if old_version is not null and person_kind<>payload->>'kind' then raise exception 'CENTER_OP_409 kind';end if;
 payload:=payload-'version'-'archived';
 if old_version is null then insert into public.center_people(id,organization_code,kind,data) values(entity,p_organization_code,payload->>'kind',payload);
 else update public.center_people set data=payload,version=version+1,updated_at=now() where id=entity and organization_code=p_organization_code;end if;
 elsif act='upsertVisit' then
 wid:=(payload->>'workerId')::uuid;pid:=(payload->>'patientId')::uuid;
 if not exists(select 1 from public.center_people where organization_code=p_organization_code and id=wid and kind='worker' and not archived) or not exists(select 1 from public.center_people where organization_code=p_organization_code and id=pid and kind='patient' and not archived) then raise exception 'CENTER_OP_400 invalid person reference';end if;
 if (payload->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or (payload->>'date')::date::text<>payload->>'date' or payload->>'date'<'1900-01-01' or payload->>'date'>'2199-12-31' or (payload->>'time') !~ '^([01]\d|2[0-3]):[0-5]\d$' or (payload->>'minutes')::integer not between 1 and 1440 or nullif(btrim(payload->>'service'),'') is null then raise exception 'CENTER_OP_400 visit';end if;
 if payload->>'date' is null or payload->>'time' is null or payload->>'minutes' is null then raise exception 'CENTER_OP_400 visit required';end if;
 payload:=payload-'version'-'archived';
 if old_version is null then insert into public.center_visits(id,organization_code,worker_id,patient_id,data) values(entity,p_organization_code,wid,pid,payload);
 else update public.center_visits set worker_id=wid,patient_id=pid,data=payload,version=version+1,updated_at=now() where id=entity and organization_code=p_organization_code;end if;
 elsif act='archivePerson' then
 if exists(select 1 from public.center_visits where organization_code=p_organization_code and not archived and (worker_id=entity or patient_id=entity)) then raise exception 'CENTER_OP_409 active visit reference';end if;
 update public.center_people set archived=true,version=version+1,updated_at=now() where id=entity and organization_code=p_organization_code;
 else update public.center_visits set archived=true,version=version+1,updated_at=now() where id=entity and organization_code=p_organization_code;
 end if;
 if act in ('upsertPerson','archivePerson') then select data||jsonb_build_object('version',version,'archived',archived) into saved from public.center_people where organization_code=p_organization_code and id=entity;result:=jsonb_build_object('person',saved);
 else select data||jsonb_build_object('version',version,'archived',archived) into saved from public.center_visits where organization_code=p_organization_code and id=entity;result:=jsonb_build_object('visit',saved);end if;
 insert into public.center_operation_requests(organization_code,request_id,actor_id,mutation,response) values(p_organization_code,req,p_actor_id,p_mutation,result);
 return result;
 exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or check_violation or not_null_violation or numeric_value_out_of_range then raise exception 'CENTER_OP_400 invalid input';
 when unique_violation then raise exception 'CENTER_OP_409 duplicate entity';
 end$$;
revoke all on function public.mutate_center_operation(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_center_operation(text,text,jsonb) to service_role;
commit;
