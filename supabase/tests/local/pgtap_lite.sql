-- The subset of pgTAP used by supabase/tests/database, for local runs without the pgTAP
-- extension. Output follows TAP so failures read the same. Real runs use `supabase test db`.

create function plan(n int) returns setof text language plpgsql as $$
begin
  create temp table if not exists __tap (n serial, ok boolean, descr text);
  create temp table if not exists __tap_plan (planned int);
  grant all on __tap_plan to public;
  insert into __tap_plan values (n);
  -- tests switch to the authenticated role mid-file
  grant all on __tap to public;
  grant all on sequence __tap_n_seq to public;
  return next '1..' || n;
end $$;

create function __record(p_ok boolean, p_descr text, p_diag text default null) returns text language plpgsql as $$
declare v_n int;
begin
  insert into __tap (ok, descr) values (coalesce(p_ok, false), p_descr) returning n into v_n;
  return case when coalesce(p_ok, false) then 'ok ' else 'not ok ' end || v_n || ' - ' || coalesce(p_descr, '')
         || case when not coalesce(p_ok, false) and p_diag is not null then E'\n# ' || p_diag else '' end;
end $$;

create function ok(p boolean, d text default '') returns text language sql as $$ select __record(p, d) $$;

create function is(got anyelement, want anyelement, d text default '') returns text language sql as $$
  select __record(got is not distinct from want, d, format('have: %s  want: %s', got, want))
$$;

create function isnt(got anyelement, want anyelement, d text default '') returns text language sql as $$
  select __record(got is distinct from want, d, format('both: %s', got))
$$;

create function lives_ok(sql text, d text default '') returns text language plpgsql as $$
begin
  execute sql;
  return __record(true, d);
exception when others then
  return __record(false, d, sqlstate || ': ' || sqlerrm);
end $$;

-- throws_ok(sql, errcode, errmsg, description); errmsg null = any message
create function throws_ok(sql text, errcode text, errmsg text, d text default '') returns text language plpgsql as $$
begin
  execute sql;
  return __record(false, d, 'no exception raised');
exception when others then
  return __record(sqlstate = errcode and (errmsg is null or sqlerrm = errmsg), d,
                  format('got %s: %s', sqlstate, sqlerrm));
end $$;

create function is_empty(sql text, d text default '') returns text language plpgsql as $$
declare v_found boolean;
begin
  execute format('select exists (%s)', sql) into v_found;
  return __record(not v_found, d, 'query returned rows');
end $$;

create function finish() returns setof text language plpgsql as $$
declare v_failed int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_failed, v_total from __tap;
  if v_failed > 0 then
    return next format('# Looks like you failed %s test(s) of %s', v_failed, v_total);
  end if;
  -- Same check real pgTAP makes: the declared plan must match what ran.
  if (select planned from __tap_plan limit 1) <> v_total then
    return next format('not ok - planned %s test(s) but ran %s', (select planned from __tap_plan limit 1), v_total);
  end if;
end $$;

grant execute on all functions in schema public to public;
