\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.bizmap_leads(id uuid primary key default gen_random_uuid(), has_replied boolean, last_contacted_at timestamptz, outreached_at timestamptz, outreach_status text, lead_score integer);
grant select on public.bizmap_leads to service_role;
\ir ../supabase/migrations/20261127120000_acquisition.sql
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
