import 'server-only';
import {getSupabase} from './supabase';
export async function reserveAI(){
 if(process.env.AI_ENABLED!=='true')return false;
 const configured=Number(process.env.AI_DAILY_CALL_LIMIT??10);
 const limit=Number.isInteger(configured)?Math.min(100,Math.max(0,configured)):0;
 const {data,error}=await getSupabase().rpc('reserve_resource',{p_resource:'ai',p_limit:limit,p_spacing:0});
 return !error&&data===true;
}
