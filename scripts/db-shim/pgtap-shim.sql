-- Local-only: the handful of pgTAP functions supabase/tests/rls.test.sql uses,
-- for a PostgreSQL that does not have the pgtap extension installed.
-- Output format matches pgTAP ("ok N - ...", "not ok N - ..."), so the runner
-- reads it the same way. Real Supabase projects use the real pgtap extension.
--
-- Counters live in session settings, not tables, so tests running as
-- anon/authenticated (which cannot write anywhere) can still record results.

create or replace function extensions._tap_next(p_ok boolean, p_descr text, p_diag text default null)
returns text
language plpgsql
as $$
declare
  n int := coalesce(nullif(current_setting('tap.n', true), '')::int, 0) + 1;
  failed int := coalesce(nullif(current_setting('tap.failed', true), '')::int, 0);
begin
  perform set_config('tap.n', n::text, false);
  if not p_ok then
    perform set_config('tap.failed', (failed + 1)::text, false);
  end if;
  return (case when p_ok then 'ok ' else 'not ok ' end) || n || ' - ' || coalesce(p_descr, '')
    || case when not p_ok and p_diag is not null then E'\n# ' || p_diag else '' end;
end;
$$;

create or replace function extensions.no_plan()
returns setof text
language plpgsql
as $$
begin
  perform set_config('tap.n', '0', false);
  perform set_config('tap.failed', '0', false);
  return;
end;
$$;

create or replace function extensions.ok(p_ok boolean, p_descr text)
returns text
language sql
as $$
  select extensions._tap_next(coalesce(p_ok, false), p_descr, 'got false or null')
$$;

create or replace function extensions.is(p_have anyelement, p_want anyelement, p_descr text)
returns text
language sql
as $$
  select extensions._tap_next(
    p_have is not distinct from p_want,
    p_descr,
    format('have: %s | want: %s', coalesce(p_have::text, 'NULL'), coalesce(p_want::text, 'NULL')))
$$;

create or replace function extensions.throws_ok(p_sql text, p_errcode text, p_errmsg text, p_descr text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return extensions._tap_next(false, p_descr, 'no error was raised');
exception when others then
  if p_errcode is null or sqlstate = p_errcode then
    return extensions._tap_next(true, p_descr);
  end if;
  return extensions._tap_next(false, p_descr, format('raised %s (%s), wanted %s', sqlstate, sqlerrm, p_errcode));
end;
$$;

create or replace function extensions.finish()
returns setof text
language plpgsql
as $$
declare
  n int := coalesce(nullif(current_setting('tap.n', true), '')::int, 0);
  failed int := coalesce(nullif(current_setting('tap.failed', true), '')::int, 0);
begin
  return next '1..' || n;
  if failed > 0 then
    return next format('# Looks like you failed %s test(s) of %s', failed, n);
  end if;
end;
$$;

grant execute on all functions in schema extensions to anon, authenticated, service_role;
