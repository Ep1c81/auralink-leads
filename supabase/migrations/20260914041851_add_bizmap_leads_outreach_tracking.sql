-- Track single-click outreach actions from the CRM pipeline dashboard.
-- Nullable: null means "never contacted". Set once, from
-- POST /api/bizmap-leads/[id]/outreach, when a rep clicks the WhatsApp action.
alter table public.bizmap_leads
  add column if not exists outreached_at timestamptz;

create index if not exists idx_bizmap_leads_outreached_at
  on public.bizmap_leads (outreached_at);
