import 'server-only';
import { getSupabase } from '@/lib/supabase';
export async function previewBatch(operatorId: string, limit: number, stage: "pitch_1" | "followup_2" = "pitch_1") {
  const db = getSupabase();
  const {data:batchId,error:batchError}=await db.rpc('prepare_dispatch',{p_operator:operatorId,p_limit:limit,p_stage:stage});
  if(batchError)throw batchError;
  const batch={id:batchId as string};
  const {data:items,error:itemsError}=await db.from('dispatch_jobs').select('id,phone,payload,state').eq('batch_id',batch.id);
  if(itemsError) throw itemsError;
  const phones = (items ?? []).map(x=>x.phone);
  const {data:permissions,error:permissionsError}=phones.length ? await db.from('contact_permissions').select('phone,allowed').in('phone',phones) : {data:[],error:null};
  if(permissionsError) throw permissionsError;
  return {batch_id:batch.id,items:(items ?? []).map(x=>({...x,eligible:permissions?.some(p=>p.phone===x.phone && p.allowed) ?? false}))};
}
export async function runDispatchWorker(dependencies: { db?: ReturnType<typeof getSupabase>; send?: typeof fetch } = {}) {
  const db=dependencies.db ?? getSupabase();
  const send=dependencies.send ?? fetch;
  const inbox=await db.rpc('process_inbox'); if(inbox.error) throw inbox.error;
  // Se activa únicamente tras comprobar el contrato idempotente en Make/proveedor.
  if(process.env.MAKE_CONTRACT_VERIFIED!=='true') return {processed:0,inbox:inbox.data,paused:true};
  const endpoint=process.env.MAKE_DISPATCH_WEBHOOK_URL;
  if(!endpoint || new URL(endpoint).protocol!=='https:') throw new Error('Configuración incompleta');
  const {data,error}=await db.rpc('claim_dispatch'); if(error) throw error;
  const job=data?.[0]; if(!job) return {processed:0,inbox:inbox.data};
  const ready=await db.rpc('begin_transmission',{p_job:job.id,p_token:job.lease_token});
  if(ready.error) throw ready.error; if(!ready.data) return {processed:0,suppressed:true};
  let state='uncertain',code='transport_outcome_unknown';
  try {
    const response=await send(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify({idempotency_key:job.id,job_id:job.id,...job.payload})});
    // No se leen ni registran datos del proveedor. Incluso 429/5xx pueden ocurrir tras efectos externos.
    if(response.ok) {state='accepted';code='http_accepted';}
    await response.body?.cancel();
  } catch { /* Una transmisión iniciada nunca se reintenta sin conciliación. */ }
  const finished=await db.rpc('finish_dispatch',{p_job:job.id,p_token:job.lease_token,p_state:state,p_error:code});
  if(finished.error) throw finished.error;
  return {processed:1,state};
}
