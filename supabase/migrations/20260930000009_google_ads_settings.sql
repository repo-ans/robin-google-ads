-- Google Ads API settings entered on the dashboard (Settings page, rob_admin).
--
-- Where things live (PLAN.md 3.5):
--   - Google Ads developer token, OAuth client id/secret, refresh token, MCC id:
--     here, in private.google_ads_secrets. Entered on the dashboard, saved by
--     n8n (ff-google-ads-settings), read by n8n. The browser can never read a
--     value back - it only sees "set / not set", when, and a short hint.
--   - Supabase service role key, OpenAI, Slack, DataForSEO: n8n credentials.
--
-- Schema `private` is not exposed by the API (only public is). The table has
-- RLS on with no policies, and anon/authenticated have no privileges on it.
-- The reference kept these in google_ads_settings, readable and editable by
-- any logged-in user; this replaces that.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.google_ads_secrets (
  name       text primary key
               check (name in ('developer_token', 'client_id', 'client_secret', 'refresh_token', 'mcc_id')),
  value      text not null check (length(value) between 1 and 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table private.google_ads_secrets enable row level security;
revoke all on private.google_ads_secrets from public, anon, authenticated;

-- n8n reads all values (service role only).
create or replace function public.ff_google_ads_secrets()
returns json
language sql stable security definer
set search_path = ''
as $$
  select coalesce(json_object_agg(s.name, s.value), '{}'::json) from private.google_ads_secrets s
$$;

-- n8n saves values (service role only). Only the five known names; empty
-- values are ignored (so a blank field on the form means "keep the old one").
create or replace function public.ff_set_google_ads_secrets(p_values jsonb, p_user uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  k text;
  v text;
  n int := 0;
begin
  foreach k in array array['developer_token', 'client_id', 'client_secret', 'refresh_token', 'mcc_id'] loop
    v := btrim(coalesce(p_values ->> k, ''));
    continue when v = '';
    if k = 'mcc_id' then
      v := regexp_replace(v, '[^0-9]', '', 'g');
      if v !~ '^[0-9]{10}$' then
        raise exception 'mcc_id must be 10 digits';
      end if;
    end if;
    insert into private.google_ads_secrets (name, value, updated_at, updated_by)
    values (k, v, now(), p_user)
    on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.ff_google_ads_secrets() from public, anon, authenticated;
revoke all on function public.ff_set_google_ads_secrets(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.ff_google_ads_secrets() to service_role;
grant execute on function public.ff_set_google_ads_secrets(jsonb, uuid) to service_role;

-- What the dashboard may see: set or not, when, by whom, and a hint that is
-- safe to show (client id and MCC id in full - they are not secrets and the
-- client id is needed for "Connect with Google"; the developer token's last
-- 4 characters; nothing at all for the client secret and refresh token).
-- Agency roles only; a client login gets no rows.
create or replace function public.google_ads_connection_status()
returns table (name text, is_set boolean, hint text, updated_at timestamptz, updated_by_email text)
language sql stable security definer
set search_path = ''
as $$
  select n.name,
         s.value is not null,
         case n.name
           when 'client_id' then s.value
           when 'mcc_id' then regexp_replace(s.value, '^(\d{3})(\d{3})(\d{4})$', '\1-\2-\3')
           when 'developer_token' then case when s.value is null then null else '...' || right(s.value, 4) end
           else null
         end,
         s.updated_at,
         p.email
  from (values ('developer_token', 1), ('client_id', 2), ('client_secret', 3), ('refresh_token', 4), ('mcc_id', 5)) n(name, ord)
  left join private.google_ads_secrets s on s.name = n.name
  left join public.profiles p on p.user_id = s.updated_by
  where app.is_agency()
  order by n.ord
$$;

revoke all on function public.google_ads_connection_status() from public, anon;
grant execute on function public.google_ads_connection_status() to authenticated;
