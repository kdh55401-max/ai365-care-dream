-- Additive; after center-operations. Does not change caregiver_assignments.
begin;
create function public.center_assignment_workers_unique(p_ids uuid[]) returns boolean
language sql immutable strict parallel safe set search_path='' as $$select cardinality(p_ids)=(select count(distinct id)::integer from unnest(p_ids) workers(id))$$;
revoke all on function public.center_assignment_workers_unique(uuid[]) from public,anon,authenticated,service_role;
create table public.center_patient_assignments(
 organization_code text not null references public.center_organizations(code),patient_id uuid not null,
 worker_ids uuid[] not null default '{}'::uuid[],version integer not null default 1 check(version>0),updated_at timestamptz not null default now(),
 primary key(organization_code,patient_id),foreign key(organization_code,patient_id) references public.center_people(organization_code,id),
 check(cardinality(worker_ids) between 0 and 100),check(cardinality(worker_ids)=0 or array_ndims(worker_ids)=1),
 check(array_position(worker_ids,null::uuid) is null),check(public.center_assignment_workers_unique(worker_ids))
);
create table public.center_assignment_requests(organization_code text not null references public.center_organizations(code),request_id uuid not null,actor_id text not null,mutation jsonb not null,response jsonb not null,created_at timestamptz not null default now(),primary key(organization_code,request_id));
alter table public.center_patient_assignments enable row level security;
alter table public.center_assignment_requests enable row level security;
revoke all on public.center_patient_assignments,public.center_assignment_requests from public,anon,authenticated,service_role;
grant select on public.center_patient_assignments to service_role;
create policy center_patient_assignments_service_read on public.center_patient_assignments for select to service_role using(true);
create function public.guard_center_patient_assignment() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' then raise exception 'CENTER_ASSIGN_409 clear workers instead';end if;
 if new.organization_code<>old.organization_code or new.patient_id<>old.patient_id or new.version<>old.version+1 then raise exception 'CENTER_ASSIGN_409 immutable identity/version';end if;
 return new;
end$$;
create trigger center_patient_assignments_guard before update or delete on public.center_patient_assignments for each row execute function public.guard_center_patient_assignment();
revoke all on function public.guard_center_patient_assignment() from public,anon,authenticated,service_role;
create function public.save_center_assignment(p_organization_code text,p_actor_id text,p_mutation jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare patient_uuid uuid;request_uuid uuid;provider_ids uuid[];expected integer;matched_count integer;receipt public.center_assignment_requests%rowtype;current_row public.center_patient_assignments%rowtype;result jsonb;
begin
 if p_actor_id is null or btrim(p_actor_id)='' or jsonb_typeof(p_mutation) is distinct from 'object' then raise exception 'CENTER_ASSIGN_400 invalid mutation';end if;
 if exists(select 1 from jsonb_object_keys(p_mutation) field(key) where not(field.key=any(array['patientId','workerIds','expectedVersion','requestId']))) then raise exception 'CENTER_ASSIGN_400 unsupported fields';end if;
 if jsonb_typeof(p_mutation->'patientId') is distinct from 'string' or (p_mutation->>'patientId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_mutation->'requestId') is distinct from 'string' or (p_mutation->>'requestId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_mutation->'expectedVersion') is distinct from 'number' or (p_mutation->>'expectedVersion') !~ '^(0|[1-9][0-9]*)$'
  or jsonb_typeof(p_mutation->'workerIds') is distinct from 'array' then raise exception 'CENTER_ASSIGN_400 invalid fields';end if;
 if jsonb_array_length(p_mutation->'workerIds')>100 then raise exception 'CENTER_ASSIGN_400 too many workers';end if;
 if exists(select 1 from jsonb_array_elements(p_mutation->'workerIds') entry(value) where jsonb_typeof(entry.value) is distinct from 'string' or (entry.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'CENTER_ASSIGN_400 invalid worker';end if;
 patient_uuid:=(p_mutation->>'patientId')::uuid;request_uuid:=(p_mutation->>'requestId')::uuid;expected:=(p_mutation->>'expectedVersion')::integer;
 select coalesce(array_agg((entry.value #>> '{}')::uuid order by entry.ordinality),'{}'::uuid[]) into provider_ids from jsonb_array_elements(p_mutation->'workerIds') with ordinality entry(value,ordinality);
 if not public.center_assignment_workers_unique(provider_ids) then raise exception 'CENTER_ASSIGN_400 duplicate worker';end if;
 perform 1 from public.center_organizations where code=p_organization_code and active for share;
 if not found then raise exception 'CENTER_ASSIGN_403 inactive organization';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into receipt from public.center_assignment_requests where organization_code=p_organization_code and request_id=request_uuid;
 if found then
  if receipt.actor_id<>p_actor_id or receipt.mutation<>p_mutation then raise exception 'CENTER_ASSIGN_409 request reused';end if;
  return receipt.response;
 end if;
 perform 1 from public.center_people where organization_code=p_organization_code and id=patient_uuid and kind='patient' and not archived for share;
 if not found then raise exception 'CENTER_ASSIGN_400 invalid active patient';end if;
 perform 1 from public.center_people where organization_code=p_organization_code and id=any(provider_ids) and kind='worker' and not archived order by id for share;
 get diagnostics matched_count=row_count;
 if matched_count<>cardinality(provider_ids) then raise exception 'CENTER_ASSIGN_400 invalid active worker';end if;
 select * into current_row from public.center_patient_assignments where organization_code=p_organization_code and patient_id=patient_uuid for update;
 if not found then
  if expected<>0 then raise exception 'CENTER_ASSIGN_404 assignment not found';end if;
  insert into public.center_patient_assignments(organization_code,patient_id,worker_ids) values(p_organization_code,patient_uuid,provider_ids) returning * into current_row;
 else
  if expected<>current_row.version then raise exception 'CENTER_ASSIGN_409 stale version';end if;
  update public.center_patient_assignments set worker_ids=provider_ids,version=version+1,updated_at=now() where organization_code=p_organization_code and patient_id=patient_uuid returning * into current_row;
 end if;
 result:=jsonb_build_object('patientId',current_row.patient_id,'workerIds',current_row.worker_ids,'version',current_row.version);
 insert into public.center_assignment_requests(organization_code,request_id,actor_id,mutation,response) values(p_organization_code,request_uuid,p_actor_id,p_mutation,result);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception 'CENTER_ASSIGN_400 invalid assignment fields';
 when unique_violation then raise exception 'CENTER_ASSIGN_409 duplicate assignment';
end$$;
revoke all on function public.save_center_assignment(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_center_assignment(text,text,jsonb) to service_role;
create function public.guard_center_assignment_person_archive() returns trigger language plpgsql set search_path='' as $$begin
 if not old.archived and new.archived and exists(select 1 from public.center_patient_assignments assignment where assignment.organization_code=old.organization_code and cardinality(assignment.worker_ids)>0 and (assignment.patient_id=old.id or old.id=any(assignment.worker_ids))) then raise exception 'CENTER_OP_409 active assignment reference';end if;
 return new;
end$$;
create trigger center_people_assignment_archive_guard before update on public.center_people for each row execute function public.guard_center_assignment_person_archive();
revoke all on function public.guard_center_assignment_person_archive() from public,anon,authenticated,service_role;
commit;
