begin;
alter table public.leads add column if not exists source_key text;
create unique index if not exists leads_source_key on public.leads(source_key);
-- Se conserva todo conflicto histórico para revisión; no se asigna una identidad ambigua.
update public.leads l set source_key=l.metadata->>'place_id' where source_key is null and metadata->>'place_id' is not null and (select count(*) from public.leads x where x.metadata->>'place_id'=l.metadata->>'place_id')=1;
drop index if exists public.unique_name_company;
alter table public.bizmap_leads
 add column if not exists source_key text,
 add column if not exists source text,
 add column if not exists latitude double precision check(latitude between -90 and 90),
 add column if not exists longitude double precision check(longitude between -180 and 180),
 add column if not exists discovered_at timestamptz,
 add column if not exists source_metadata jsonb not null default '{}'::jsonb,
 add column if not exists commercial_status text not null default 'new' check(commercial_status in ('new','contacted','replied','won','lost')),
 add column if not exists next_action_at timestamptz,
 add column if not exists operator_notes text;
create unique index if not exists bizmap_source_key on public.bizmap_leads(source_key);
create table public.lead_links (
 lead_id uuid references public.leads(id), bizmap_lead_id uuid references public.bizmap_leads(id),
 evidence text not null, primary key(lead_id,bizmap_lead_id)
);
alter table public.lead_links enable row level security;
revoke all on public.lead_links from public,anon,authenticated;
create table public.discovery_runs (
 run_key text primary key, status text not null, lease_until timestamptz,
 result jsonb, updated_at timestamptz not null default now()
);
alter table public.discovery_runs enable row level security;
revoke all on public.discovery_runs from public,anon,authenticated;
create or replace function public.claim_discovery(p_key text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into discovery_runs(run_key,status,lease_until) values(p_key,'running',now()+interval '10 minutes')
 on conflict(run_key) do update set status='running',lease_until=excluded.lease_until where discovery_runs.lease_until<now() and discovery_runs.status<>'complete';
 return found;
end $$;
revoke execute on function public.claim_discovery(text) from public,anon,authenticated;
grant execute on function public.claim_discovery(text) to service_role;
commit;
