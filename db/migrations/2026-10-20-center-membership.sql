-- Apply before deployment. Initial administrators are activated by a trusted operator
-- after they sign up and verify email; no account addresses belong in this migration.
begin;
create table if not exists public.center_organizations (
  code text primary key check (code ~ '^[A-Z0-9_-]{2,40}$'),
  name text not null, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.center_members (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_code text not null references public.center_organizations(code),
  name text not null check (length(name) between 1 and 60), email text not null,
  requested_role text not null default 'caregiver' check (requested_role in ('admin','caregiver')),
  role text not null default 'caregiver' check (role in ('admin','caregiver')),
  status text not null default 'pending' check (status in ('pending','active','rejected','suspended')),
  participant_code text unique references public.participants(code),
  approved_by_master text, approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists center_members_org_status on public.center_members(organization_code,status);
alter table public.center_organizations enable row level security;
alter table public.center_members enable row level security;
revoke all on public.center_organizations, public.center_members from anon, authenticated;
grant all on public.center_organizations, public.center_members to service_role;
create or replace function public.create_pending_center_member()
returns trigger language plpgsql security definer set search_path = '' as $$
declare org_code text := upper(trim(new.raw_user_meta_data ->> 'organization_code'));
begin
  if org_code is null or org_code = '' then return new; end if;
  if not exists(select 1 from public.center_organizations where code = org_code and active) then raise exception 'Unknown organization'; end if;
  insert into public.center_members(id,organization_code,name,email,requested_role,role,status)
  values(new.id,org_code,trim(new.raw_user_meta_data ->> 'name'),new.email,
    case when new.raw_user_meta_data ->> 'requested_role' = 'admin' then 'admin' else 'caregiver' end,
    'caregiver','pending');
  return new;
end $$;
revoke all on function public.create_pending_center_member() from public, anon, authenticated;
drop trigger if exists create_pending_center_member on auth.users;
create trigger create_pending_center_member after insert on auth.users
for each row execute function public.create_pending_center_member();
commit;
