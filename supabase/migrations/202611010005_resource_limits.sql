begin;
create table public.resource_limits(resource text primary key,next_at timestamptz not null default now(),day date not null default current_date,used integer not null default 0);
alter table public.resource_limits enable row level security;
revoke all on public.resource_limits from public,anon,authenticated;
create or replace function public.reserve_resource(p_resource text,p_limit integer,p_spacing integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare r public.resource_limits;
begin
 insert into resource_limits(resource) values(p_resource) on conflict do nothing;
 select * into r from resource_limits where resource=p_resource for update;
 if r.day<>current_date then r.used=0; end if;
 if r.next_at>now() or r.used>=p_limit then return false; end if;
 update resource_limits set used=r.used+1,day=current_date,next_at=now()+make_interval(secs=>p_spacing) where resource=p_resource;
 return true;
end $$;
revoke execute on function public.reserve_resource(text,integer,integer) from public,anon,authenticated;
grant execute on function public.reserve_resource(text,integer,integer) to service_role;
commit;
