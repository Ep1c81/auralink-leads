begin;
create or replace function public.save_commercial(p_id uuid,p_status text,p_notes text,p_next timestamptz,p_permission boolean,p_evidence text,p_operator uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare b public.bizmap_leads;
begin
 if p_status not in ('new','contacted','replied','won','lost') or length(p_notes)>4000 or length(p_evidence)>2000 then raise exception 'Datos inválidos'; end if;
 select * into b from bizmap_leads where id=p_id for update;
 if not found then raise exception 'Prospecto no encontrado'; end if;
 if p_permission is not null then
 if b.wa_phone is null or (p_permission and length(trim(coalesce(p_evidence,'')))=0) then raise exception 'Falta teléfono o evidencia'; end if;
 insert into contact_permissions(phone,allowed,evidence,source) values(b.wa_phone,p_permission,p_evidence,'operator:'||p_operator::text) on conflict(phone) do update set allowed=excluded.allowed,evidence=excluded.evidence,source=excluded.source,updated_at=now();
 end if;
 update bizmap_leads set commercial_status=p_status,operator_notes=p_notes,next_action_at=p_next where id=p_id;
 return p_id;
end $$;
revoke execute on function public.save_commercial(uuid,text,text,timestamptz,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.save_commercial(uuid,text,text,timestamptz,boolean,text,uuid) to service_role;
-- Nadie debe volver a marcar borradores por coincidencia de asunto y teléfono.
revoke execute on function public.mark_campaign_messages_sent(text[],text,timestamptz) from service_role;
commit;
