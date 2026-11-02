import { operator,withOperator } from '@/lib/security/auth';
import { getSupabase } from '@/lib/supabase';
import { UUID } from '@/lib/security/policy';
export const PATCH=withOperator(async(request:Request,{params}:{params:Promise<{id:string}>})=>{
 const {id}=await params, input=await request.json();
 if(!UUID.test(id)||!['new','contacted','replied','won','lost'].includes(input.status)||typeof input.notes!=='string'||input.notes.length>4000|| (input.next_action_at && (typeof input.next_action_at!=='string'||!Number.isFinite(Date.parse(input.next_action_at)))))return Response.json({error:'Datos inválidos'},{status:400});
 if(input.permission!==undefined&&(typeof input.permission!=='boolean'||typeof input.evidence!=='string'||input.evidence.length>2000||(input.permission&&!input.evidence.trim())))return Response.json({error:'Falta evidencia del permiso'},{status:400});
 const user=await operator();
 const {data,error}=await getSupabase().rpc('save_commercial',{p_id:id,p_status:input.status,p_notes:input.notes,p_next:input.next_action_at||null,p_permission:input.permission??null,p_evidence:input.evidence??'',p_operator:user!.id});
 if(error)return Response.json({error:'No se pudo guardar la ficha.'},{status:400});
 return Response.json({lead:{id:data}});
});
