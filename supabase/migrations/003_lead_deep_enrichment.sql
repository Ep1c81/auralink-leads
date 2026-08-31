-- Deep web enrichment: dedicated contact columns discovered by crawling a
-- lead's website (homepage + common contact paths), separate from the
-- existing metadata.enrichment blob (which stays as-is; it feeds the
-- outreach prompt builder and must not be disturbed).

alter table leads
  add column if not exists instagram_url text,
  add column if not exists facebook_url text,
  add column if not exists whatsapp_number text;

alter table leads
  add column if not exists enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'enriched', 'failed'));
