-- Base mínima para instalaciones nuevas; no modifica tablas existentes.
create extension if not exists pgcrypto;
create table if not exists public.bizmap_leads (
 id uuid primary key default gen_random_uuid(), business_name text, business_type text,
 address text, phone_number text, website text, lead_score integer default 0,
 created_at timestamptz not null default now()
);
