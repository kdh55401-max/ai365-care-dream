-- Review after membership, documents and operations; never auto-apply to production.
begin;
do $$
declare t smallint; s smallint; c record; dropped integer := 0;
begin
 if to_regclass('public.center_people') is null then raise exception 'Apply center-operations first'; end if;
 select attnum into t from pg_attribute where attrelid='public.center_documents'::regclass and attname='template_id' and not attisdropped;
 select attnum into s from pg_attribute where attrelid='public.center_documents'::regclass and attname='subject_kind' and not attisdropped;
 for c in select conname,conkey from pg_constraint where conrelid='public.center_documents'::regclass and contype='c' loop
  if c.conkey=array[t]::smallint[] or c.conkey @> array[t,s]::smallint[] then
   execute format('alter table public.center_documents drop constraint %I',c.conname); dropped:=dropped+1;
  end if;
 end loop;
 if dropped<>2 then raise exception 'Unexpected document constraints; manual review required'; end if;
end $$;
alter table public.center_documents add constraint center_documents_template_v2_check check(template_id in ('case-management','staff-meeting','training-record','service-record','state-change-record','service-result-evaluation'));
alter table public.center_documents add constraint center_documents_subject_template_v2_check check((template_id in ('case-management','staff-meeting','training-record') and subject_kind='agency' and subject_id is null) or (template_id in ('service-record','state-change-record','service-result-evaluation') and subject_kind='patient' and subject_id is not null));
-- Existing historical text identifiers survive; new/updated rows require UUID.
alter table public.center_documents add constraint center_documents_patient_uuid_v2_check check(subject_kind<>'patient' or subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') not valid;
create or replace function public.guard_center_document()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'confirmed' then raise exception 'CENTER_DOC_409 confirmed document is immutable'; end if;
  if tg_op = 'DELETE' then raise exception 'CENTER_DOC_409 deletion is not supported'; end if;
  if new.id <> old.id or new.organization_code <> old.organization_code or new.created_at <> old.created_at or new.template_id <> old.template_id or new.subject_kind <> old.subject_kind or new.subject_id is distinct from old.subject_id then raise exception 'CENTER_DOC_409 identity is immutable'; end if;
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
  target_kind text;
  target_id text;
  target_template text;
  patient_uuid uuid;
begin
  if p_actor_id is null or length(p_actor_id) = 0 or jsonb_typeof(p_mutation) <> 'object' then raise exception 'CENTER_DOC_400 invalid actor or mutation'; end if;
  perform 1 from public.center_organizations where code = p_organization_code and active for share;
  if not found then raise exception 'CENTER_DOC_403 inactive organization'; end if;
  if operation not in ('create','revise','confirm') or operation is null then raise exception 'CENTER_DOC_400 invalid action'; end if;
  begin
    request_uuid := (p_mutation ->> 'requestId')::uuid;
    if request_uuid is null then raise invalid_text_representation; end if;
  exception when invalid_text_representation then raise exception 'CENTER_DOC_400 invalid request identifier'; end;
  perform pg_advisory_xact_lock(hashtextextended('center-operations:' || p_organization_code,0));
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

    if document_row.status <> 'draft' or p_mutation ->> 'expectedVersion' is distinct from document_row.version::text then raise exception 'CENTER_DOC_409 stale or confirmed document'; end if;
  end if;
  if operation = 'confirm' then
    target_kind := document_row.subject_kind; target_id := document_row.subject_id; target_template := document_row.template_id;
  else
    target_kind := p_mutation ->> 'subjectKind'; target_id := p_mutation ->> 'subjectId'; target_template := p_mutation ->> 'templateId';
    if operation = 'revise' and (target_kind is distinct from document_row.subject_kind or target_id is distinct from document_row.subject_id or target_template is distinct from document_row.template_id) then raise exception 'CENTER_DOC_409 subject and template are immutable'; end if;
  end if;
  if target_kind = 'patient' then
    if target_template is null or target_template not in ('service-record','state-change-record','service-result-evaluation') then raise exception 'CENTER_DOC_400 invalid patient template'; end if;
    begin patient_uuid := target_id::uuid; exception when invalid_text_representation then raise exception 'CENTER_DOC_400 invalid patient identifier'; end;
    perform 1 from public.center_people where organization_code = p_organization_code and id = patient_uuid and kind = 'patient' and not archived for share;
    if not found then raise exception 'CENTER_DOC_400 invalid active patient'; end if;
  elsif target_kind = 'agency' then
    if target_template is null or target_template not in ('case-management','staff-meeting','training-record') or target_id is not null then raise exception 'CENTER_DOC_400 invalid agency document'; end if;
  else raise exception 'CENTER_DOC_400 invalid subject'; end if;
  if operation = 'confirm' then
    if length(trim(document_row.content)) = 0 then raise exception 'CENTER_DOC_400 content is required before confirmation'; end if;
    update public.center_documents set status = 'confirmed', confirmed_at = now(), updated_at = now(), version = version + 1 where id = document_row.id returning * into document_row;
  else


    if jsonb_typeof(p_mutation -> 'title') is distinct from 'string' or jsonb_typeof(p_mutation -> 'content') is distinct from 'string' or jsonb_typeof(p_mutation -> 'period') is distinct from 'string' or jsonb_typeof(p_mutation -> 'resultEvaluationCompleted') is distinct from 'boolean' then raise exception 'CENTER_DOC_400 invalid field types'; end if;
    if operation = 'create' then
      insert into public.center_documents(organization_code,template_id,title,subject_kind,subject_id,period,content,result_evaluation_completed)
      values(p_organization_code,p_mutation ->> 'templateId',p_mutation ->> 'title',target_kind,case when target_kind = 'patient' then patient_uuid::text else null end,p_mutation ->> 'period',p_mutation ->> 'content',(p_mutation ->> 'resultEvaluationCompleted')::boolean) returning * into document_row;
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
