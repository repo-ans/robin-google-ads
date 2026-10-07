-- Fewer buttons (Manam, 2026-10-07): after each daily website check, n8n fills
-- in what the system can learn by itself, for every client:
--   - client type: a page with real online payment (WooCommerce, Stripe, PayPal,
--     Square, a GHL order form) makes the client "online_cremation", otherwise
--     "funeral_home" - unless FF set the type by hand (process_source = 'manual')
--   - website: the home page of the most used ad landing page, when empty
--   - business phone: the number on the account's call asset, when empty
-- The GHL sub-account is matched by n8n (name, website or phone) and saved with
-- ff_set_ghl_location.

alter table public.clients
  add column process_source text not null default 'auto' check (process_source in ('auto', 'manual'));

create or replace function public.ff_apply_website_findings(p_client_id uuid default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  n int := 0;
  k int;
begin
  -- client type from the latest website check
  update public.clients c
     set process = case when exists (
           select 1 from public.website_checks w
           where w.client_id = c.id and w.error is null and w.has_checkout
             and w.checkout_hint in ('stripe', 'woocommerce', 'paypal', 'square', 'ghl order form')
         ) then 'online_cremation' else 'funeral_home' end,
         updated_at = now()
   where c.process_source = 'auto' and c.archived_at is null
     and (p_client_id is null or c.id = p_client_id)
     and exists (select 1 from public.website_checks w where w.client_id = c.id and w.error is null)
     and c.process is distinct from (case when exists (
           select 1 from public.website_checks w
           where w.client_id = c.id and w.error is null and w.has_checkout
             and w.checkout_hint in ('stripe', 'woocommerce', 'paypal', 'square', 'ghl order form')
         ) then 'online_cremation' else 'funeral_home' end);
  get diagnostics k = row_count; n := n + k;

  -- website from the ads, when empty
  update public.clients c
     set website_url = (
           select substring(u.url from '^(https?://[^/?#]+)') || '/'
           from public.ads d
           join public.ad_accounts a on a.customer_id = d.customer_id and a.client_id = c.id
           cross join lateral unnest(d.final_urls) as u(url)
           where d.removed_at is null and d.status = 'ENABLED' and u.url ~ '^https?://'
           group by 1 order by count(*) desc limit 1),
         updated_at = now()
   where (c.website_url is null or c.website_url = '') and c.archived_at is null
     and (p_client_id is null or c.id = p_client_id)
     and exists (select 1 from public.ads d join public.ad_accounts a on a.customer_id = d.customer_id
                 where a.client_id = c.id and d.removed_at is null and d.status = 'ENABLED' and cardinality(d.final_urls) > 0);
  get diagnostics k = row_count; n := n + k;

  -- business phone from the call asset, when empty
  update public.clients c
     set phone = (
           select z.phone_number from public.assets z
           join public.ad_accounts a on a.customer_id = z.customer_id and a.client_id = c.id
           where z.field_type = 'CALL' and z.removed_at is null and z.phone_number is not null
           order by (z.level = 'account') desc, z.synced_at desc limit 1),
         updated_at = now()
   where (c.phone is null or c.phone = '') and c.archived_at is null
     and (p_client_id is null or c.id = p_client_id)
     and exists (select 1 from public.assets z join public.ad_accounts a on a.customer_id = z.customer_id
                 where a.client_id = c.id and z.field_type = 'CALL' and z.removed_at is null and z.phone_number is not null);
  get diagnostics k = row_count; n := n + k;

  return n;
end;
$$;

revoke all on function public.ff_apply_website_findings(uuid) from public, anon, authenticated;
grant execute on function public.ff_apply_website_findings(uuid) to service_role;

-- Clients n8n tries to match to a GHL sub-account (none linked yet).
create or replace function public.ff_clients_without_ghl()
returns table (client_id uuid, name text, website_url text, phone text)
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.name, c.website_url, c.phone
  from public.clients c
  where c.archived_at is null and (c.ghl_location_id is null or c.ghl_location_id = '')
$$;

revoke all on function public.ff_clients_without_ghl() from public, anon, authenticated;
grant execute on function public.ff_clients_without_ghl() to service_role;

notify pgrst, 'reload schema';
