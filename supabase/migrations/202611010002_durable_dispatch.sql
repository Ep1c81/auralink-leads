begin;
create table public.contact_permissions (
 phone text primary key, allowed boolean not null default false, evidence text,
 source text not null, updated_at timestamptz not null default now(),
 check (not allowed or length(evidence)>0)
);
create table public.send_control (
 id boolean primary key default true check(id), enabled boolean not null default false,
 daily_limit integer not null default 20 check(daily_limit between 0 and 1000),
 used integer not null default 0, budget_day date not null default current_date,
 next_send_at timestamptz not null default now()
);
insert into public.send_control(id) values(true);
create table public.dispatch_batches (
 id uuid primary key default gen_random_uuid(), operator_id uuid not null,
 campaign_key text not null, stage text not null, status text not null default 'draft',
 created_at timestamptz not null default now(), approved_at timestamptz
);
create table public.dispatch_jobs (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.dispatch_batches(id),
 lead_id uuid not null references public.bizmap_leads(id), phone text not null,
 campaign_key text not null, stage text not null, payload jsonb not null,
 state text not null default 'draft' check(state in ('draft','queued','processing','transmitting','accepted','delivered','failed','uncertain','suppressed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_until timestamptz, lease_token uuid, provider_message_id text, last_error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(campaign_key,phone,stage)
);
create index dispatch_jobs_ready on public.dispatch_jobs(state,available_at);
create table public.job_audit (
 id bigint generated always as identity primary key, job_id uuid references public.dispatch_jobs(id),
 action text not null, actor text not null, created_at timestamptz not null default now()
);
create or replace function public.approve_dispatch(p_batch uuid, p_operator uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare b public.dispatch_batches; n integer;
begin
 select * into b from dispatch_batches where id=p_batch and operator_id=p_operator for update;
 if not found then raise exception 'Lote no encontrado'; end if;
 if b.status='approved' then return 0; end if;
 if b.status<>'draft' or b.created_at<now()-interval '30 minutes' then raise exception 'Vista previa vencida'; end if;
 update dispatch_jobs set state=case when exists(select 1 from contact_permissions c where c.phone=dispatch_jobs.phone and c.allowed) then 'queued' else 'suppressed' end, updated_at=now() where batch_id=p_batch and state='draft';
 get diagnostics n=row_count;
 update dispatch_batches set status='approved',approved_at=now() where id=p_batch;
 insert into job_audit(job_id,action,actor) select id,'approved',p_operator::text from dispatch_jobs where batch_id=p_batch;
 return n;
end $$;
create or replace function public.claim_dispatch()
returns setof public.dispatch_jobs language plpgsql security definer set search_path=public as $$
declare j public.dispatch_jobs; c public.send_control;
begin
 -- Una transmisión interrumpida es incierta; nunca vuelve automáticamente a la cola.
 update dispatch_jobs set state='uncertain',last_error='lease_expired_after_transmission',updated_at=now() where state='transmitting' and lease_until<now();
 update dispatch_jobs set state='queued',lease_token=null,lease_until=null where state='processing' and lease_until<now();
 select * into c from send_control where id=true for update;
 if not c.enabled or c.next_send_at>now() then return; end if;
 if c.budget_day<>current_date then update send_control set used=0,budget_day=current_date where id; c.used=0; end if;
 if c.used>=c.daily_limit then return; end if;
 update dispatch_jobs dj set state='suppressed',updated_at=now() where dj.state='queued' and not exists(select 1 from contact_permissions p where p.phone=dj.phone and p.allowed);
 select * into j from dispatch_jobs where state='queued' and available_at<=now() order by available_at,id for update skip locked limit 1;
 if not found then return; end if;
 update dispatch_jobs set state='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
 update send_control set used=used+1,next_send_at=now()+interval '3 seconds' where id;
 insert into job_audit(job_id,action,actor) values(j.id,'claimed','worker');
 return next j;
end $$;
create or replace function public.begin_transmission(p_job uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare j public.dispatch_jobs;
begin
 select * into j from dispatch_jobs where id=p_job and lease_token=p_token and state='processing' and lease_until>now() for update;
 if not found then return false; end if;
 if not exists(select 1 from send_control where id and enabled) or not exists(select 1 from contact_permissions where phone=j.phone and allowed) or exists(select 1 from bizmap_leads where id=j.lead_id and (has_replied or commercial_status in ('won','lost') or outreach_status in ('Closed','Wrong Business','Invalid Number','No WhatsApp (mobile)','No WhatsApp (landline)'))) then
 update dispatch_jobs set state='suppressed',updated_at=now() where id=j.id; return false;
 end if;
 update dispatch_jobs set state='transmitting',updated_at=now() where id=j.id;
 return true;
end $$;
create or replace function public.finish_dispatch(p_job uuid,p_token uuid,p_state text,p_error text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_state not in ('accepted','uncertain','failed') then raise exception 'Estado inválido'; end if;
 update dispatch_jobs set state=p_state,last_error=p_error,lease_until=null,updated_at=now() where id=p_job and lease_token=p_token and state='transmitting';
 insert into job_audit(job_id,action,actor) values(p_job,p_state,'worker');
end $$;
-- Efectos de inbox en una sola transacción, sin IA ni envío en el ACK.
alter table public.lead_conversations add column if not exists provider_event_id text;
create unique index if not exists conversations_provider_event on public.lead_conversations(provider_event_id) where provider_event_id is not null;
create or replace function public.process_inbox()
returns integer language plpgsql security definer set search_path=public as $$
declare e public.integration_inbox; lid uuid; n integer=0; v_phone text;
begin
 for e in select * from integration_inbox where status='queued' and available_at<=now() order by created_at for update skip locked limit 25 loop
 begin
 if e.kind='messages' then
 v_phone=e.payload->>'from';
 -- Serializa la creación por remitente sin fusionar sucursales.
 perform pg_advisory_xact_lock(hashtextextended(v_phone,0));
 select id into lid from leads where metadata->>'whatsapp_contact'=v_phone limit 1;
 if lid is null then insert into leads(phone,metadata) values(v_phone,jsonb_build_object('whatsapp_contact',v_phone,'source','meta_inbound')) returning id into lid; end if;
 insert into lead_conversations(lead_id,sender,message,metadata,provider_event_id) values(lid,'whatsapp',coalesce(e.payload#>>'{text,body}','[Mensaje multimedia]'),jsonb_build_object('type',e.payload->>'type'),e.event_id) on conflict do nothing;
 if lower(trim(coalesce(e.payload#>>'{text,body}',''))) in ('stop','baja','cancelar','no me contacten') then
 insert into contact_permissions(phone,allowed,source) values(v_phone,false,'meta_optout') on conflict(phone) do update set allowed=false,updated_at=now();
 end if;
 update bizmap_leads set has_replied=true where wa_phone=v_phone;
 elsif e.kind='statuses' and e.payload->>'status' in ('delivered','read') then
 update dispatch_jobs set state='delivered',updated_at=now() where provider_message_id=e.payload->>'id' and state in ('accepted','uncertain','transmitting');
 end if;
 update integration_inbox set status='done',attempts=attempts+1 where id=e.id;
 n=n+1;
 exception when others then
 update integration_inbox set attempts=attempts+1,status=case when attempts>=4 then 'failed' else 'queued' end,available_at=now()+interval '1 minute'*power(2,least(attempts,6)),last_error=sqlstate where id=e.id;
 end;
 end loop; return n;
end $$;
do $$ declare t text; r record; begin
 foreach t in array array['contact_permissions','send_control','dispatch_batches','dispatch_jobs','job_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 end loop;
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('approve_dispatch','claim_dispatch','begin_transmission','finish_dispatch','process_inbox') loop
 execute format('revoke execute on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
commit;
