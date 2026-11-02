begin;
create or replace function public.promote_bizmap(p_id uuid)
returns public.leads language plpgsql security definer set search_path=public as $$
declare b public.bizmap_leads; l public.leads;
begin
 select * into b from bizmap_leads where id=p_id for update;
 if not found then raise exception 'Prospecto no encontrado'; end if;
 insert into leads(name,company,phone,source_key,metadata) values(b.business_name,b.business_name,b.phone_number,'bizmap:'||b.id::text,jsonb_build_object('source','bizmap','bizmap_lead_id',b.id,'website',b.website,'address',b.address)) on conflict(source_key) do nothing;
 select * into l from leads where source_key='bizmap:'||b.id::text;
 insert into lead_links(lead_id,bizmap_lead_id,evidence) values(l.id,b.id,'Promoción explícita desde la ficha del CRM') on conflict do nothing;
 return l;
end $$;
revoke execute on function public.promote_bizmap(uuid) from public,anon,authenticated;
grant execute on function public.promote_bizmap(uuid) to service_role;
commit;
