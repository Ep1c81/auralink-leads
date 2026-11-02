-- Línea base de public.bizmap_leads.
--
-- Esta tabla se creó a mano en Supabase y nunca tuvo migración, lo que
-- impedía reconstruir una base limpia (20260914034839 y siguientes la
-- alteran). Las columnas reproducen el esquema original verificado en
-- producción el 2026-11-01 (information_schema), ANTES de las columnas que
-- agregan migraciones posteriores.
--
-- Idempotente: en la base existente es un no-op (create ... if not exists).
-- Se ordena antes de 001_ por nombre.

create extension if not exists "uuid-ossp";

create table if not exists public.bizmap_leads (
    id uuid primary key default uuid_generate_v4(),
    business_name text,
    business_type text,
    address text,
    website text,
    phone_number text,
    source text,
    needs_website boolean,
    created_at timestamptz default now(),
    lead_score integer default 0,
    status text default 'New',
    ai_notes text
);
