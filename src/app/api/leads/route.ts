import {withOperator} from '@/lib/security/auth';
import {getSupabase} from '@/lib/supabase';
import {pageNumber} from '@/lib/pagination';
export const GET=withOperator(async(request:Request)=>{
 const page=pageNumber(new URL(request.url).searchParams.get('page'));
 const {data,error,count}=await getSupabase().from('leads').select('id,name,email,phone,company,status,lead_score,metadata,created_at,instagram_url,facebook_url,whatsapp_number,enrichment_status',{count:'exact'}).order('created_at',{ascending:false}).order('id').range(page*50,page*50+49);
 if(error)throw error;return Response.json({leads:data??[],total:count??0,page,page_size:50});
});
