-- Dead-end outcomes for the WhatsApp sequence, plus a manual retry plan by
-- another channel. "No WhatsApp (mobile|landline)" is set automatically by
-- POST /api/webhooks/make-send-failed; "Invalid Number" and "Wrong Business"
-- are set by hand.
alter table public.bizmap_leads
  drop constraint if exists bizmap_leads_outreach_status_check;

alter table public.bizmap_leads
  add constraint bizmap_leads_outreach_status_check
    check (outreach_status in (
      'Queued', 'Pitch Sent', 'Followup Sent', 'Replied', 'Closed',
      'No WhatsApp (landline)', 'No WhatsApp (mobile)', 'Invalid Number', 'Wrong Business'
    ));

alter table public.bizmap_leads
  -- Email, Instagram handle or Facebook page to try instead of WhatsApp.
  add column if not exists alt_contact text,
  -- How to reach them next: Email, IG DM, Walk-in, "Find alternate contact"...
  add column if not exists retry_method text,
  add column if not exists retry_date timestamptz;
