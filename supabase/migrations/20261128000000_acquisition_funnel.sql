-- Self-service 14-day trial funnel on top of the acquisition tables (PR #17).
-- * acq_contacts gains trial/conversation state.
-- * acq_register(): records WhatsApp consent from a registration form, deduplicates by phone,
--   and excludes blocked numbers and existing customers.
-- * acq_event(): a reply no longer suppresses the contact (the conversation continues for free);
--   only an opt-out suppresses. Returns true only the first time an event_id is seen, so
--   retried webhooks never produce duplicate bot replies.

alter table public.acq_contacts
  add column if not exists contact_name text,
  add column if not exists source text not null default 'manual',
  add column if not exists trial_status text not null default 'none',
  add column if not exists conv_state text not null default 'new',
  add column if not exists preferred_slot text,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.acq_contacts drop constraint if exists acq_contacts_trial_status_check;
alter table public.acq_contacts add constraint acq_contacts_trial_status_check
  check (trial_status in ('none','registered','scheduling','ready_for_activation','active','declined'));
alter table public.acq_contacts drop constraint if exists acq_contacts_conv_state_check;
alter table public.acq_contacts add constraint acq_contacts_conv_state_check
  check (conv_state in ('new','awaiting_choice','awaiting_schedule','faq','done','closed'));

create or replace function public.acq_register(p_phone text, p_lead_id uuid, p_business text, p_name text, p_evidence text)
returns text language plpgsql security invoker set search_path='' as $$
declare existing public.acq_contacts;
begin
  perform pg_advisory_xact_lock(732191);
  if p_phone is null or p_phone !~ '^506[5-8][0-9]{7}$' then return 'invalid_phone'; end if;
  if p_phone in ('50663489897','50670498864','50663889598') or coalesce(p_business,'') ~* 'new[[:space:]]+life' then return 'blocked'; end if;
  if length(trim(coalesce(p_evidence,''))) = 0 then return 'missing_consent'; end if;
  select * into existing from public.acq_contacts where phone = p_phone;
  if found and existing.customer then return 'customer'; end if;
  if exists (select 1 from public.bizmap_leads b
             where right(regexp_replace(coalesce(b.phone_number,''),'\D','','g'),8) = right(p_phone,8)
               and (coalesce(b.status,'') ~* '(cliente|client|customer|won|ganad|activo)' or b.outreach_status = 'Closed')) then
    return 'customer';
  end if;
  if found then
    update public.acq_contacts set
      consent_at = now(), consent_evidence = p_evidence, suppressed = false,
      contact_name = coalesce(nullif(trim(p_name),''), contact_name),
      source = 'shieldy',
      trial_status = case when trial_status in ('none','declined') then 'registered' else trial_status end,
      conv_state = case when conv_state = 'closed' then 'new' else conv_state end,
      updated_at = now()
    where phone = p_phone;
    return 'updated';
  end if;
  insert into public.acq_contacts(phone, lead_id, business_name, consent_at, consent_evidence, suppressed, history_verified,
                                  contact_name, source, trial_status, conv_state)
  values (p_phone, p_lead_id, left(coalesce(nullif(trim(p_business),''),'Negocio'),100), now(), p_evidence, false, true,
          nullif(trim(p_name),''), 'shieldy', 'registered', 'new');
  return 'registered';
end; $$;

drop function if exists public.acq_event(jsonb);
create function public.acq_event(p_event jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
begin perform pg_advisory_xact_lock(732191);
insert into public.acq_events(event_id,payload) values(p_event->>'event_id',p_event) on conflict do nothing; if not found then return false; end if;
if p_event->>'kind' = 'optout' then
  update public.acq_contacts set replied=true, suppressed=true, last_inbound_at=now(), conv_state='closed',
    trial_status = case when trial_status in ('ready_for_activation','active') then trial_status else 'declined' end, updated_at=now()
  where phone=p_event->>'phone';
elsif p_event->>'kind' = 'reply' then
  update public.acq_contacts set replied=true, last_inbound_at=now(), updated_at=now() where phone=p_event->>'phone';
else update public.acq_reservations set provider_id=coalesce(provider_id,p_event->>'provider_id'), delivered_at=case when p_event->>'kind' in ('delivered','read') then coalesce(delivered_at,now()) else delivered_at end, state=case when delivered_at is not null then state else p_event->>'kind' end where phone=p_event->>'phone' and (provider_id=p_event->>'provider_id' or (provider_id is null and id::text=p_event->>'reservation_id')); end if;
return true;
end; $$;

revoke all on function public.acq_register(text,uuid,text,text,text), public.acq_event(jsonb) from public,anon,authenticated;
grant execute on function public.acq_register(text,uuid,text,text,text), public.acq_event(jsonb) to service_role;
