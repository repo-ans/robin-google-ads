-- PDF task 8, monthly part: "cases matched and cost per signed case" in Rob's
-- Monday note on the first Monday of each month (n8n ff-weekly-report).
-- Per client for one month: signed families in the uploaded lists (every case
-- in the list - matched or not), how many Google Ads matched, and the month's spend.
-- Counts only.

create or replace function public.ff_month_cases(p_month date)
returns table (client_id uuid, client_name text, currency_code text, spend_micros bigint, signed_cases int, matched int)
language sql stable security definer
set search_path = ''
as $$
  with m as (select date_trunc('month', p_month)::date as m0, (date_trunc('month', p_month) + interval '1 month - 1 day')::date as m1),
  runs as (
    select r.client_id, sum(r.cases_in)::int as signed_cases, sum(r.accepted)::int as matched
    from public.case_match_runs r, m
    where r.month = m.m0 and not r.validate_only and r.status in ('ok', 'partial')
    group by r.client_id
  ),
  spend as (
    select a.client_id, min(a.currency_code) as currency_code, sum(d.cost_micros)::bigint as spend
    from public.campaign_daily d
    join public.ad_accounts a on a.customer_id = d.customer_id and a.client_id is not null
    cross join m
    where d.date between m.m0 and m.m1
    group by a.client_id
  )
  select c.id, c.name, s.currency_code, coalesce(s.spend, 0), coalesce(r.signed_cases, 0), coalesce(r.matched, 0)
  from public.clients c
  left join runs r on r.client_id = c.id
  left join spend s on s.client_id = c.id
  where c.archived_at is null and (coalesce(s.spend, 0) > 0 or r.client_id is not null)
  order by coalesce(s.spend, 0) desc
$$;

revoke all on function public.ff_month_cases(date) from public, anon, authenticated;
grant execute on function public.ff_month_cases(date) to service_role;

notify pgrst, 'reload schema';
