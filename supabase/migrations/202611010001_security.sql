begin;
revoke create on schema public from public,anon,authenticated;
-- Bloquea también tablas de respaldo del CRM que pueden conservar información personal.
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='public' and (tablename in ('leads','lead_conversations','outreach_campaigns','outreach_messages','outreach_replies') or tablename like 'bizmap_leads%') loop
 execute format('alter table public.%I enable row level security',r.tablename);
 execute format('revoke all on public.%I from public, anon, authenticated',r.tablename);
 end loop;
end $$;
-- No hay acceso directo de operadores a las tablas: API autorizada + service_role.
drop policy if exists "anon can read bizmap_leads" on public.bizmap_leads;
create table if not exists public.integration_inbox (
 id uuid primary key default gen_random_uuid(), provider text not null, event_id text not null,
 kind text not null, payload jsonb not null, status text not null default 'queued',
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_until timestamptz, lease_token uuid, last_error text, created_at timestamptz not null default now(),
 unique(provider,event_id)
);
alter table public.integration_inbox enable row level security;
revoke all on public.integration_inbox from public, anon, authenticated;
-- Los RPC históricos no deben ser invocables desde el navegador.
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('mark_campaign_messages_sent','format_wa_phone') loop
 execute format('revoke execute on function %s from public, anon, authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
commit;
