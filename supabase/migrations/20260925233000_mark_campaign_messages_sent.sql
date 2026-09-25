-- Called by /api/outreach/dispatch and /api/outreach/followup-check after a
-- batch goes to Make, so the campaign page (outreach_messages) matches what
-- was actually sent. outreach_messages links to `leads`, not bizmap_leads, so
-- rows are matched by WhatsApp number: format_wa_phone(leads.phone) against
-- the bizmap_leads.wa_phone values that were dispatched.
--
-- Only rows with the given template subject that are still draft/queued are
-- touched; hand-written messages (any other subject) are left alone.
create or replace function public.mark_campaign_messages_sent(
  p_wa_phones text[],
  p_subject text,
  p_sent_at timestamptz
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with updated as (
    update public.outreach_messages m
    set status = 'sent', sent_at = p_sent_at
    from public.leads l
    where l.id = m.lead_id
      and m.subject = p_subject
      and m.status in ('draft', 'queued')
      and public.format_wa_phone(l.phone) = any (p_wa_phones)
    returning 1
  )
  select count(*)::integer from updated
$$;

revoke execute on function public.mark_campaign_messages_sent(text[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_campaign_messages_sent(text[], text, timestamptz) to service_role;
