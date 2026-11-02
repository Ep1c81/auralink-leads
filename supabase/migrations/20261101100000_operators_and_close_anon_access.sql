-- Fase A: acceso de operadores + cierre de acceso anónimo al CRM.
--
-- Modelo de permisos (sin multitenancy):
--   * El navegador NUNCA consulta el CRM directamente. Toda lectura/escritura
--     pasa por el servidor de Next.js, que verifica la sesión del operador
--     (Supabase Auth + allowlist public.operators) y luego usa service_role.
--   * Por eso anon y authenticated no necesitan ningún privilegio sobre las
--     tablas del CRM: se revocan y no hay políticas RLS para ellos (RLS
--     activado + sin políticas = denegado).
--   * service_role ignora RLS; la protección real de las APIs es la capa de
--     autorización del servidor (src/lib/auth.ts), no RLS.
--
-- No toca public.businesses ni public.card_events (pertenecen al sitio
-- público de BizMapShield que comparte este proyecto de Supabase).
-- No borra datos.

-- 1. Allowlist de operadores, administrada solo del lado servidor.
create table if not exists public.operators (
    user_id uuid primary key references auth.users (id) on delete cascade,
    email text not null unique,
    role text not null default 'operator' check (role in ('admin', 'operator')),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    invited_by text
);
alter table public.operators enable row level security;
revoke all on table public.operators from anon, authenticated;

-- 2. Quitar la lectura anónima de bizmap_leads (creada en 20260914034839).
drop policy if exists "anon can read bizmap_leads" on public.bizmap_leads;

-- 3. Revocar privilegios de anon/authenticated sobre las tablas del CRM.
--    (Supabase los concede por defecto al crear tablas en public.)
do $$
declare
    t text;
begin
    foreach t in array array[
        'bizmap_leads', 'leads', 'lead_conversations',
        'outreach_campaigns', 'outreach_messages', 'outreach_replies',
        'outreach_messages_body_backup_20260925'
    ]
    loop
        if to_regclass('public.' || t) is not null then
            execute format('alter table public.%I enable row level security', t);
            execute format('revoke all on table public.%I from anon, authenticated', t);
        end if;
    end loop;
end
$$;
