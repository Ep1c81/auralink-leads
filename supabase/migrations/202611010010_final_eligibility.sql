begin;
create or replace function public.begin_transmission(p_job uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare j public.dispatch_jobs;
begin
 select * into j from dispatch_jobs where id=p_job and lease_token=p_token and state='processing' and lease_until>now() for update;
 if not found then return false; end if;
 if not exists(select 1 from send_control where id and enabled)
 or not exists(select 1 from contact_permissions where phone=j.phone and allowed)
 or exists(select 1 from bizmap_leads b where b.id=j.lead_id and (b.has_replied or b.commercial_status in ('won','lost') or b.wa_phone is distinct from j.phone or (j.stage='pitch_1' and b.outreached_at is not null) or b.outreach_status in ('Closed','Wrong Business','Invalid Number','No WhatsApp (mobile)','No WhatsApp (landline)')))
 or exists(select 1 from leads l where l.id=j.crm_lead_id and public.format_wa_phone(l.phone) is distinct from j.phone)
 or exists(select 1 from lead_links link join bizmap_leads b on b.id=link.bizmap_lead_id where link.lead_id=j.crm_lead_id and b.commercial_status in ('won','lost')) then
 update dispatch_jobs set state='suppressed',updated_at=now() where id=j.id; return false;
 end if;
 update dispatch_jobs set state='transmitting',updated_at=now() where id=j.id;
 return true;
end $$;
revoke execute on function public.begin_transmission(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_transmission(uuid,uuid) to service_role;
commit;
