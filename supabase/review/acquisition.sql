-- Review only: isolated database validation.
create table public.acq_contacts(phone text primary key check(phone ~ '^506[5-8][0-9]{7}$'), lead_id uuid unique not null references public.bizmap_leads(id), business_name text not null, consent_at timestamptz, consent_evidence text, suppressed boolean not null default true, replied boolean not null default false, customer boolean not null default false, history_verified boolean not null default false);
create table public.acq_reservations(id uuid primary key default gen_random_uuid(), phone text not null references public.acq_contacts(phone), stage text not null check(stage in ('pitch_1','followup_2')), day date not null, slot int not null check(slot between 1 and 5), provider_id text unique, delivered_at timestamptz, state text not null default 'reserved', unique(phone,stage),unique(day,stage,slot));
create table public.acq_events(event_id text primary key, payload jsonb not null, received_at timestamptz default now());
alter table public.acq_contacts enable row level security;
alter table public.acq_reservations enable row level security;
alter table public.acq_events enable row level security;
revoke all on public.acq_contacts,public.acq_reservations,public.acq_events from public,anon,authenticated;
grant select,insert,update on public.acq_contacts,public.acq_reservations,public.acq_events to service_role;
create function public.acq_preview(p_stage text) returns table(id uuid,phone text,business_name text,stage text,consent_verified boolean,suppressed boolean) language sql security invoker set search_path='' as $$
select c.lead_id,c.phone,c.business_name,p_stage,true,false from public.acq_contacts c join public.bizmap_leads b on b.id=c.lead_id where c.consent_at<=now() and length(trim(c.consent_evidence))>0 and not c.suppressed and not c.customer and not c.replied and c.history_verified and c.phone not in ('50663489897','50670498864') and c.business_name !~* 'new[[:space:]]+life' and b.has_replied is not true and not exists(select 1 from public.acq_reservations r where r.phone=c.phone and r.stage=p_stage) and ((p_stage='pitch_1' and b.last_contacted_at is null and b.outreached_at is null and coalesce(b.outreach_status,'') in ('','Queued')) or (p_stage='followup_2' and exists(select 1 from public.acq_reservations r where r.phone=c.phone and r.stage='pitch_1' and r.delivered_at<=now()-interval '72 hours'))) order by (c.business_name ~* 'barber') desc,b.lead_score desc nulls last,c.phone limit 5;
$$;
create function public.acq_reserve(p_stage text) returns setof public.acq_reservations language plpgsql security invoker set search_path='' as $$
declare d date; s int; c record; r public.acq_reservations; begin
perform pg_advisory_xact_lock(732191); d:=(clock_timestamp() at time zone 'America/Costa_Rica')::date;
for c in select * from public.acq_preview(p_stage) loop
select min(i) into s from generate_series(1,5) i where not exists(select 1 from public.acq_reservations a where a.day=d and a.stage=p_stage and a.slot=i); exit when s is null;
insert into public.acq_reservations(phone,stage,day,slot) values(c.phone,p_stage,d,s) on conflict do nothing returning * into r; if found then return next r; end if;
end loop; end; $$;
create function public.acq_event(p_event jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin perform pg_advisory_xact_lock(732191);
insert into public.acq_events(event_id,payload) values(p_event->>'event_id',p_event) on conflict do nothing; if not found then return; end if;
if p_event->>'kind' in ('reply','optout') then update public.acq_contacts set replied=true,suppressed=true where phone=p_event->>'phone';
else update public.acq_reservations set provider_id=coalesce(provider_id,p_event->>'provider_id'), delivered_at=case when p_event->>'kind' in ('delivered','read') then coalesce(delivered_at,now()) else delivered_at end, state=case when delivered_at is not null then state else p_event->>'kind' end where phone=p_event->>'phone' and (provider_id=p_event->>'provider_id' or (provider_id is null and id::text=p_event->>'reservation_id')); end if;
end; $$;
revoke all on function public.acq_preview(text),public.acq_reserve(text),public.acq_event(jsonb) from public,anon,authenticated;
grant execute on function public.acq_preview(text),public.acq_reserve(text),public.acq_event(jsonb) to service_role;
