-- Every Google Ads account is a client (Manam, 2026-10-01).
-- ff-sync calls ff_auto_create_clients() after it upserts the MCC's accounts:
-- each account that has no client yet gets its own client, named after the
-- account. Closed or cancelled accounts get a client that is archived (hidden
-- by default). Staff can still move an account to another client on the
-- Google Ads accounts page.

create or replace function public.ff_auto_create_clients()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  a record;
  new_id uuid;
  base text;
  n int := 0;
begin
  for a in
    select customer_id, descriptive_name, currency_code, status
    from public.ad_accounts
    where client_id is null and not is_manager
    order by customer_id
  loop
    base := btrim(regexp_replace(lower(coalesce(a.descriptive_name, 'account')), '[^a-z0-9]+', '-', 'g'), '-');
    if base = '' then base := 'account'; end if;
    insert into public.clients (name, slug, currency_code, archived_at)
    values (
      coalesce(nullif(btrim(a.descriptive_name), ''), 'Account ' || a.customer_id),
      left(base, 50) || '-' || right(a.customer_id, 4) || '-' || substr(a.customer_id, 1, 3),
      case when a.currency_code ~ '^[A-Z]{3}$' then a.currency_code end,
      case when a.status in ('CANCELED', 'CLOSED', 'SUSPENDED') then now() end
    )
    returning id into new_id;
    update public.ad_accounts set client_id = new_id where customer_id = a.customer_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.ff_auto_create_clients() from public, anon, authenticated;
grant execute on function public.ff_auto_create_clients() to service_role;

-- The accounts already synced become clients now.
select public.ff_auto_create_clients();
