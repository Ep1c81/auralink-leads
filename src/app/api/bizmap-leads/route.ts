import { withOperator } from '@/lib/security/auth';
import { getSupabase } from '@/lib/supabase';
export const GET=withOperator(async(request:Request)=>{
 const p=new URL(request.url).searchParams, page=Number(p.get('page')??0);
 if(!Number.isInteger(page)||page<0||page>10000)return Response.json({error:'Página inválida'},{status:400});
 let q=getSupabase().from('bizmap_leads').select('id,business_name,business_type,address,phone_number,website,lead_score,created_at,outreached_at,outreach_status,has_replied,source,source_key,source_metadata,commercial_status,next_action_at,operator_notes',{count:'exact'});
 for(const [key,column] of [['zone','address'],['category','business_type']] as const){const value=p.get(key);if(value){if(value.length>100)return Response.json({error:'Filtro inválido'},{status:400});q=q.ilike(column,`%${value.replace(/[%_]/g,'')}%`);}}
 const status=p.get('status');if(status)q=q.eq('commercial_status',status);
 if(p.get('due')==='1')q=q.lte('next_action_at',new Date().toISOString());
 const {data,error,count}=await q.order('lead_score',{ascending:false}).order('id').range(page*50,page*50+49);
 if(error)throw error;
 return Response.json({leads:data??[],total:count??0,page,page_size:50});
});
