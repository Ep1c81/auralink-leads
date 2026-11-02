begin;
-- Serializa las vistas previas de un operador y permite recuperar el mismo lote.
create or replace function public.prepare_dispatch(p_operator uuid,p_limit integer,p_stage text default 'pitch_1')
returns uuid language plpgsql security definer set search_path=public as $$
declare bid uuid;
begin
 if p_stage not in ('pitch_1','followup_2') then raise exception 'Etapa inválida'; end if;
 if p_limit<1 or p_limit>25 then raise exception 'Límite inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operator::text,1));
 select id into bid from dispatch_batches where operator_id=p_operator and stage=p_stage and status='draft' order by created_at limit 1 for update;
 if bid is not null then
 update dispatch_batches set created_at=now() where id=bid;
 return bid;
 end if;
 insert into dispatch_batches(operator_id,campaign_key,stage) values(p_operator,'bizmap-initial-v1',p_stage) returning id into bid;
 insert into dispatch_jobs(batch_id,lead_id,phone,campaign_key,stage,payload)
 select bid,l.id,l.wa_phone,'bizmap-initial-v1',p_stage,jsonb_build_object(
 'lead_id',l.id,'phone',l.wa_phone,'business_name',l.business_name,'sequence_stage',p_stage,
 'message_text',case when p_stage='followup_2' then 'Hola. Les damos seguimiento a nuestra consulta de BizMapShield. ¿Les gustaría que les mostremos cómo funciona? Si prefieren no recibir más mensajes, nos lo indican.' else 'Hola, equipo de '||coalesce(l.business_name,'su negocio')||'. Soy de BizMapShield. Facilitamos que sus clientes abran el enlace de reseñas de Google con una tarjeta NFC o un código QR y compartan su experiencia. ¿Les gustaría conocer cómo funciona? Si prefieren que no les contactemos, nos lo indican y lo registramos.' end)
 from bizmap_leads l where l.outreach_status not in ('Closed','Wrong Business','Invalid Number','No WhatsApp (mobile)','No WhatsApp (landline)') and not l.has_replied and l.lead_score>=8 and l.wa_phone~'^506[5-8][0-9]{7}$'
 and ((p_stage='pitch_1' and l.outreach_status='Queued' and l.outreached_at is null) or p_stage='followup_2')
 and (p_stage='pitch_1' or exists(select 1 from dispatch_jobs prior where prior.phone=l.wa_phone and prior.stage='pitch_1' and prior.state='delivered' and prior.updated_at<now()-interval '3 days'))
 and not exists(select 1 from dispatch_jobs j where j.phone=l.wa_phone and j.campaign_key='bizmap-initial-v1' and j.stage=p_stage)
 order by l.lead_score desc,l.id limit p_limit on conflict(campaign_key,phone,stage) do nothing;
 if not found then update dispatch_batches set status='empty' where id=bid; end if;
 return bid;
end $$;
revoke execute on function public.prepare_dispatch(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.prepare_dispatch(uuid,integer,text) to service_role;
-- Explicita privilegios: no depende de los defaults de cada instancia Supabase.
do $$ declare t text; begin
 foreach t in array array['leads','lead_conversations','bizmap_leads','outreach_campaigns','outreach_messages','outreach_replies','integration_inbox','contact_permissions','send_control','dispatch_batches','dispatch_jobs','job_audit','lead_links','discovery_runs','resource_limits'] loop
 execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.job_audit_id_seq to service_role;
commit;
