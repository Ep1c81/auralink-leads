\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.bizmap_leads(id uuid primary key default gen_random_uuid(), has_replied boolean, last_contacted_at timestamptz, outreached_at timestamptz, outreach_status text, lead_score integer, business_type text, phone_number text, status text);
grant select on public.bizmap_leads to service_role;
\ir ../supabase/migrations/20261127120000_acquisition.sql
\ir ../supabase/migrations/20261127220000_acquisition_niche_priority.sql
\ir ../supabase/migrations/20261128000000_acquisition_funnel.sql
with leads as (insert into public.bizmap_leads(lead_score) select i from generate_series(1,8) i returning id,lead_score)
insert into public.acq_contacts(phone,lead_id,business_name,consent_at,consent_evidence,suppressed,history_verified)
select '5068000000'||lead_score,id,'Fixture '||lead_score,now(),'synthetic',false,true from leads;
set role service_role;
do $$ begin
if (select count(*) from public.acq_preview('pitch_1')) <> 5 then raise exception 'preview limit'; end if;
if (select count(*) from public.acq_reserve('pitch_1')) <> 5 then raise exception 'reservation limit'; end if;
if (select count(*) from public.acq_reserve('pitch_1')) <> 0 then raise exception 'duplicate or quota violation'; end if;
if (select count(*) from public.acq_preview('followup_2')) <> 0 then raise exception 'undelivered followup'; end if;
if has_function_privilege('anon','public.acq_reserve(text)','execute') then raise exception 'anonymous reserve access'; end if;
if (select count(*) from public.acq_preview('pitch_1')) <> 3 then raise exception 'fixture: three eligible contacts should remain'; end if;
if (select count(*) from public.acq_reserve('pitch_1')) <> 0 then raise exception 'second same-day reserve must return 0 after 5'; end if;
if (select count(*) from public.acq_reservations where stage='pitch_1' and day=(clock_timestamp() at time zone 'America/Costa_Rica')::date and state='reserved') <> 5 then raise exception 'daily slots'; end if;
if has_function_privilege('anon','public.acq_mark_failed(uuid[])','execute') or has_function_privilege('authenticated','public.acq_mark_failed(uuid[])','execute') then raise exception 'non-service mark_failed access'; end if;
update public.acq_reservations set provider_id='wamid.fixture' where slot=3;
if public.acq_mark_failed(array(select id from public.acq_reservations where slot in (1,2,3))) <> 2 then raise exception 'mark_failed count'; end if;
if (select count(*) from public.acq_reservations where state='failed') <> 2 or exists(select 1 from public.acq_reservations where slot=3 and state<>'reserved') then raise exception 'mark_failed must skip accepted reservations'; end if;
if public.acq_mark_failed(array(select id from public.acq_reservations where slot in (1,2))) <> 0 then raise exception 'mark_failed not idempotent'; end if;
if public.acq_mark_failed('{}'::uuid[]) <> 0 then raise exception 'mark_failed empty'; end if;
if (select count(*) from public.acq_reserve('pitch_1')) <> 0 then raise exception 'failed reservations must not free same-day slots'; end if;
end $$;
reset role;
-- Self-service trial funnel
insert into public.bizmap_leads(id, lead_score) values ('00000000-0000-0000-0000-0000000000a1', 5), ('00000000-0000-0000-0000-0000000000a2', 5), ('00000000-0000-0000-0000-0000000000a3', 5);
insert into public.bizmap_leads(lead_score, phone_number, status) values (5, '+506 8777-1111', 'Cliente');
set role service_role;
do $$ begin
if public.acq_register('50688880001','00000000-0000-0000-0000-0000000000a1','Barbería Nueva','Ana','Shieldy test consent') <> 'registered' then raise exception 'register'; end if;
if (select trial_status from public.acq_contacts where phone='50688880001') <> 'registered' or (select suppressed from public.acq_contacts where phone='50688880001') then raise exception 'register state'; end if;
if public.acq_register('50688880001','00000000-0000-0000-0000-0000000000a2','Barbería Nueva','Ana','again') <> 'updated' then raise exception 'dedupe by phone'; end if;
if (select count(*) from public.acq_contacts where phone='50688880001') <> 1 then raise exception 'duplicate contact'; end if;
if public.acq_register('50687771111','00000000-0000-0000-0000-0000000000a2','Cliente SA','Bo','consent') <> 'customer' then raise exception 'customer exclusion'; end if;
if public.acq_register('50663489897','00000000-0000-0000-0000-0000000000a2','X','Y','consent') <> 'blocked' then raise exception 'blocked number'; end if;
if public.acq_register('50688880002','00000000-0000-0000-0000-0000000000a2','New Life Barbería','Y','consent') <> 'blocked' then raise exception 'New Life exclusion'; end if;
if public.acq_register('50622220000','00000000-0000-0000-0000-0000000000a2','Fijo','Y','consent') <> 'invalid_phone' then raise exception 'landline'; end if;
if public.acq_register('50688880003','00000000-0000-0000-0000-0000000000a3','Sin consentimiento','Y','  ') <> 'missing_consent' then raise exception 'consent required'; end if;
if not public.acq_event('{"event_id":"m1","kind":"reply","phone":"50688880001"}'::jsonb) then raise exception 'first event'; end if;
if public.acq_event('{"event_id":"m1","kind":"reply","phone":"50688880001"}'::jsonb) then raise exception 'duplicate event must return false'; end if;
if (select suppressed from public.acq_contacts where phone='50688880001') then raise exception 'a reply must not suppress'; end if;
if (select count(*) from public.acq_preview('pitch_1') where phone='50688880001') <> 0 then raise exception 'replied contacts must not get templates'; end if;
perform public.acq_event('{"event_id":"m2","kind":"optout","phone":"50688880001"}'::jsonb);
if not (select suppressed from public.acq_contacts where phone='50688880001') or (select trial_status from public.acq_contacts where phone='50688880001') <> 'declined' then raise exception 'optout'; end if;
if has_function_privilege('anon','public.acq_register(text,uuid,text,text,text)','execute') then raise exception 'anonymous register access'; end if;
end $$;
reset role;
