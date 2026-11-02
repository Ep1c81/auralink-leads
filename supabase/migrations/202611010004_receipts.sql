begin;
create or replace function public.record_dispatch_receipt(p_event text,p_job uuid,p_state text,p_provider_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_state not in ('accepted','delivered','failed') then raise exception 'Estado inválido'; end if;
 insert into integration_inbox(provider,event_id,kind,payload,status) values('make',p_event,'receipt',jsonb_build_object('job_id',p_job,'state',p_state),'done') on conflict do nothing;
 if not found then return; end if;
 update dispatch_jobs set state=p_state,provider_message_id=coalesce(p_provider_id,provider_message_id),updated_at=now() where id=p_job and (state in ('transmitting','uncertain') or (state='accepted' and p_state in ('delivered','failed')));
 insert into job_audit(job_id,action,actor) values(p_job,'receipt:'||p_state,'make');
end $$;
revoke execute on function public.record_dispatch_receipt(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_dispatch_receipt(text,uuid,text,text) to service_role;
create or replace function public.replay_dispatch(p_job uuid,p_operator uuid,p_evidence text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if length(trim(p_evidence))<10 then raise exception 'Falta evidencia de conciliación'; end if;
 update dispatch_jobs set state='queued',available_at=now(),lease_token=null,lease_until=null where id=p_job and state='failed';
 if not found then raise exception 'Solo se reprocesan fallos confirmados'; end if;
 insert into job_audit(job_id,action,actor) values(p_job,'replay:'||left(p_evidence,500),p_operator::text);
end $$;
revoke execute on function public.replay_dispatch(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.replay_dispatch(uuid,uuid,text) to service_role;
commit;
