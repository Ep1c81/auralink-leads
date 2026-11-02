-- Fases C y D: procedencia de datos, identidad de fuente, seguimiento
-- comercial y relación explícita leads <-> bizmap_leads.
--
-- Solo agrega columnas nulas, índices y una tabla de ejecuciones. No borra
-- ni reescribe datos existentes; el único UPDATE copia un id ya guardado en
-- leads.metadata a una columna con FK (validada contra bizmap_leads).

-- ---------------------------------------------------------------------------
-- Procedencia e identidad de fuente (OSM: proveedor + tipo + id)
alter table public.bizmap_leads
    add column if not exists source_provider text,
    add column if not exists source_object_type text,
    add column if not exists source_object_id text,
    add column if not exists latitude double precision
        check (latitude is null or latitude between -90 and 90),
    add column if not exists longitude double precision
        check (longitude is null or longitude between -180 and 180),
    add column if not exists raw_address text,
    add column if not exists discovered_at timestamptz,
    add column if not exists discovery_run_id uuid,
    -- 'ia_estimada' | 'heuristica' | 'manual': el puntaje es una estimación.
    add column if not exists score_method text,
    add column if not exists score_reason text;

-- La identidad de fuente es la garantía de deduplicación (no el nombre, que
-- es mutable y lo comparten sucursales distintas).
create unique index if not exists bizmap_leads_source_identity
    on public.bizmap_leads (source_provider, source_object_type, source_object_id)
    where source_object_id is not null;

-- ---------------------------------------------------------------------------
-- Seguimiento comercial
alter table public.bizmap_leads
    add column if not exists pipeline_stage text
        check (pipeline_stage in ('nuevo', 'contactado', 'respondio', 'seguimiento', 'ganado', 'perdido')),
    add column if not exists next_action text,
    add column if not exists next_action_at timestamptz,
    add column if not exists last_reply_at timestamptz,
    add column if not exists lost_reason text,
    add column if not exists notes text,
    add column if not exists won_at timestamptz,
    add column if not exists lost_at timestamptz;

create index if not exists idx_bizmap_leads_pipeline on public.bizmap_leads (pipeline_stage, next_action_at);
create index if not exists idx_bizmap_leads_type on public.bizmap_leads (business_type);
create index if not exists idx_bizmap_leads_score on public.bizmap_leads (lead_score desc, created_at desc, id);

-- ---------------------------------------------------------------------------
-- Relación explícita leads -> bizmap_leads (antes solo en metadata)
alter table public.leads
    add column if not exists bizmap_lead_id uuid references public.bizmap_leads (id) on delete set null;
create index if not exists idx_leads_bizmap_lead_id on public.leads (bizmap_lead_id);

update public.leads l
set bizmap_lead_id = (l.metadata ->> 'bizmap_lead_id')::uuid
where l.bizmap_lead_id is null
  and (l.metadata ->> 'bizmap_lead_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (select 1 from public.bizmap_leads b where b.id = (l.metadata ->> 'bizmap_lead_id')::uuid);

-- ---------------------------------------------------------------------------
-- Conversaciones idempotentes por id de mensaje de WhatsApp
create unique index if not exists lead_conversations_whatsapp_message_unique
    on public.lead_conversations ((metadata ->> 'whatsapp_message_id'))
    where metadata ? 'whatsapp_message_id';

-- ---------------------------------------------------------------------------
-- Ejecuciones de discovery (estado explícito: parcial o fallida)
create table if not exists public.discovery_runs (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    region text not null,
    category text not null,
    status text not null default 'running'
        check (status in ('running', 'completed', 'partial', 'failed')),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    found integer not null default 0,
    inserted integer not null default 0,
    updated integer not null default 0,
    error text,
    created_by text
);
create index if not exists idx_discovery_runs_started on public.discovery_runs (started_at desc);

alter table public.discovery_runs enable row level security;
revoke all on table public.discovery_runs from anon, authenticated;
grant all on table public.discovery_runs to service_role;

-- ---------------------------------------------------------------------------
-- Un envío aceptado también mueve la etapa comercial (si no tenía una).
create or replace function public.mark_lead_contacted_for_send(p_send public.outreach_sends)
returns void
language sql
set search_path = ''
as $$
    update public.bizmap_leads
    set outreach_status = public.stage_next_status(p_send.stage),
        last_contacted_at = coalesce(p_send.accepted_at, now()),
        outreached_at = coalesce(outreached_at, p_send.accepted_at, now()),
        pipeline_stage = coalesce(pipeline_stage, 'contactado')
    where id = p_send.lead_id
      and outreach_status = public.stage_expected_status(p_send.stage)
      and has_replied = false;
$$;

-- Conteos del tablero sin descargar filas.
create or replace function public.bizmap_summary()
returns jsonb
language sql
stable
set search_path = ''
as $$
    select jsonb_build_object(
        'total', count(*),
        'contactable', count(*) filter (where wa_phone ~ '^506[0-9]{8}$'),
        'outreached', count(*) filter (where outreached_at is not null),
        'eligible', count(*) filter (where automation_consent is not null),
        'replied', count(*) filter (where has_replied),
        'followups_due', count(*) filter (
            where (next_action_at is not null and next_action_at <= now()
                   and coalesce(pipeline_stage, '') not in ('ganado', 'perdido'))),
        'won', count(*) filter (where pipeline_stage = 'ganado'),
        'lost', count(*) filter (where pipeline_stage = 'perdido')
    )
    from public.bizmap_leads;
$$;

-- Opciones de filtro (zonas y categorías más frecuentes).
create or replace function public.bizmap_facets()
returns jsonb
language sql
stable
set search_path = ''
as $$
    select jsonb_build_object(
        'zones', (select coalesce(jsonb_agg(z.address order by z.n desc), '[]'::jsonb)
                  from (select address, count(*) n from public.bizmap_leads
                        where address is not null and address <> '' group by address
                        order by n desc limit 40) z),
        'categories', (select coalesce(jsonb_agg(c.business_type order by c.n desc), '[]'::jsonb)
                       from (select business_type, count(*) n from public.bizmap_leads
                             where business_type is not null group by business_type
                             order by n desc limit 60) c)
    );
$$;

revoke execute on function public.bizmap_summary() from public, anon, authenticated;
revoke execute on function public.bizmap_facets() from public, anon, authenticated;
grant execute on function public.bizmap_summary() to service_role;
grant execute on function public.bizmap_facets() to service_role;
