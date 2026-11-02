begin;
alter table public.bizmap_leads add column if not exists status text default 'New', add column if not exists ai_notes text;
commit;
