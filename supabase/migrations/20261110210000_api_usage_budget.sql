-- Hard monthly budget for paid external APIs (Google Places Text Search).
-- Every call must first reserve a slot through reserve_api_calls(); once the
-- month's limit is reached the function returns false and the caller skips
-- the request, so usage can never go past Google's free allowance.

create table if not exists public.api_usage (
  api text not null,
  month text not null,            -- 'YYYY-MM' (UTC)
  calls integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (api, month)
);

-- No policies: the table is only reachable through the function below.
alter table public.api_usage enable row level security;

create or replace function public.reserve_api_calls(
  p_api text,
  p_calls integer,
  p_monthly_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_reserved boolean;
begin
  -- Server-side ceiling: no caller can raise the cap past the free tier.
  p_monthly_limit := least(p_monthly_limit, 900);

  if p_calls < 1 or p_calls > p_monthly_limit then
    return false;
  end if;

  insert into public.api_usage (api, month, calls)
  values (p_api, v_month, 0)
  on conflict (api, month) do nothing;

  update public.api_usage
     set calls = calls + p_calls,
         updated_at = now()
   where api = p_api
     and month = v_month
     and calls + p_calls <= p_monthly_limit
  returning true into v_reserved;

  return coalesce(v_reserved, false);
end;
$$;

revoke all on function public.reserve_api_calls(text, integer, integer) from public;
-- Server only: the app calls this with the service-role key.
revoke execute on function public.reserve_api_calls(text, integer, integer)
  from anon, authenticated;
grant execute on function public.reserve_api_calls(text, integer, integer)
  to service_role;
