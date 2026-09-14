-- Dedupe and purge bizmap_leads.
--
-- Context: discovery_engine_osm.py scraped overlapping OSM grid cells with no
-- uniqueness constraint on the table, so every single row turned out to be an
-- exact duplicate of at least one other row (same business_name/business_type/
-- address/phone_number/website). Before this ran, a snapshot was taken:
--   public.bizmap_leads_backup_20260914 (17,330 rows, full copy — safe to
--   drop once the cleanup is confirmed good).
--
-- Deliberately NOT deduping on business_name alone (or business_name+address):
-- this dataset has generic/chain names (e.g. "Palí", a supermarket chain)
-- where `address` is a coarse city-level label ("GAM, Costa Rica"), not a
-- street address. Every one of the table's business_name values collided
-- with another row's, including across what are very likely distinct real
-- branches. Deduping on name would have silently merged separate businesses.
--
-- Step 1: keep exactly one row per exact-duplicate group (identical across
-- all five descriptive columns). Prefer the copy with the highest lead_score,
-- then earliest created_at — qualify_leads.py had already scored one copy in
-- ~100 groups while its clones sat at the default score, so picking by
-- "earliest inserted" alone would sometimes discard completed qualification
-- work.
with ranked as (
  select id,
         row_number() over (
           partition by business_name, business_type, address, phone_number, website
           order by lead_score desc nulls last, created_at asc, id asc
         ) as rn
  from public.bizmap_leads
)
delete from public.bizmap_leads
where id in (select id from ranked where rn > 1);

-- Step 2: remove leads with no way to contact them. bizmap_leads has no email
-- column, so "no phone AND no email AND no website" reduces to phone_number
-- = 'N/A' AND website = 'N/A' — the scraper's literal sentinel for "not
-- found" (columns are never NULL or empty-string in this table).
delete from public.bizmap_leads
where phone_number = 'N/A' and website = 'N/A';

-- Result: 17,330 -> 1,061 rows (999 with a real phone number, 238 with a
-- website). Verified zero remaining exact-duplicate groups after this ran.
