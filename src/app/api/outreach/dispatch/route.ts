import { operator, withOperator } from '@/lib/security/auth';
import { UUID } from '@/lib/security/policy';
import { previewBatch } from '@/lib/durableDispatch';
import { getSupabase } from '@/lib/supabase';
export const POST=withOperator(async(request:Request)=>{
 const user=await operator(); if(!user) return Response.json({error:'Acceso denegado'},{status:401});
 const input=await request.json();
 if(input.action==='preview') {
  if(!['pitch_1','followup_2'].includes(input.stage??'pitch_1'))return Response.json({error:'Etapa inválida'},{status:400});
  if(!Number.isInteger(input.limit) || input.limit<1 || input.limit>25) return Response.json({error:'Límite inválido'},{status:400});
  return Response.json(await previewBatch(user.id,input.limit,input.stage??'pitch_1'));
 }
 if(input.action==='approve' && typeof input.batch_id==='string' && UUID.test(input.batch_id)) {
  const {data,error}=await getSupabase().rpc('approve_dispatch',{p_batch:input.batch_id,p_operator:user.id});
  if(error) return Response.json({error:'Lote vencido o inválido'},{status:409});
  return Response.json({approved:data});
 }
 return Response.json({error:'Acción inválida'},{status:400});
});
