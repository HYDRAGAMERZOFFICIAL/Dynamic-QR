-- Dynamic QR: initial production schema.
-- Run with: supabase db push
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  title text not null default 'Untitled QR',
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  design jsonb not null default '{"style":"square","foreground":"#111827","background":"#ffffff","dots":"square","corner":"square"}'::jsonb,
  draft_content jsonb not null default '{"sections":[]}'::jsonb,
  published_content jsonb not null default '{"sections":[]}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.qr_passwords (
  qr_id uuid primary key references public.qr_codes(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.qr_passwords from public, anon, authenticated;

create index if not exists qr_codes_owner_status_idx on public.qr_codes(owner_id, status);
create index if not exists qr_codes_slug_idx on public.qr_codes(slug);

create table if not exists public.qr_content_versions (
  id uuid primary key default gen_random_uuid(),
  qr_id uuid not null references public.qr_codes(id) on delete cascade,
  version_number integer not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique(qr_id, version_number)
);

create table if not exists public.qr_files (
  id uuid primary key default gen_random_uuid(),
  qr_id uuid not null references public.qr_codes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.qr_scans (
  id bigint generated always as identity primary key,
  qr_id uuid not null references public.qr_codes(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  user_agent text
);

alter table public.profiles enable row level security;
alter table public.qr_codes enable row level security;
alter table public.qr_content_versions enable row level security;
alter table public.qr_files enable row level security;
alter table public.qr_scans enable row level security;

revoke all on public.profiles, public.qr_codes, public.qr_content_versions, public.qr_files, public.qr_scans from anon;
revoke all on public.profiles, public.qr_codes, public.qr_content_versions, public.qr_files, public.qr_scans from authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, delete on public.qr_codes to authenticated;\ngrant update (title, design, draft_content, updated_at) on public.qr_codes to authenticated;
grant select on public.qr_content_versions to authenticated;
grant select, insert, delete on public.qr_files to authenticated;
grant select on public.qr_scans to authenticated;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "qr_select_own" on public.qr_codes for select to authenticated using ((select auth.uid()) = owner_id);
create policy "qr_update_own" on public.qr_codes for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "qr_delete_own" on public.qr_codes for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "versions_select_owned_qr" on public.qr_content_versions for select to authenticated
using (exists (select 1 from public.qr_codes q where q.id = qr_id and q.owner_id = (select auth.uid())));
create policy "files_select_own" on public.qr_files for select to authenticated using ((select auth.uid()) = owner_id);
create policy "files_insert_own" on public.qr_files for insert to authenticated with check ((select auth.uid()) = owner_id and exists (select 1 from public.qr_codes q where q.id = qr_id and q.owner_id = (select auth.uid())));
create policy "files_delete_own" on public.qr_files for delete to authenticated using ((select auth.uid()) = owner_id);
create policy "scans_select_owned_qr" on public.qr_scans for select to authenticated
using (exists (select 1 from public.qr_codes q where q.id = qr_id and q.owner_id = (select auth.uid())));

-- Serialize QR creation per user so concurrent requests cannot exceed three active codes.
create or replace function public.create_qr(p_title text, p_design jsonb default '{}'::jsonb)
returns public.qr_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_qr public.qr_codes;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if (select count(*) from public.qr_codes where owner_id = v_user and status = 'active') >= 3 then
    raise exception 'QR_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  insert into public.qr_codes(owner_id, slug, title, design)
  values (v_user, encode(extensions.gen_random_bytes(7), 'hex'), coalesce(nullif(trim(p_title), ''), 'Untitled QR'), coalesce(p_design, '{}'::jsonb))
  returning * into v_qr;
  return v_qr;
end;
$$;
revoke all on function public.create_qr(text, jsonb) from public, anon;
grant execute on function public.create_qr(text, jsonb) to authenticated;

-- Publish a complete draft snapshot atomically; the QR slug never changes.
create or replace function public.publish_qr(p_qr_id uuid)
returns public.qr_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qr public.qr_codes;
  v_next integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_qr from public.qr_codes
    where id = p_qr_id and owner_id = auth.uid() for update;
  if not found then raise exception 'QR_NOT_FOUND'; end if;
  select coalesce(max(version_number), 0) + 1 into v_next
    from public.qr_content_versions where qr_id = p_qr_id;
  insert into public.qr_content_versions(qr_id, version_number, content)
    values (p_qr_id, v_next, v_qr.draft_content);
  update public.qr_codes set published_content = draft_content,
    published_at = now(), updated_at = now()
    where id = p_qr_id returning * into v_qr;
  return v_qr;
end;
$$;
revoke all on function public.publish_qr(uuid) from public, anon;
grant execute on function public.publish_qr(uuid) to authenticated;


-- Status changes are serialized too, so a paused QR cannot be reactivated as a fourth active code.
create or replace function public.set_qr_status(p_qr_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_status not in ('active', 'paused', 'archived') then raise exception 'Invalid QR status'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if p_status = 'active' and (select count(*) from public.qr_codes where owner_id = v_user and status = 'active' and id <> p_qr_id) >= 3 then
    raise exception 'QR_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  update public.qr_codes set status = p_status, updated_at = now()
    where id = p_qr_id and owner_id = v_user;
  if not found then raise exception 'QR_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.set_qr_status(uuid, text) from public, anon;
grant execute on function public.set_qr_status(uuid, text) to authenticated;

-- Public read endpoint: password-protected pages never expose the stored hash.
create or replace function public.get_qr_content(p_slug text, p_password text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_qr public.qr_codes;
  v_password_hash text;
begin
  select * into v_qr from public.qr_codes where slug = p_slug and status = 'active';
  if not found or v_qr.published_at is null then return null; end if;
  select password_hash into v_password_hash from private.qr_passwords where qr_id = v_qr.id;
  if v_password_hash is not null then
    if p_password is null or extensions.crypt(p_password, v_password_hash) <> v_password_hash then
      return jsonb_build_object('password_required', true);
    end if;
  end if;
  insert into public.qr_scans(qr_id, user_agent) values (v_qr.id, null);
  return jsonb_build_object('title', v_qr.title, 'content', v_qr.published_content, 'design', v_qr.design, 'published_at', v_qr.published_at);
end;
$$;
revoke all on function public.get_qr_content(text, text) from public;
grant execute on function public.get_qr_content(text, text) to anon, authenticated;

create or replace function public.set_qr_password(p_qr_id uuid, p_password text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_password is not null and length(p_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  if not exists (select 1 from public.qr_codes where id = p_qr_id and owner_id = auth.uid()) then raise exception 'QR_NOT_FOUND'; end if;
  if p_password is null or p_password = '' then
    delete from private.qr_passwords where qr_id = p_qr_id;
  else
    insert into private.qr_passwords(qr_id, password_hash, updated_at)
      values (p_qr_id, extensions.crypt(p_password, extensions.gen_salt('bf')), now())
      on conflict (qr_id) do update set password_hash = excluded.password_hash, updated_at = now();
  end if;
end;
$$;
revoke all on function public.set_qr_password(uuid, text) from public, anon;
grant execute on function public.set_qr_password(uuid, text) to authenticated;

-- Private bucket; objects are only accessible to the owning user through authenticated policies.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('qr-assets', 'qr-assets', false, 26214400, array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "qr_assets_insert_own_folder" on storage.objects for insert to authenticated
with check (bucket_id = 'qr-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "qr_assets_select_own_folder" on storage.objects for select to authenticated
using (bucket_id = 'qr-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "qr_assets_delete_own_folder" on storage.objects for delete to authenticated
using (bucket_id = 'qr-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
