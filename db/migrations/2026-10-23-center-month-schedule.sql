-- Internal center review locks only. Not NHIS billing confirmation or performed care.
begin;
create table public.center_monthly_schedule_locks(organization_code text not null references public.center_organizations(code),month text not null check(month ~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$'),version integer not null check(version>0),locked boolean not null,snapshot jsonb not null check(jsonb_typeof(snapshot)='array' and jsonb_array_length(snapshot)<=10000),updated_at timestamptz not null default now(),primary key(organization_code,month));
create table public.center_monthly_schedule_requests(organization_code text not null references public.center_organizations(code),request_id uuid not null,actor_id text not null,mutation jsonb not null,response jsonb not null,created_at timestamptz not null default now(),primary key(organization_code,request_id));
alter table public.center_monthly_schedule_locks enable row level security;
alter table public.center_monthly_schedule_requests enable row level security;
revoke all on public.center_monthly_schedule_locks,public.center_monthly_schedule_requests from public,anon,authenticated,service_role;
create function public.center_month_visit_range(p_data jsonb) returns tsrange language plpgsql immutable set search_path='' as $$
declare d date;t timestamp;m integer;
begin
 if p_data->>'date' is null or p_data->>'date' !~ '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' or p_data->>'time' is null or p_data->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_data->>'minutes' is null or p_data->>'minutes' !~ '^[0-9]{1,4}$' then raise exception 'CENTER_MONTH_503 invalid stored schedule';end if;
 d:=(p_data->>'date')::date;m:=(p_data->>'minutes')::integer;
 if d::text<>p_data->>'date' or m not between 1 and 1440 then raise exception 'CENTER_MONTH_503 invalid stored schedule';end if;
 t:=d+(p_data->>'time')::time;return tsrange(t,t+make_interval(mins=>m),'[)');
 exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'CENTER_MONTH_503 invalid stored schedule';
end$$;
create function public.center_month_schedule_snapshot(p_organization_code text,p_month text) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;start_at timestamp:=(p_month||'-01')::date;end_at timestamp:=start_at+interval '1 month';
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version) order by id),'[]'::jsonb) into result from public.center_visits where organization_code=p_organization_code and not archived and public.center_month_visit_range(data) && tsrange(start_at,end_at,'[)');
 if jsonb_array_length(result)>10000 then raise exception 'CENTER_MONTH_503 schedule limit';end if;return result;
end$$;
create function public.inspect_center_month_schedule(p_organization_code text,p_month text) returns jsonb language plpgsql security definer set search_path='' as $$
declare state public.center_monthly_schedule_locks%rowtype;current_snapshot jsonb;
begin
 if p_month is null or p_month !~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'CENTER_MONTH_400 month';end if;
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_MONTH_403 inactive organization';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into state from public.center_monthly_schedule_locks where organization_code=p_organization_code and month=p_month;
 current_snapshot:=public.center_month_schedule_snapshot(p_organization_code,p_month);
 return jsonb_build_object('month',p_month,'version',coalesce(state.version,0),'locked',coalesce(state.locked,false),'snapshot',current_snapshot);
end$$;
create function public.set_center_month_schedule_lock(p_organization_code text,p_actor_id text,p_mutation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare req uuid;expected integer;target_month text;target_locked boolean;receipt public.center_monthly_schedule_requests%rowtype;state public.center_monthly_schedule_locks%rowtype;row_item jsonb;input_snapshot jsonb;current_snapshot jsonb;result jsonb;next_version integer;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_MONTH_403 inactive organization';end if;
 if p_actor_id is null or btrim(p_actor_id)='' then raise exception 'CENTER_MONTH_403 actor';end if;
 if jsonb_typeof(p_mutation) is distinct from 'object' or (p_mutation-array['requestId','month','expectedVersion','locked','snapshot'])<>'{}'::jsonb or p_mutation->>'requestId' is null or p_mutation->>'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p_mutation->'expectedVersion') is distinct from 'number' or p_mutation->>'expectedVersion' !~ '^[0-9]{1,10}$' or jsonb_typeof(p_mutation->'locked') is distinct from 'boolean' then raise exception 'CENTER_MONTH_400 mutation';end if;
 req:=(p_mutation->>'requestId')::uuid;expected:=(p_mutation->>'expectedVersion')::integer;target_month:=p_mutation->>'month';target_locked:=(p_mutation->>'locked')::boolean;
 if target_month is null or target_month !~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_mutation->'snapshot') is distinct from 'array' then raise exception 'CENTER_MONTH_400 month/snapshot';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into receipt from public.center_monthly_schedule_requests where organization_code=p_organization_code and request_id=req;
 if found then if receipt.actor_id<>p_actor_id or receipt.mutation<>p_mutation then raise exception 'CENTER_MONTH_409 reused request';end if;return receipt.response;end if;
 if jsonb_array_length(p_mutation->'snapshot')>10000 then raise exception 'CENTER_MONTH_400 snapshot limit';end if;
 for row_item in select value from jsonb_array_elements(p_mutation->'snapshot') loop
  if jsonb_typeof(row_item) is distinct from 'object' or (row_item-array['id','version'])<>'{}'::jsonb or row_item->>'id' is null or row_item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(row_item->'version') is distinct from 'number' or row_item->>'version' !~ '^[1-9][0-9]{0,9}$' then raise exception 'CENTER_MONTH_400 snapshot row';end if;
  perform (row_item->>'version')::integer;
 end loop;
 if (select count(*)<>count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_mutation->'snapshot')) then raise exception 'CENTER_MONTH_400 duplicate snapshot id';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',(value->>'id')::uuid,'version',(value->>'version')::integer) order by (value->>'id')::uuid),'[]'::jsonb) into input_snapshot from jsonb_array_elements(p_mutation->'snapshot');
 select * into state from public.center_monthly_schedule_locks where organization_code=p_organization_code and month=target_month for update;
 if expected<>coalesce(state.version,0) then raise exception 'CENTER_MONTH_409 version';end if;
 current_snapshot:=public.center_month_schedule_snapshot(p_organization_code,target_month);
 if input_snapshot<>current_snapshot then raise exception 'CENTER_MONTH_409 stale schedule';end if;
 if target_locked=coalesce(state.locked,false) then raise exception 'CENTER_MONTH_409 unchanged lock';end if;
 if target_locked and current_snapshot='[]'::jsonb then raise exception 'CENTER_MONTH_400 empty schedule';end if;
 next_version:=coalesce(state.version,0)+1;
 insert into public.center_monthly_schedule_locks(organization_code,month,version,locked,snapshot) values(p_organization_code,target_month,next_version,target_locked,current_snapshot) on conflict(organization_code,month) do update set version=excluded.version,locked=excluded.locked,snapshot=excluded.snapshot,updated_at=now();
 result:=jsonb_build_object('month',target_month,'version',next_version,'locked',target_locked,'snapshot',current_snapshot);
 insert into public.center_monthly_schedule_requests(organization_code,request_id,actor_id,mutation,response) values(p_organization_code,req,p_actor_id,p_mutation,result);return result;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'CENTER_MONTH_400 invalid input';
end$$;
create function public.center_month_schedule_visit_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||new.organization_code,0));
 if TG_OP='UPDATE' then
  if not old.archived and exists(select 1 from public.center_monthly_schedule_locks where organization_code=old.organization_code and locked and public.center_month_visit_range(old.data) && tsrange((month||'-01')::date::timestamp,(month||'-01')::date+interval '1 month','[)')) then raise exception 'CENTER_MONTH_409 locked monthly schedule';end if;
 end if;
 if not new.archived and exists(select 1 from public.center_monthly_schedule_locks where organization_code=new.organization_code and locked and public.center_month_visit_range(new.data) && tsrange((month||'-01')::date::timestamp,(month||'-01')::date+interval '1 month','[)')) then raise exception 'CENTER_MONTH_409 locked monthly schedule';end if;
 return new;
end$$;
create trigger center_visits_month_lock_guard before insert or update on public.center_visits for each row execute function public.center_month_schedule_visit_guard();
revoke all on function public.center_month_visit_range(jsonb),public.center_month_schedule_snapshot(text,text),public.center_month_schedule_visit_guard() from public,anon,authenticated,service_role;
revoke all on function public.inspect_center_month_schedule(text,text),public.set_center_month_schedule_lock(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.inspect_center_month_schedule(text,text),public.set_center_month_schedule_lock(text,text,jsonb) to service_role;
commit;
