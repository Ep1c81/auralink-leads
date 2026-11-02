import {sameSecret,readBody,UUID} from '@/lib/security/policy';
import {failure} from '@/lib/security/auth';
import {getSupabase} from '@/lib/supabase';
export async function POST(request:Request){
 if(!sameSecret(request.headers.get('authorization'),process.env.MAKE_RECEIPT_SECRET?`Bearer ${process.env.MAKE_RECEIPT_SECRET}`:undefined))return failure(401,'Acceso denegado.');
 try{const b=JSON.parse(Buffer.from(await readBody(request,8192)).toString());if(typeof b.event_id!=='string'||!b.event_id.length||b.event_id.length>256||typeof b.job_id!=='string'||!UUID.test(b.job_id)||!['accepted','delivered','failed'].includes(b.state)||typeof b.provider_message_id!=='string'||!b.provider_message_id.length||b.provider_message_id.length>256)return failure(400,'Evento inválido.');
 const {error}=await getSupabase().rpc('record_dispatch_receipt',{p_event:b.event_id,p_job:b.job_id,p_state:b.state,p_provider_id:b.provider_message_id});if(error)return failure(503,'No se pudo guardar el evento.');return Response.json({ok:true});}catch{return failure(400,'Evento inválido.');}
}
