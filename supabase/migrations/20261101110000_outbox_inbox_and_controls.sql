-- Fase B: trabajos durables en PostgreSQL (sin brokers nuevos).
--
--   job_locks              candados con vencimiento (discovery, barridos)
--   app_settings           interruptor global de envíos y límites
--   contact_suppressions   bajas / exclusiones por número
--   inbound_events         inbox idempotente de webhooks (único proveedor+id)
--   outreach_batches       lote preparado = lo que el operador aprueba
--   outreach_sends         outbox: un registro por destinatario y etapa
--   outreach_send_events   auditoría de cada cambio de estado
--
-- Estados de outreach_sends:
--   pending_approval -> queued -> processing -> accepted -> delivered -> read
--   processing -> queued (reintento con backoff) | dead (DLQ) | uncertain
--   cualquiera previo al envío -> suppressed (baja, respondió, sin permiso)
--   pending_approval -> cancelled (lote cancelado o vencido)
--   accepted|uncertain -> failed (callback del proveedor)
--
-- "accepted" = Make respondió 2xx. NO significa entregado. "delivered"/"read"
-- solo llegan por callback del proveedor (/api/webhooks/make-status).
--
-- Todo es aditivo: no borra ni modifica datos existentes, salvo agregar
-- columnas nulas a bizmap_leads.

-- ---------------------------------------------------------------------------
-- Candados
create table if not exists public.job_locks (
    name text primary key,
    owner text not null,
    acquired_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create or replace function public.try_acquire_job_lock(p_name text, p_owner text, p_ttl_seconds integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
    v_owner text;
begin
    insert into public.job_locks (name, owner, expires_at)
    values (p_name, p_owner, now() + make_interval(secs => p_ttl_seconds))
    on conflict (name) do update
        set owner = excluded.owner, acquired_at = now(), expires_at = excluded.expires_at
        where public.job_locks.expires_at < now()
    returning owner into v_owner;
    return coalesce(v_owner = p_owner, false);
end
$$;

create or replace function public.release_job_lock(p_name text, p_owner text)
returns void
language sql
set search_path = ''
as $$
    delete from public.job_locks where name = p_name and owner = p_owner;
$$;

-- ---------------------------------------------------------------------------
-- Configuración (interruptor global APAGADO por defecto)
create table if not exists public.app_settings (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now(),
    updated_by text
);
insert into public.app_settings (key, value) values
    ('sends_enabled', 'false'::jsonb),
    ('daily_send_cap', '25'::jsonb),
    ('send_max_attempts', '5'::jsonb)
on conflict (key) do nothing;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean language sql stable set search_path = '' as $$
    select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = p_key), p_default);
$$;

create or replace function public.setting_int(p_key text, p_default integer)
returns integer language sql stable set search_path = '' as $$
    select coalesce((select (value #>> '{}')::integer from public.app_settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Bajas / exclusiones
create table if not exists public.contact_suppressions (
    wa_phone text primary key,
    reason text not null,
    source text not null,
    note text,
    created_at timestamptz not null default now(),
    created_by text
);

-- ---------------------------------------------------------------------------
-- Elegibilidad para automatización. Un teléfono público NO es permiso.
-- Solo los prospectos con base registrada pueden entrar a la cola automática.
alter table public.bizmap_leads
    add column if not exists automation_consent text
        check (automation_consent in ('opt_in', 'inbound_request', 'existing_customer')),
    add column if not exists consent_evidence text,
    add column if not exists consent_recorded_at timestamptz,
    add column if not exists consent_recorded_by text;

-- ---------------------------------------------------------------------------
-- Inbox de eventos entrantes
create table if not exists public.inbound_events (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    event_id text not null,
    event_type text not null,
    payload jsonb not null default '{}'::jsonb,
    received_at timestamptz not null default now(),
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'done', 'dead')),
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    lease_owner text,
    lease_expires_at timestamptz,
    last_error text,
    processed_at timestamptz,
    constraint inbound_events_provider_event_unique unique (provider, event_id)
);
create index if not exists idx_inbound_events_pending
    on public.inbound_events (status, next_attempt_at);

create or replace function public.record_inbound_event(
    p_provider text, p_event_id text, p_event_type text, p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    v_id uuid;
    v_status text;
begin
    insert into public.inbound_events (provider, event_id, event_type, payload)
    values (p_provider, p_event_id, p_event_type, coalesce(p_payload, '{}'::jsonb))
    on conflict (provider, event_id) do nothing
    returning id into v_id;
    if v_id is not null then
        return jsonb_build_object('id', v_id, 'inserted', true, 'status', 'pending');
    end if;
    select id, status into v_id, v_status
    from public.inbound_events where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('id', v_id, 'inserted', false, 'status', v_status);
end
$$;

create or replace function public.claim_inbound_events(p_owner text, p_limit integer, p_lease_seconds integer)
returns setof public.inbound_events
language plpgsql
set search_path = ''
as $$
begin
    return query
    with picked as (
        select e.id from public.inbound_events e
        where (e.status = 'pending' and e.next_attempt_at <= now())
           or (e.status = 'processing' and e.lease_expires_at < now())
        order by e.received_at
        limit p_limit
        for update skip locked
    )
    update public.inbound_events e
    set status = 'processing',
        lease_owner = p_owner,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempts = e.attempts + 1
    from picked
    where e.id = picked.id
    returning e.*;
end
$$;

-- p_outcome: done | retry | dead
create or replace function public.complete_inbound_event(
    p_id uuid, p_owner text, p_outcome text, p_error text, p_retry_at timestamptz
)
returns text
language plpgsql
set search_path = ''
as $$
declare
    v_row public.inbound_events;
begin
    select * into v_row from public.inbound_events where id = p_id for update;
    if not found or v_row.status <> 'processing' or v_row.lease_owner is distinct from p_owner then
        return 'stale';
    end if;
    if p_outcome = 'done' then
        update public.inbound_events
        set status = 'done', processed_at = now(), lease_owner = null, lease_expires_at = null, last_error = null
        where id = p_id;
        return 'done';
    elsif p_outcome = 'retry' and v_row.attempts < 8 then
        update public.inbound_events
        set status = 'pending', next_attempt_at = coalesce(p_retry_at, now() + interval '1 minute'),
            lease_owner = null, lease_expires_at = null, last_error = left(p_error, 1000)
        where id = p_id;
        return 'pending';
    else
        update public.inbound_events
        set status = 'dead', lease_owner = null, lease_expires_at = null, last_error = left(p_error, 1000)
        where id = p_id;
        return 'dead';
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Outbox
create table if not exists public.outreach_batches (
    id uuid primary key default gen_random_uuid(),
    campaign text not null,
    stage text not null check (stage in ('pitch_1', 'followup_2')),
    status text not null default 'pending_approval'
        check (status in ('pending_approval', 'approved', 'cancelled', 'expired')),
    content_hash text,
    item_count integer not null default 0,
    created_by text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '30 minutes',
    approved_by text,
    approved_at timestamptz,
    cancelled_at timestamptz
);

create table if not exists public.outreach_sends (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references public.outreach_batches (id) on delete restrict,
    lead_id uuid not null references public.bizmap_leads (id) on delete restrict,
    campaign text not null,
    stage text not null check (stage in ('pitch_1', 'followup_2')),
    wa_phone text not null,
    business_name text,
    canton text,
    province text,
    lead_score integer,
    message_text text not null,
    idempotency_key text not null,
    status text not null default 'pending_approval'
        check (status in (
            'pending_approval', 'queued', 'processing', 'accepted', 'delivered', 'read',
            'failed', 'uncertain', 'suppressed', 'cancelled', 'dead'
        )),
    status_detail text,
    attempts integer not null default 0,
    max_attempts integer not null default 5,
    next_attempt_at timestamptz,
    lease_owner text,
    lease_expires_at timestamptz,
    transmit_started_at timestamptz,
    accepted_at timestamptz,
    delivered_at timestamptz,
    read_at timestamptz,
    failed_at timestamptz,
    last_http_status integer,
    last_error text,
    provider_ref text,
    needs_review boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Un mismo número no recibe dos veces la misma etapa de la misma campaña.
create unique index if not exists outreach_sends_idempotency_active
    on public.outreach_sends (idempotency_key) where status <> 'cancelled';
create index if not exists idx_outreach_sends_queue
    on public.outreach_sends (status, next_attempt_at);
create index if not exists idx_outreach_sends_batch on public.outreach_sends (batch_id);
create index if not exists idx_outreach_sends_lead on public.outreach_sends (lead_id);
create index if not exists idx_outreach_sends_phone on public.outreach_sends (wa_phone);

create table if not exists public.outreach_send_events (
    id bigint generated always as identity primary key,
    send_id uuid not null references public.outreach_sends (id) on delete cascade,
    from_status text,
    to_status text not null,
    actor text not null,
    note text,
    created_at timestamptz not null default now()
);
create index if not exists idx_outreach_send_events_send on public.outreach_send_events (send_id);

create or replace function public.outreach_sends_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        new.updated_at := now();
        if new.status is distinct from old.status then
            insert into public.outreach_send_events (send_id, from_status, to_status, actor, note)
            values (new.id, old.status, new.status,
                    coalesce(nullif(current_setting('app.actor', true), ''), 'system'),
                    new.status_detail);
        end if;
        return new;
    end if;
    return new;
end
$$;

create or replace function public.outreach_sends_audit_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    insert into public.outreach_send_events (send_id, from_status, to_status, actor, note)
    values (new.id, null, new.status, coalesce(nullif(current_setting('app.actor', true), ''), 'system'), null);
    return null;
end
$$;

drop trigger if exists trg_outreach_sends_audit on public.outreach_sends;
create trigger trg_outreach_sends_audit
    before update on public.outreach_sends
    for each row execute function public.outreach_sends_audit();
drop trigger if exists trg_outreach_sends_audit_insert on public.outreach_sends;
create trigger trg_outreach_sends_audit_insert
    after insert on public.outreach_sends
    for each row execute function public.outreach_sends_audit_insert();

-- Estado que debe tener el prospecto para cada etapa.
create or replace function public.stage_expected_status(p_stage text)
returns text language sql immutable set search_path = '' as $$
    select case p_stage when 'pitch_1' then 'Queued' when 'followup_2' then 'Pitch Sent' end;
$$;

create or replace function public.stage_next_status(p_stage text)
returns text language sql immutable set search_path = '' as $$
    select case p_stage when 'pitch_1' then 'Pitch Sent' when 'followup_2' then 'Followup Sent' end;
$$;

-- Motivo por el que un prospecto NO puede recibir esta etapa (null = elegible).
create or replace function public.send_block_reason(p_lead_id uuid, p_stage text, p_wa_phone text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
    v_lead record;
begin
    select id, wa_phone, outreach_status, has_replied, automation_consent, last_contacted_at
    into v_lead from public.bizmap_leads where id = p_lead_id;
    if not found then return 'no_existe'; end if;
    if v_lead.wa_phone is distinct from p_wa_phone then return 'telefono_cambio'; end if;
    if v_lead.has_replied then return 'ya_respondio'; end if;
    if v_lead.outreach_status is distinct from public.stage_expected_status(p_stage) then return 'estado_cambio'; end if;
    if v_lead.automation_consent is null then return 'sin_permiso'; end if;
    if exists (select 1 from public.contact_suppressions s where s.wa_phone = p_wa_phone) then return 'baja'; end if;
    if p_stage = 'followup_2'
       and (v_lead.last_contacted_at is null or v_lead.last_contacted_at > now() - interval '3 days') then
        return 'muy_pronto';
    end if;
    return null;
end
$$;

-- Cancela lotes vencidos sin aprobar (libera sus claves idempotentes).
create or replace function public.expire_stale_batches()
returns integer
language plpgsql
set search_path = ''
as $$
declare
    v_count integer;
begin
    perform set_config('app.actor', 'system:expiry', true);
    with expired as (
        update public.outreach_batches
        set status = 'expired', cancelled_at = now()
        where status = 'pending_approval' and expires_at < now()
        returning id
    )
    update public.outreach_sends s
    set status = 'cancelled', status_detail = 'Lote vencido sin aprobar'
    from expired
    where s.batch_id = expired.id and s.status = 'pending_approval';
    get diagnostics v_count = row_count;
    return v_count;
end
$$;

create or replace function public.batch_content_hash(p_batch_id uuid)
returns text language sql stable set search_path = '' as $$
    select md5(coalesce(string_agg(s.id::text || '|' || s.lead_id::text || '|' || s.wa_phone || '|' || md5(s.message_text),
                                   ',' order by s.id), ''))
    from public.outreach_sends s
    where s.batch_id = p_batch_id and s.status <> 'cancelled';
$$;

/*
 * Crea un lote "pendiente de aprobación" con exactamente los destinatarios y
 * textos que verá el operador. Revalida elegibilidad dentro de la transacción
 * con bloqueo de fila. p_items: [{lead_id, wa_phone, message_text,
 * business_name, canton, province, lead_score}].
 */
create or replace function public.create_outreach_batch(
    p_campaign text, p_stage text, p_items jsonb, p_actor text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    v_batch_id uuid;
    v_item jsonb;
    v_lead_id uuid;
    v_reason text;
    v_inserted integer := 0;
    v_skipped jsonb := '[]'::jsonb;
    v_hash text;
    v_expires timestamptz;
begin
    if p_stage not in ('pitch_1', 'followup_2') then
        raise exception 'etapa inválida: %', p_stage;
    end if;
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
        raise exception 'p_items debe ser un arreglo de hasta 100 elementos';
    end if;
    perform public.expire_stale_batches();
    perform set_config('app.actor', p_actor, true);

    insert into public.outreach_batches (campaign, stage, created_by)
    values (p_campaign, p_stage, p_actor)
    returning id, expires_at into v_batch_id, v_expires;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
        v_lead_id := (v_item ->> 'lead_id')::uuid;
        perform 1 from public.bizmap_leads where id = v_lead_id for update;
        v_reason := public.send_block_reason(v_lead_id, p_stage, v_item ->> 'wa_phone');
        if v_reason is null and coalesce(length(trim(v_item ->> 'message_text')), 0) = 0 then
            v_reason := 'mensaje_vacio';
        end if;
        if v_reason is null then
            insert into public.outreach_sends (
                batch_id, lead_id, campaign, stage, wa_phone, business_name, canton, province,
                lead_score, message_text, idempotency_key, max_attempts
            )
            values (
                v_batch_id, v_lead_id, p_campaign, p_stage, v_item ->> 'wa_phone',
                v_item ->> 'business_name', v_item ->> 'canton', v_item ->> 'province',
                nullif(v_item ->> 'lead_score', '')::integer, v_item ->> 'message_text',
                p_campaign || ':' || p_stage || ':' || (v_item ->> 'wa_phone'),
                public.setting_int('send_max_attempts', 5)
            )
            on conflict (idempotency_key) where status <> 'cancelled' do nothing;
            if found then
                v_inserted := v_inserted + 1;
            else
                v_reason := 'ya_programado';
            end if;
        end if;
        if v_reason is not null then
            v_skipped := v_skipped || jsonb_build_object('lead_id', v_lead_id, 'reason', v_reason);
        end if;
    end loop;

    v_hash := public.batch_content_hash(v_batch_id);
    update public.outreach_batches set content_hash = v_hash, item_count = v_inserted where id = v_batch_id;

    return jsonb_build_object(
        'batch_id', v_batch_id, 'content_hash', v_hash, 'item_count', v_inserted,
        'skipped', v_skipped, 'expires_at', v_expires
    );
end
$$;

-- Aprueba un lote SOLO si su contenido sigue siendo el que vio el operador.
create or replace function public.approve_outreach_batch(p_batch_id uuid, p_content_hash text, p_actor text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    v_batch public.outreach_batches;
    v_queued integer;
begin
    perform set_config('app.actor', p_actor, true);
    select * into v_batch from public.outreach_batches where id = p_batch_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'no_existe');
    end if;
    if v_batch.status = 'approved' then
        select count(*) into v_queued from public.outreach_sends where batch_id = p_batch_id;
        return jsonb_build_object('ok', true, 'already_approved', true, 'queued', v_queued);
    end if;
    if v_batch.status <> 'pending_approval' then
        return jsonb_build_object('ok', false, 'reason', v_batch.status);
    end if;
    if v_batch.expires_at < now() then
        perform public.expire_stale_batches();
        return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;
    if p_content_hash is distinct from v_batch.content_hash
       or p_content_hash is distinct from public.batch_content_hash(p_batch_id) then
        return jsonb_build_object('ok', false, 'reason', 'changed');
    end if;
    if v_batch.item_count = 0 then
        return jsonb_build_object('ok', false, 'reason', 'empty');
    end if;

    update public.outreach_batches
    set status = 'approved', approved_by = p_actor, approved_at = now()
    where id = p_batch_id;
    update public.outreach_sends
    set status = 'queued', next_attempt_at = now(), status_detail = 'Aprobado por ' || p_actor
    where batch_id = p_batch_id and status = 'pending_approval';
    get diagnostics v_queued = row_count;
    return jsonb_build_object('ok', true, 'already_approved', false, 'queued', v_queued);
end
$$;

create or replace function public.cancel_outreach_batch(p_batch_id uuid, p_actor text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
    perform set_config('app.actor', p_actor, true);
    update public.outreach_batches
    set status = 'cancelled', cancelled_at = now()
    where id = p_batch_id and status = 'pending_approval';
    if not found then return false; end if;
    update public.outreach_sends
    set status = 'cancelled', status_detail = 'Lote cancelado por ' || p_actor
    where batch_id = p_batch_id and status = 'pending_approval';
    return true;
end
$$;

/*
 * Reserva atómica de envíos para un worker (FOR UPDATE SKIP LOCKED + lease).
 *  - Respeta el interruptor global y el límite diario (zona horaria de CR).
 *  - Recupera leases vencidos: si no se llegó a transmitir, vuelve a la cola;
 *    si se transmitió, queda "uncertain" para revisión (no se reenvía a ciegas).
 *  - Revalida bajas, respuestas y permiso justo antes de reservar.
 */
create or replace function public.claim_outreach_sends(p_owner text, p_limit integer, p_lease_seconds integer)
returns setof public.outreach_sends
language plpgsql
set search_path = ''
as $$
declare
    v_day_start timestamptz;
    v_used integer;
    v_take integer;
    v_count integer := 0;
    v_row public.outreach_sends;
    v_out public.outreach_sends;
    v_reason text;
begin
    perform set_config('app.actor', 'worker:' || p_owner, true);

    update public.outreach_sends
    set status = case when transmit_started_at is null then 'queued' else 'uncertain' end,
        needs_review = transmit_started_at is not null,
        status_detail = case when transmit_started_at is null
            then 'Proceso interrumpido antes de enviar; se reintentará'
            else 'Proceso interrumpido después de enviar a Make; revise antes de reenviar' end,
        next_attempt_at = case when transmit_started_at is null then now() else next_attempt_at end,
        lease_owner = null,
        lease_expires_at = null
    where status = 'processing' and lease_expires_at < now();

    if not public.setting_bool('sends_enabled', false) then
        return;
    end if;

    v_day_start := (date_trunc('day', now() at time zone 'America/Costa_Rica')) at time zone 'America/Costa_Rica';
    select count(*) into v_used
    from public.outreach_sends
    where transmit_started_at >= v_day_start or status = 'processing';
    v_take := least(p_limit, greatest(public.setting_int('daily_send_cap', 0) - v_used, 0));
    if v_take <= 0 then
        return;
    end if;

    for v_row in
        select s.* from public.outreach_sends s
        where s.status = 'queued' and s.next_attempt_at <= now()
        order by s.next_attempt_at, s.created_at
        limit v_take * 3
        for update skip locked
    loop
        exit when v_count >= v_take;
        v_reason := public.send_block_reason(v_row.lead_id, v_row.stage, v_row.wa_phone);
        -- 'muy_pronto' no aplica a un seguimiento ya aprobado en su ventana.
        if v_reason is not null and v_reason <> 'muy_pronto' then
            update public.outreach_sends
            set status = 'suppressed', status_detail = 'No se envió: ' || v_reason
            where id = v_row.id;
            continue;
        end if;
        update public.outreach_sends
        set status = 'processing',
            lease_owner = p_owner,
            lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            attempts = attempts + 1,
            status_detail = null
        where id = v_row.id
        returning * into v_out;
        v_count := v_count + 1;
        return next v_out;
    end loop;
end
$$;

-- Marca el instante previo a transmitir. Si el interruptor se apagó, devuelve
-- el envío a la cola y responde false (no transmitir).
create or replace function public.mark_send_transmitting(p_id uuid, p_owner text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
    perform set_config('app.actor', 'worker:' || p_owner, true);
    if not public.setting_bool('sends_enabled', false) then
        update public.outreach_sends
        set status = 'queued', lease_owner = null, lease_expires_at = null,
            status_detail = 'Envíos pausados', attempts = greatest(attempts - 1, 0)
        where id = p_id and lease_owner = p_owner and status = 'processing';
        return false;
    end if;
    update public.outreach_sends
    set transmit_started_at = now()
    where id = p_id and lease_owner = p_owner and status = 'processing' and lease_expires_at > now();
    return found;
end
$$;

-- Actualiza el prospecto cuando un envío fue aceptado (guarda contra retrocesos).
create or replace function public.mark_lead_contacted_for_send(p_send public.outreach_sends)
returns void
language sql
set search_path = ''
as $$
    update public.bizmap_leads
    set outreach_status = public.stage_next_status(p_send.stage),
        last_contacted_at = coalesce(p_send.accepted_at, now()),
        outreached_at = coalesce(outreached_at, p_send.accepted_at, now())
    where id = p_send.lead_id
      and outreach_status = public.stage_expected_status(p_send.stage)
      and has_replied = false;
$$;

/*
 * Resultado de una transmisión. p_outcome:
 *   accepted  Make respondió 2xx (aceptado, NO entregado)
 *   retry     error transitorio con respuesta (429/5xx): backoff hasta max_attempts
 *   failed    error permanente (4xx): DLQ (dead) para revisión
 *   uncertain timeout/corte después de transmitir: revisión, sin reenvío ciego
 */
create or replace function public.complete_outreach_send(
    p_id uuid, p_owner text, p_outcome text, p_http_status integer,
    p_error text, p_retry_at timestamptz, p_provider_ref text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
    v_row public.outreach_sends;
begin
    perform set_config('app.actor', 'worker:' || p_owner, true);
    select * into v_row from public.outreach_sends where id = p_id for update;
    if not found or v_row.status <> 'processing' or v_row.lease_owner is distinct from p_owner then
        return 'stale';
    end if;

    if p_outcome = 'accepted' then
        update public.outreach_sends
        set status = 'accepted', accepted_at = now(), last_http_status = p_http_status,
            provider_ref = coalesce(p_provider_ref, provider_ref), last_error = null,
            status_detail = 'Aceptado por Make (no confirma entrega)',
            lease_owner = null, lease_expires_at = null
        where id = p_id
        returning * into v_row;
        perform public.mark_lead_contacted_for_send(v_row);
        return 'accepted';
    elsif p_outcome = 'retry' and v_row.attempts < v_row.max_attempts then
        update public.outreach_sends
        set status = 'queued', next_attempt_at = coalesce(p_retry_at, now() + interval '5 minutes'),
            transmit_started_at = null, last_http_status = p_http_status, last_error = left(p_error, 1000),
            status_detail = 'Reintento programado', lease_owner = null, lease_expires_at = null
        where id = p_id;
        return 'queued';
    elsif p_outcome = 'uncertain' then
        update public.outreach_sends
        set status = 'uncertain', needs_review = true, last_http_status = p_http_status,
            last_error = left(p_error, 1000),
            status_detail = 'Resultado incierto: pudo haberse enviado. Revise antes de reenviar.',
            lease_owner = null, lease_expires_at = null
        where id = p_id;
        return 'uncertain';
    else
        update public.outreach_sends
        set status = 'dead', needs_review = true, failed_at = now(), last_http_status = p_http_status,
            last_error = left(p_error, 1000),
            status_detail = case when p_outcome = 'retry' then 'Se agotaron los reintentos' else 'Error permanente' end,
            lease_owner = null, lease_expires_at = null
        where id = p_id;
        return 'dead';
    end if;
end
$$;

/*
 * Callback del proveedor (Make/ManyChat). Los estados nunca retroceden:
 * un "accepted" tardío no pisa un "delivered". Un callback de aceptación
 * resuelve un "uncertain".
 */
create or replace function public.apply_send_callback(
    p_send_id uuid, p_status text, p_provider_ref text, p_detail text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    v_row public.outreach_sends;
    v_allowed text[];
begin
    perform set_config('app.actor', 'provider_callback', true);
    select * into v_row from public.outreach_sends where id = p_send_id for update;
    if not found then
        return jsonb_build_object('applied', false, 'reason', 'no_existe');
    end if;

    v_allowed := case p_status
        when 'accepted'  then array['queued', 'processing', 'uncertain', 'dead']
        when 'delivered' then array['queued', 'processing', 'uncertain', 'dead', 'accepted']
        when 'read'      then array['queued', 'processing', 'uncertain', 'dead', 'accepted', 'delivered']
        when 'failed'    then array['processing', 'uncertain', 'accepted']
        else array[]::text[]
    end;
    if not (v_row.status = any (v_allowed)) then
        return jsonb_build_object('applied', false, 'status', v_row.status);
    end if;

    update public.outreach_sends
    set status = p_status,
        accepted_at = case when p_status in ('accepted', 'delivered', 'read') then coalesce(accepted_at, now()) else accepted_at end,
        delivered_at = case when p_status in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end,
        read_at = case when p_status = 'read' then now() else read_at end,
        failed_at = case when p_status = 'failed' then now() else failed_at end,
        needs_review = case when p_status = 'failed' then true when p_status in ('accepted','delivered','read') then false else needs_review end,
        provider_ref = coalesce(p_provider_ref, provider_ref),
        status_detail = left(coalesce(p_detail, 'Actualizado por el proveedor'), 500),
        lease_owner = null,
        lease_expires_at = null
    where id = p_send_id
    returning * into v_row;

    if p_status in ('accepted', 'delivered', 'read') then
        perform public.mark_lead_contacted_for_send(v_row);
    end if;
    return jsonb_build_object('applied', true, 'status', v_row.status);
end
$$;

-- Reenvío auditado desde DLQ o resultado incierto.
create or replace function public.replay_outreach_send(p_id uuid, p_actor text, p_note text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
    perform set_config('app.actor', p_actor, true);
    update public.outreach_sends
    set status = 'queued', attempts = 0, next_attempt_at = now(), transmit_started_at = null,
        needs_review = false, lease_owner = null, lease_expires_at = null,
        status_detail = left('Reenvío aprobado por ' || p_actor || coalesce(': ' || p_note, ''), 500)
    where id = p_id and status in ('dead', 'uncertain');
    return found;
end
$$;

-- Marca como revisado un envío incierto/fallido sin reenviar.
create or replace function public.dismiss_outreach_send(p_id uuid, p_actor text, p_note text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
    perform set_config('app.actor', p_actor, true);
    update public.outreach_sends
    set needs_review = false,
        status_detail = left('Revisado por ' || p_actor || coalesce(': ' || p_note, ''), 500)
    where id = p_id and status in ('dead', 'uncertain', 'failed') and needs_review;
    return found;
end
$$;

-- Baja: registra la exclusión y suprime envíos pendientes de ese número.
create or replace function public.add_contact_suppression(
    p_wa_phone text, p_reason text, p_source text, p_actor text, p_note text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
    v_count integer;
begin
    perform set_config('app.actor', p_actor, true);
    insert into public.contact_suppressions (wa_phone, reason, source, note, created_by)
    values (p_wa_phone, p_reason, p_source, p_note, p_actor)
    on conflict (wa_phone) do nothing;
    update public.outreach_sends
    set status = 'suppressed', status_detail = 'Baja: ' || p_reason
    where wa_phone = p_wa_phone and status in ('pending_approval', 'queued');
    get diagnostics v_count = row_count;
    return v_count;
end
$$;

-- Salud de la cola para monitoreo (antigüedad, atascos, gasto del día).
create or replace function public.outreach_health()
returns jsonb
language sql
stable
set search_path = ''
as $$
    select jsonb_build_object(
        'sends_enabled', public.setting_bool('sends_enabled', false),
        'daily_send_cap', public.setting_int('daily_send_cap', 0),
        'sent_today', (select count(*) from public.outreach_sends
                       where transmit_started_at >= (date_trunc('day', now() at time zone 'America/Costa_Rica')) at time zone 'America/Costa_Rica'),
        'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                      from (select status, count(*) n from public.outreach_sends group by status) s),
        'oldest_queued_minutes', (select round(extract(epoch from now() - min(next_attempt_at)) / 60)
                                  from public.outreach_sends where status = 'queued' and next_attempt_at <= now()),
        'stuck_processing', (select count(*) from public.outreach_sends
                             where status = 'processing' and lease_expires_at < now()),
        'needs_review', (select count(*) from public.outreach_sends where needs_review),
        'inbox_pending', (select count(*) from public.inbound_events where status in ('pending', 'processing')),
        'inbox_dead', (select count(*) from public.inbound_events where status = 'dead'),
        'oldest_inbox_minutes', (select round(extract(epoch from now() - min(received_at)) / 60)
                                 from public.inbound_events where status in ('pending', 'processing'))
    );
$$;

-- ---------------------------------------------------------------------------
-- Permisos: nada para anon/authenticated; solo service_role (servidor).
do $$
declare
    t text;
    f record;
begin
    foreach t in array array[
        'job_locks', 'app_settings', 'contact_suppressions', 'inbound_events',
        'outreach_batches', 'outreach_sends', 'outreach_send_events'
    ]
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on table public.%I from anon, authenticated', t);
        execute format('grant all on table public.%I to service_role', t);
    end loop;

    for f in
        select p.oid::regprocedure as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
            'try_acquire_job_lock', 'release_job_lock', 'setting_bool', 'setting_int',
            'record_inbound_event', 'claim_inbound_events', 'complete_inbound_event',
            'outreach_sends_audit', 'outreach_sends_audit_insert', 'stage_expected_status',
            'stage_next_status', 'send_block_reason', 'expire_stale_batches', 'batch_content_hash',
            'create_outreach_batch', 'approve_outreach_batch', 'cancel_outreach_batch',
            'claim_outreach_sends', 'mark_send_transmitting', 'mark_lead_contacted_for_send',
            'complete_outreach_send', 'apply_send_callback', 'replay_outreach_send',
            'dismiss_outreach_send', 'add_contact_suppression', 'outreach_health'
        )
    loop
        execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
        execute format('grant execute on function %s to service_role', f.sig);
    end loop;
end
$$;
