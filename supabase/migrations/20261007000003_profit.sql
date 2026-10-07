-- Profit and loss in one line for the client (CEO, 2026-10-07): "you spent X,
-- the ads brought back Y". Money back counts only real money:
--   - signed cases: the "Case signed" uploads (monthly case match), at their value
--   - online sales: website purchase conversions (online cremation), at the amount paid
-- Calls and form requests are leads, not money, so they are counted, not valued.
-- One row per month. Security definer with one access check (the same rule RLS
-- uses), so it stays fast on large accounts.

create or replace function public.dash_client_profit(p_client_id uuid, p_from date, p_to date)
returns table (
  month date, currency_code text, cost_micros bigint,
  signed_cases numeric, signed_value numeric, sales numeric, sales_value numeric,
  calls_90s numeric, forms numeric
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not app.can_read_client(p_client_id) then
    return;
  end if;
  return query
    with acct as (
      select a.customer_id, a.currency_code from public.ad_accounts a
      where a.client_id = p_client_id and not a.is_manager
    ),
    spend as (
      select date_trunc('month', d.date)::date as m, sum(d.cost_micros)::bigint as cost
      from public.campaign_daily d join acct on acct.customer_id = d.customer_id
      where d.date between p_from and p_to
      group by 1
    ),
    kinds as (
      select x.customer_id, x.conversion_action_id,
             case
               when x.type in ('UPLOAD_CLICKS', 'UPLOAD_CALLS') and (x.name ilike 'case signed%' or x.name ilike 'ff - signed case%') then 'signed'
               when x.type = 'WEBPAGE' and x.category = 'PURCHASE' then 'sale'
               when x.type in ('AD_CALL', 'WEBSITE_CALL') then 'call'
               when x.type = 'WEBPAGE' and x.category = 'SUBMIT_LEAD_FORM' then 'form'
             end as kind
      from public.conversion_actions x join acct on acct.customer_id = x.customer_id
    ),
    conv as (
      select date_trunc('month', c.date)::date as m,
             sum(c.conversions) filter (where k.kind = 'signed') as signed_cases,
             sum(c.conversions_value) filter (where k.kind = 'signed') as signed_value,
             sum(c.conversions) filter (where k.kind = 'sale') as sales,
             sum(c.conversions_value) filter (where k.kind = 'sale') as sales_value,
             sum(c.conversions) filter (where k.kind = 'call') as calls,
             sum(c.conversions) filter (where k.kind = 'form') as forms
      from public.conversion_daily c
      join kinds k on k.customer_id = c.customer_id and k.conversion_action_id = c.conversion_action_id
      where c.date between p_from and p_to
      group by 1
    ),
    months as (select m from spend union select m from conv)
    select ms.m, (select min(acct.currency_code) from acct), coalesce(s.cost, 0)::bigint,
           coalesce(c.signed_cases, 0), coalesce(c.signed_value, 0), coalesce(c.sales, 0), coalesce(c.sales_value, 0),
           coalesce(c.calls, 0), coalesce(c.forms, 0)
    from months ms
    left join spend s on s.m = ms.m
    left join conv c on c.m = ms.m
    order by ms.m;
end;
$$;

revoke all on function public.dash_client_profit(uuid, date, date) from public, anon;
grant execute on function public.dash_client_profit(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
