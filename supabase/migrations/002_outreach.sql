-- Outreach module: campaigns, generated messages, and inbound replies.
-- All FK'd to leads.id; leads itself is never modified by this migration.

create table if not exists outreach_campaigns (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    status text not null default 'draft'
        check (status in ('draft', 'active', 'paused', 'completed')),
    created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists outreach_messages (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references outreach_campaigns (id) on delete cascade,
    lead_id uuid not null references leads (id) on delete cascade,
    subject text,
    body text,
    status text not null default 'draft'
        check (status in ('draft', 'queued', 'sent', 'failed', 'bounced')),
    sent_at timestamptz,
    provider_message_id text,
    created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_outreach_messages_lead_id on outreach_messages (lead_id);
create index if not exists idx_outreach_messages_campaign_id on outreach_messages (campaign_id);
create index if not exists idx_outreach_messages_status on outreach_messages (status);

create table if not exists outreach_replies (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null references outreach_messages (id) on delete cascade,
    raw_content text,
    received_at timestamptz not null default timezone('utc'::text, now()),
    -- reserved for Phase 2 reply classification; unused this build
    classified boolean not null default false
);

create index if not exists idx_outreach_replies_message_id on outreach_replies (message_id);

-- Mirrors leads/lead_conversations exactly: RLS enabled, no policies. Every
-- access path in this app goes through server-side API routes using the
-- Supabase service-role key, which bypasses RLS entirely, so "no policies"
-- means "no client-side/anon access whatsoever" rather than an oversight.
alter table outreach_campaigns enable row level security;
alter table outreach_messages enable row level security;
alter table outreach_replies enable row level security;
