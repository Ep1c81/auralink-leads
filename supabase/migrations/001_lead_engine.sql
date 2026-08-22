-- Lead engine schema: leads and their conversation history

create extension if not exists "pgcrypto";

create table if not exists leads (
    id uuid primary key default gen_random_uuid(),
    name text,
    email text,
    phone text,
    company text,
    status text not null default 'new',
    lead_score integer not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_leads_status on leads (status);
create index if not exists idx_leads_email on leads (email);

create table if not exists lead_conversations (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references leads (id) on delete cascade,
    sender text not null,
    message text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_lead_conversations_lead_id on lead_conversations (lead_id);
