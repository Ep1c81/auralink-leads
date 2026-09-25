-- Automated WhatsApp sequence tracking for bizmap_leads, driven by Make.com:
--   POST /api/outreach/dispatch        Queued     -> Pitch Sent
--   POST /api/outreach/followup-check  Pitch Sent -> Followup Sent (3+ days, no reply)
--   POST /api/webhooks/make-reply      any        -> Replied
--
-- outreach_status NULL means "not in the automated sequence": no usable
-- Costa Rican WhatsApp number, or a duplicate listing of a number another row
-- already covers (so one business is never pitched twice).

-- Mirrors formatWhatsAppNumber in src/lib/whatsapp.ts — keep the two in sync.
-- Digits-only international number, or null if unusable.
create or replace function public.format_wa_phone(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when raw is null or raw = 'N/A' or d = '' then null
    when length(d) = 8 then '506' || d
    when length(d) > 15 then null
    when d like '506%' and length(d) >= 10 then d
    when length(d) >= 8 then d
    else null
  end
  from (select regexp_replace(regexp_replace(coalesce(raw, ''), '\D', '', 'g'), '^00', '') as d) s
$$;

alter table public.bizmap_leads
  add column if not exists outreach_status text default 'Queued'
    check (outreach_status in ('Queued', 'Pitch Sent', 'Followup Sent', 'Replied', 'Closed')),
  add column if not exists last_contacted_at timestamptz,
  add column if not exists has_replied boolean not null default false,
  -- ManyChat / Zernio subscriber or conversation id, reported by the reply webhook.
  add column if not exists external_chat_id text,
  add column if not exists wa_phone text
    generated always as (public.format_wa_phone(phone_number)) stored;

-- Backfill. Adding the column with a default set every existing row to 'Queued'.

-- 1. Already messaged by hand from the dashboard.
update public.bizmap_leads
set outreach_status = 'Pitch Sent', last_contacted_at = outreached_at
where outreached_at is not null;

-- 2. No usable Costa Rican number.
update public.bizmap_leads
set outreach_status = null
where outreach_status = 'Queued'
  and (wa_phone is null or wa_phone !~ '^506[0-9]{8}$');

-- 3. Duplicate listings: one row per number stays in the sequence, preferring
--    a row that was already contacted, then the oldest.
with ranked as (
  select id,
         row_number() over (
           partition by wa_phone
           order by (outreach_status = 'Pitch Sent') desc, created_at, id
         ) as rn
  from public.bizmap_leads
  where outreach_status is not null
)
update public.bizmap_leads b
set outreach_status = null
from ranked r
where b.id = r.id and r.rn > 1;

create index if not exists idx_bizmap_leads_outreach_status
  on public.bizmap_leads (outreach_status, last_contacted_at);
create index if not exists idx_bizmap_leads_wa_phone
  on public.bizmap_leads (wa_phone);
