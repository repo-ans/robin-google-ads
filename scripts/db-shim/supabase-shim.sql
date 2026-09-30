-- Local-only stand-in for the parts of Supabase the migrations and RLS tests use,
-- so they can run on a plain PostgreSQL (no Docker). Loaded into a throwaway
-- database by scripts/test-db-local.mjs before the migrations. Never applied to
-- a real Supabase project (those already have all of this).
--
-- Mirrors Supabase where it matters for RLS:
--   - roles anon, authenticated, service_role (service_role bypasses RLS)
--   - auth.users and auth.uid() reading request.jwt.claims
--   - Supabase's default privileges: anon and authenticated get ALL on new
--     tables in public. That is exactly what migration 5 has to revoke, so the
--     tests prove the revokes work rather than passing by accident.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

-- The connecting superuser must be able to SET ROLE to these (it can, as superuser).

create schema if not exists extensions;
create schema if not exists auth;

create table auth.users (
  id    uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase defaults for objects the migration user creates in public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
