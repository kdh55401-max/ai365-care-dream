begin;
create table public.center_person_imports (
 id uuid primary key default gen_random_uuid(), organization_code text not null references public.center_organizations(code), actor_id text not null, kind text not null check(kind in ('worker','patient')), source_text text not null check(char_length(source_text) between 1 and 20000), source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'), status text not null default 'processing' check(status in ('processing','saved','review_required','failed')), lease uuid not null default gen_random_uuid(), extraction jsonb, person_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_code,kind,source_hash), foreign key(organization_code,person_id) references public.center_people(organization_code,id)
);
create table public.center_import_requests(organization_code text not null references public.center_organizations(code),request_id uuid not null,actor_id text not null,import_id uuid not null references public.center_person_imports(id),primary key(organization_code,request_id));
alter table public.center_person_imports enable row level security;
alter table public.center_import_requests enable row level security;
revoke all on public.center_person_imports,public.center_import_requests from public,anon,authenticated,service_role;
grant select on public.center_person_imports to service_role;
create function public.begin_center_person_import(p_organization_code text,p_actor_id text,p_request_id uuid,p_kind text,p_source_text text,p_source_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.center_person_imports%rowtype;receipt public.center_import_requests%rowtype;claimed boolean:=false;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_IMPORT_403 inactive organization';end if;
 if p_actor_id is null or btrim(p_actor_id)='' or p_request_id is null or p_kind is null or p_kind not in ('worker','patient') or p_source_text is null or char_length(p_source_text) not between 1 and 20000 or p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$' then raise exception 'CENTER_IMPORT_400 invalid request';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into receipt from public.center_import_requests where organization_code=p_organization_code and request_id=p_request_id;
 if found then
  select * into item from public.center_person_imports where id=receipt.import_id and organization_code=p_organization_code;
  if receipt.actor_id<>p_actor_id or item.kind<>p_kind or item.source_text<>p_source_text or item.source_hash<>p_source_hash then raise exception 'CENTER_IMPORT_409 reused request';end if;
  return jsonb_build_object('claimed',false,'import',to_jsonb(item)-'lease');
 end if;
 select * into item from public.center_person_imports where organization_code=p_organization_code and kind=p_kind and source_hash=p_source_hash;
 if found then
  if item.source_text<>p_source_text then raise exception 'CENTER_IMPORT_409 source hash conflict';end if;
 else
  insert into public.center_person_imports(organization_code,actor_id,kind,source_text,source_hash) values(p_organization_code,p_actor_id,p_kind,p_source_text,p_source_hash) returning * into item;
  claimed:=true;
 end if;
 insert into public.center_import_requests(organization_code,request_id,actor_id,import_id) values(p_organization_code,p_request_id,p_actor_id,item.id);
 return jsonb_build_object('claimed',claimed,'import',to_jsonb(item)-'lease','lease',case when claimed then item.lease else null end);
end$$;
create function public.fail_center_person_import(p_organization_code text,p_id uuid,p_lease uuid) returns void language plpgsql security definer set search_path='' as $$begin
 update public.center_person_imports set status='failed',updated_at=now() where organization_code=p_organization_code and id=p_id and lease=p_lease and status='processing';
end$$;
create function public.finish_center_person_import(p_organization_code text,p_id uuid,p_lease uuid,p_extraction jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.center_person_imports%rowtype; f jsonb; e jsonb; k text; v text; quote text; safe boolean; normalized_name text; new_person uuid; reasons jsonb;
begin
 if not exists(select 1 from public.center_organizations where code=p_organization_code and active for share) then raise exception 'CENTER_IMPORT_403 inactive organization';end if;
 perform pg_advisory_xact_lock(hashtextextended('center-operations:'||p_organization_code,0));
 select * into item from public.center_person_imports where organization_code=p_organization_code and id=p_id for update;
 if not found then raise exception 'CENTER_IMPORT_404 missing import';end if;
 if p_lease is null or item.lease<>p_lease then raise exception 'CENTER_IMPORT_409 lease';end if;
 if item.status<>'processing' then return to_jsonb(item)-'lease';end if;
 f:=p_extraction->'fields';e:=p_extraction->'evidence';reasons:=p_extraction->'reasons';
 if jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(reasons) is distinct from 'array' or jsonb_typeof(p_extraction->'ambiguous') is distinct from 'boolean' then raise exception 'CENTER_IMPORT_400 extraction';end if;
 if exists(select 1 from jsonb_object_keys(f) as x(key) where key not in ('name','status','category','start','end','examination')) then raise exception 'CENTER_IMPORT_400 field';end if;
 foreach k in array ARRAY['name','status','category','start','end','examination'] loop
  if not (f ? k) then raise exception 'CENTER_IMPORT_400 missing field';end if;
  if jsonb_typeof(f->k)='null' then continue;end if;
  v:=f->>k;quote:=e->>k;
  if jsonb_typeof(f->k) is distinct from 'string' or v is null or btrim(v)='' or char_length(v)>100 or quote is null or btrim(quote)='' or char_length(quote)>2000 or position(quote in item.source_text)=0 or position(v in quote)=0 then raise exception 'CENTER_IMPORT_400 ungrounded field';end if;
  if k in ('start','end','examination') then
   if v !~ '^\d{4}-\d{2}-\d{2}$' or v<'1900-01-01' or v>'2199-12-31' or v::date::text<>v then raise exception 'CENTER_IMPORT_400 date';end if;
  end if;
 end loop;
 if f->>'start' is not null and f->>'end' is not null and f->>'start'>f->>'end' then reasons:=reasons||jsonb_build_array('시작일과 종료일의 순서를 확인해야 합니다.');end if;
 safe:=(p_extraction->>'ambiguous')='false' and jsonb_array_length(reasons)=0 and f->>'name' is not null;
 if safe then
  normalized_name:=lower(regexp_replace(f->>'name','\s+','','g'));
  if exists(select 1 from public.center_people where organization_code=p_organization_code and lower(regexp_replace(data->>'name','\s+','','g'))=normalized_name) then
   safe:=false;reasons:=reasons||jsonb_build_array('같은 이름의 기존 인물이 있습니다. 기존 정보는 변경하지 않았습니다.');
  end if;
 end if;
 if safe then
  new_person:=gen_random_uuid();
  insert into public.center_people(id,organization_code,kind,data) values(new_person,p_organization_code,item.kind,jsonb_build_object('id',new_person,'kind',item.kind,'name',f->>'name','status',coalesce(f->>'status',''),'category',coalesce(f->>'category',''),'start',coalesce(f->>'start',''),'end',coalesce(f->>'end',''),'examination',coalesce(f->>'examination',''),'notes','{}'::jsonb));
 end if;
 update public.center_person_imports set status=case when safe then 'saved' else 'review_required' end,extraction=jsonb_set(p_extraction,'{reasons}',reasons),person_id=new_person,updated_at=now() where id=p_id and organization_code=p_organization_code returning * into item;
 return to_jsonb(item)-'lease';
 exception when invalid_datetime_format or datetime_field_overflow then raise exception 'CENTER_IMPORT_400 date';
end$$;
revoke all on function public.begin_center_person_import(text,text,uuid,text,text,text),public.finish_center_person_import(text,uuid,uuid,jsonb),public.fail_center_person_import(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_center_person_import(text,text,uuid,text,text,text),public.finish_center_person_import(text,uuid,uuid,jsonb),public.fail_center_person_import(text,uuid,uuid) to service_role;
commit;
