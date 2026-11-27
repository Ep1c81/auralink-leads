\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.bizmap_leads(id uuid primary key default gen_random_uuid(), has_replied boolean, last_contacted_at timestamptz, outreached_at timestamptz, outreach_status text, lead_score integer);
grant select on public.bizmap_leads to service_role;
\ir ../supabase/review/acquisition.sql
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
end $$;
reset role;
