-- Applied to production 2026-11-27 (Supabase migration "acquisition_niche_priority").
-- Changes only the ORDER of acq_preview: barbers -> dentists -> spas/beauty -> restaurants -> rest,
-- then lead_score. Eligibility rules (consent, suppression, exclusions, 5/day) are unchanged.
create or replace function public.acq_preview(p_stage text) returns table(id uuid,phone text,business_name text,stage text,consent_verified boolean,suppressed boolean) language sql security invoker set search_path='' as $$
select c.lead_id,c.phone,c.business_name,p_stage,true,false from public.acq_contacts c join public.bizmap_leads b on b.id=c.lead_id where c.consent_at<=now() and length(trim(c.consent_evidence))>0 and not c.suppressed and not c.customer and not c.replied and c.history_verified and c.phone not in ('50663489897','50670498864') and c.business_name !~* 'new[[:space:]]+life' and b.has_replied is not true and not exists(select 1 from public.acq_reservations r where r.phone=c.phone and r.stage=p_stage) and ((p_stage='pitch_1' and b.last_contacted_at is null and b.outreached_at is null and coalesce(b.outreach_status,'') in ('','Queued')) or (p_stage='followup_2' and exists(select 1 from public.acq_reservations r where r.phone=c.phone and r.stage='pitch_1' and r.delivered_at<=now()-interval '72 hours')))
order by case
  when c.business_name ~* 'barber' or b.business_type ~* 'barber' then 1
  when c.business_name ~* 'dent|odont' or b.business_type ~* 'dent' then 2
  when c.business_name ~* 'spa|est[eé]tica|beauty|belleza' or b.business_type ~* 'beauty|spa' then 3
  when c.business_name ~* 'restaurant|soda' or b.business_type ~* 'restaurant' then 4
  else 5 end, b.lead_score desc nulls last, c.phone limit 5;
$$;
revoke all on function public.acq_preview(text) from public,anon,authenticated;
grant execute on function public.acq_preview(text) to service_role;
