-- Review and apply separately after 2026-10-20-center-membership.sql.
-- No production records, account details or credentials are seeded here.
begin;
create table if not exists public.center_documents (
  id uuid primary key default gen_random_uuid(),
  organization_code text not null references public.center_organizations(code),
  template_id text not null check (template_id in ('case-management','staff-meeting','training-record','service-record')),
  title text not null check (length(trim(title)) between 1 and 200),
  subject_kind text not null check (subject_kind in ('agency','worker','patient')),
  subject_id text,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and substring(period,1,4)::integer >= 1900),
  content text not null check (length(content) <= 80000),
  result_evaluation_completed boolean not null default false,
  status text not null default 'draft' check (status in ('draft','confirmed')),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  check ((subject_kind = 'agency' and subject_id is null) or (subject_kind <> 'agency' and subject_id is not null and length(trim(subject_id)) between 1 and 100)),
  check ((template_id = 'service-record' and subject_kind = 'patient') or (template_id <> 'service-record' and subject_kind = 'agency')),
  check (not result_evaluation_completed or template_id = 'case-management'),
  check ((status = 'draft' and confirmed_at is null) or (status = 'confirmed' and confirmed_at is not null and length(trim(content)) > 0))
);
create index if not exists center_documents_org_period on public.center_documents(organization_code,period,created_at,id);
create table if not exists public.center_document_requests (
  organization_code text not null references public.center_organizations(code),
  request_id uuid not null,
  actor_id text not null,
  mutation jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_code,request_id)
);
alter table public.center_documents enable row level security;
alter table public.center_document_requests enable row level security;
revoke all on public.center_documents, public.center_document_requests from public, anon, authenticated, service_role;
grant select on public.center_documents to service_role;

create or replace function public.guard_center_document()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'confirmed' then raise exception 'CENTER_DOC_409 confirmed document is immutable'; end if;
  if tg_op = 'DELETE' then raise exception 'CENTER_DOC_409 deletion is not supported'; end if;
  if new.id <> old.id or new.organization_code <> old.organization_code or new.created_at <> old.created_at then raise exception 'CENTER_DOC_409 identity is immutable'; end if;
  return new;
end $$;
drop trigger if exists guard_center_document on public.center_documents;
create trigger guard_center_document before update or delete on public.center_documents for each row execute function public.guard_center_document();
revoke all on function public.guard_center_document() from public, anon, authenticated, service_role;

-- This function and idempotency receipt commit in one transaction. The actor and org
-- arguments are supplied only by the server after centerSession approval checks.
create or replace function public.mutate_center_document(p_organization_code text, p_actor_id text, p_mutation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request_uuid uuid;
  document_uuid uuid;
  operation text := p_mutation ->> 'action';
  receipt public.center_document_requests%rowtype;
  document_row public.center_documents%rowtype;
  result jsonb;
begin
  if p_actor_id is null or length(p_actor_id) = 0 or jsonb_typeof(p_mutation) <> 'object' then raise exception 'CENTER_DOC_400 invalid actor or mutation'; end if;
  perform 1 from public.center_organizations where code = p_organization_code and active for share;
  if not found then raise exception 'CENTER_DOC_403 inactive organization'; end if;
  if operation not in ('create','revise','confirm') or operation is null then raise exception 'CENTER_DOC_400 invalid action'; end if;
  begin
    request_uuid := (p_mutation ->> 'requestId')::uuid;
    if request_uuid is null then raise invalid_text_representation; end if;
  exception when invalid_text_representation then raise exception 'CENTER_DOC_400 invalid request identifier'; end;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_code || ':' || request_uuid::text,0));
  select * into receipt from public.center_document_requests where organization_code = p_organization_code and request_id = request_uuid;
  if found then
    if receipt.actor_id <> p_actor_id or receipt.mutation <> p_mutation then raise exception 'CENTER_DOC_409 request identifier reused with different content'; end if;
    return receipt.response;
  end if;
  if operation <> 'create' then
    begin
      document_uuid := (p_mutation ->> 'id')::uuid;
    exception when invalid_text_representation then raise exception 'CENTER_DOC_400 invalid document identifier'; end;
    select * into document_row from public.center_documents where id = document_uuid and organization_code = p_organization_code for update;
    if not found then raise exception 'CENTER_DOC_404 document is not in this organization'; end if;
    if document_row.subject_kind <> 'agency' then raise exception 'CENTER_DOC_503 subject registry not connected'; end if;
    if document_row.status <> 'draft' or p_mutation ->> 'expectedVersion' is distinct from document_row.version::text then raise exception 'CENTER_DOC_409 stale or confirmed document'; end if;
  end if;
  if operation = 'confirm' then
    if length(trim(document_row.content)) = 0 then raise exception 'CENTER_DOC_400 content is required before confirmation'; end if;
    update public.center_documents set status = 'confirmed', confirmed_at = now(), updated_at = now(), version = version + 1 where id = document_row.id returning * into document_row;
  else
    if p_mutation ->> 'subjectKind' is distinct from 'agency' or p_mutation -> 'subjectId' is distinct from 'null'::jsonb then raise exception 'CENTER_DOC_503 subject registry not connected'; end if;
    if p_mutation ->> 'templateId' not in ('case-management','staff-meeting','training-record') or p_mutation ->> 'templateId' is null then raise exception 'CENTER_DOC_400 invalid template'; end if;
    if jsonb_typeof(p_mutation -> 'title') is distinct from 'string' or jsonb_typeof(p_mutation -> 'content') is distinct from 'string' or jsonb_typeof(p_mutation -> 'period') is distinct from 'string' or jsonb_typeof(p_mutation -> 'resultEvaluationCompleted') is distinct from 'boolean' then raise exception 'CENTER_DOC_400 invalid field types'; end if;
    if operation = 'create' then
      insert into public.center_documents(organization_code,template_id,title,subject_kind,subject_id,period,content,result_evaluation_completed)
      values(p_organization_code,p_mutation ->> 'templateId',p_mutation ->> 'title','agency',null,p_mutation ->> 'period',p_mutation ->> 'content',(p_mutation ->> 'resultEvaluationCompleted')::boolean) returning * into document_row;
    else
      update public.center_documents set template_id = p_mutation ->> 'templateId', title = p_mutation ->> 'title', period = p_mutation ->> 'period', content = p_mutation ->> 'content', result_evaluation_completed = (p_mutation ->> 'resultEvaluationCompleted')::boolean, version = version + 1, updated_at = now() where id = document_row.id returning * into document_row;
    end if;
  end if;
  result := to_jsonb(document_row);
  insert into public.center_document_requests(organization_code,request_id,actor_id,mutation,response) values(p_organization_code,request_uuid,p_actor_id,p_mutation,result);
  return result;
exception when check_violation or not_null_violation then
  raise exception 'CENTER_DOC_400 invalid document fields';
end $$;
revoke all on function public.mutate_center_document(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.mutate_center_document(text,text,jsonb) to service_role;
commit;
