import {operator,withOperator} from '@/lib/security/auth';
import {getSupabase} from '@/lib/supabase';
import {UUID} from '@/lib/security/policy';
export const GET=withOperator(async()=>{
 const db=getSupabase();const [jobs,control]=await Promise.all([db.from('dispatch_jobs').select('id,state,attempts,available_at,lease_until,created_at,updated_at,business_name:payload->>business_name').order('created_at',{ascending:false}).limit(50),db.from('send_control').select('enabled,daily_limit,used,budget_day').single()]);if(jobs.error||control.error)throw new Error('No disponible');return Response.json({jobs:jobs.data,control:control.data});
});
export const POST=withOperator(async(request:Request)=>{
 const b=await request.json(),db=getSupabase();
 if(b.action==='pause'){const {error}=await db.from('send_control').update({enabled:false}).eq('id',true);if(error)throw error;return Response.json({ok:true});}
 if(b.action==='resume'&&process.env.MAKE_CONTRACT_VERIFIED==='true'){const {error}=await db.from('send_control').update({enabled:true}).eq('id',true);if(error)throw error;return Response.json({ok:true});}
 if(b.action==='replay'&&typeof b.job_id==='string'&&UUID.test(b.job_id)&&typeof b.evidence==='string'&&b.evidence.length>=10&&b.evidence.length<=500){const user=await operator();const {error}=await db.rpc('replay_dispatch',{p_job:b.job_id,p_operator:user!.id,p_evidence:b.evidence});if(error)return Response.json({error:'No se puede reprocesar este trabajo'},{status:409});return Response.json({ok:true});}
 return Response.json({error:'Acción no disponible'},{status:409});
});
