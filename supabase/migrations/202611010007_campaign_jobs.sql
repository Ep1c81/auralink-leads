begin;
alter table public.dispatch_jobs alter column lead_id drop not null;
alter table public.dispatch_jobs add column crm_lead_id uuid references public.leads(id), add column outreach_message_id uuid references public.outreach_messages(id);
alter table public.outreach_messages drop constraint if exists outreach_messages_status_check;
alter table public.outreach_messages add constraint outreach_messages_status_check check(status in ('draft','queued','sent','failed','bounced','processing','transmitting','accepted','delivered','uncertain','suppressed'));
create or replace function public.approve_campaign_message(p_message uuid,p_operator uuid,p_subject text,p_body text,p_phone text)
returns public.outreach_messages language plpgsql security definer set search_path=public as $$
declare m public.outreach_messages; l public.leads; v_phone text; bid uuid;
begin
 select * into m from outreach_messages where id=p_message for update;
 if not found then raise exception 'Mensaje no encontrado'; end if;
 if m.status<>'draft' then raise exception 'El borrador ya fue aprobado'; end if;
 if coalesce(m.subject,'')<>p_subject or coalesce(m.body,'')<>p_body or length(trim(p_body))=0 then raise exception 'El borrador cambió; revisalo otra vez'; end if;
 select * into l from leads where id=m.lead_id for share;
 v_phone=public.format_wa_phone(l.phone);
 if v_phone is null or v_phone!~'^506[5-8][0-9]{7}$' or v_phone<>public.format_wa_phone(p_phone) then raise exception 'El destinatario cambió o no tiene un teléfono válido'; end if;
 if not exists(select 1 from contact_permissions p where p.phone=v_phone and p.allowed) then raise exception 'Falta permiso de contacto'; end if;
 insert into dispatch_batches(operator_id,campaign_key,stage,status,approved_at) values(p_operator,m.campaign_id::text,'campaign','approved',now()) returning id into bid;
 insert into dispatch_jobs(batch_id,crm_lead_id,outreach_message_id,phone,campaign_key,stage,state,payload) values(bid,l.id,m.id,v_phone,m.campaign_id::text,'campaign','queued',jsonb_build_object('lead_id',l.id,'phone',v_phone,'business_name',coalesce(l.company,l.name),'message_text',m.body,'sequence_stage','campaign','message_id',m.id));
 update outreach_messages set status='queued' where id=m.id returning * into m;
 insert into job_audit(job_id,action,actor) select id,'approved',p_operator::text from dispatch_jobs where outreach_message_id=m.id;
 return m;
end $$;
create or replace function public.sync_campaign_job()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.outreach_message_id is not null then update outreach_messages set status=new.state,provider_message_id=new.provider_message_id,sent_at=case when new.state='delivered' then now() else sent_at end where id=new.outreach_message_id; end if;
 return new;
end $$;
create trigger sync_campaign_job after update of state on public.dispatch_jobs for each row execute function public.sync_campaign_job();
revoke execute on function public.approve_campaign_message(uuid,uuid,text,text,text),public.sync_campaign_job() from public,anon,authenticated;
grant execute on function public.approve_campaign_message(uuid,uuid,text,text,text) to service_role;
commit;
