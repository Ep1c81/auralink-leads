import { NextResponse } from 'next/server';
import { getSupabase, resolveSupabaseEnv } from '@/lib/supabase';
import { sendMakePayload, validateMakeWebhook } from '@/lib/makeDispatch';
import { decide, type FunnelContact } from './funnel.mjs';
import { authorized, dispatch, eventInput, liveDispatch, stages, type Contact, type LiveResult, type Reservation } from './acquisition.mjs';
function db(){if(resolveSupabaseEnv().keyName!=='SUPABASE_SERVICE_ROLE_KEY')throw Error('Service role required');return getSupabase()}
const liveEnabled=()=>process.env.ACQUISITION_LIVE_ENABLED==='true';
/** Validates all live configuration BEFORE reserving, so a misconfiguration never consumes daily slots. */
function liveConfig(){const url=validateMakeWebhook(process.env.MAKE_DISPATCH_WEBHOOK_URL);const key=process.env.MAKE_DISPATCH_API_KEY?.trim();if(!key)throw Error('MAKE_DISPATCH_API_KEY missing');return {url,key}}
async function runLive(stage:string,cfg:{url:string,key:string}):Promise<LiveResult>{const client=db();return liveDispatch({stage,sender:process.env.WHATSAPP_SENDER_PHONE,
  send:body=>sendMakePayload(cfg.url,body,{'x-make-apikey':cfg.key}),
  store:{
    reserve:async s=>{const {data,error}=await client.rpc('acq_reserve',{p_stage:s});if(error)throw error;return (data??[]) as Reservation[]},
    contacts:async phones=>{const {data,error}=await client.from('acq_contacts').select('phone,lead_id,business_name,suppressed').in('phone',phones);if(error)throw error;return (data??[]) as Contact[]},
    markFailed:async ids=>{const {error}=await client.rpc('acq_mark_failed',{p_ids:ids});if(error)throw error},
  }})}
const status=(r:LiveResult)=>r.outcome==='rejected'||r.outcome==='unknown'?502:200;
export async function previewRoute(req:Request,stage:string){if(!authorized(req.headers.get('authorization'),process.env.OUTREACH_AUTOMATION_SECRET))return NextResponse.json({error:'Unauthorized'},{status:401});
  if(new URL(req.url).searchParams.get('dry_run')==='1'){try{return NextResponse.json(await dispatch({stage,store:{preview:async(stage)=>{const {data,error}=await db().rpc('acq_preview',{p_stage:stage});if(error)throw error;return data??[]}}}))}catch{return NextResponse.json({error:'Preview unavailable'},{status:503})}}
  if(!liveEnabled())return NextResponse.json({error:'Transmission disabled'},{status:503});
  let cfg;try{cfg=liveConfig()}catch{return NextResponse.json({error:'Live dispatch not configured'},{status:503})}
  try{const r=await runLive(stage,cfg);return NextResponse.json(r,{status:status(r)})}catch{return NextResponse.json({error:'Dispatch unavailable'},{status:503})}}
/** Daily Vercel cron: pitch_1 then followup_2. Stops after a failed stage so a broken scenario is not hit twice. */
export async function cronRoute(req:Request){if(!authorized(req.headers.get('authorization'),process.env.CRON_SECRET))return NextResponse.json({error:'Unauthorized'},{status:401});
  if(!liveEnabled())return NextResponse.json({error:'Transmission disabled'},{status:503});
  let cfg;try{cfg=liveConfig()}catch{return NextResponse.json({error:'Live dispatch not configured'},{status:503})}
  const results:LiveResult[]=[];try{for(const stage of stages){const r=await runLive(stage,cfg);results.push(r);if(status(r)!==200)break}}catch{return NextResponse.json({error:'Dispatch unavailable',results},{status:503})}
  return NextResponse.json({results},{status:results.some(r=>status(r)!==200)?502:200})}
/** Make -> CRM events. Records the event once (retries are ignored), then — for inbound replies —
 * runs the deterministic funnel and returns the reply for Make to send inside the free 24h window.
 * With ACQUISITION_BOT_ENABLED off, no reply is returned but Alex is still alerted about every inbound message. */
export async function callback(req:Request){if(!authorized(req.headers.get('authorization'),process.env.ACQUISITION_CALLBACK_SECRET))return NextResponse.json({error:'Unauthorized'},{status:401});let event;try{event=eventInput(await req.json())}catch{return NextResponse.json({error:'Invalid event'},{status:400})}if(process.env.ACQUISITION_CALLBACKS_ENABLED!=='true')return NextResponse.json({error:'Callbacks disabled'},{status:503});
  try{const client=db();const {data:isNew,error}=await client.rpc('acq_event',{p_event:event});if(error)throw error;
    if(isNew===false)return NextResponse.json({ok:true,duplicate:true});
    if(event.kind!=='reply'&&event.kind!=='optout')return NextResponse.json({ok:true});
    const phone=String(event.phone);
    const {data:contact,error:cErr}=await client.from('acq_contacts').select('phone,business_name,contact_name,conv_state,trial_status,customer').eq('phone',phone).maybeSingle();if(cErr)throw cErr;
    const botOn=process.env.ACQUISITION_BOT_ENABLED==='true';
    const d=decide({contact:(contact as FunnelContact|null),text:(event.text as string|null)??'',button:(event.button as string|null)??'',kind:event.kind as 'reply'|'optout'});
    const reply=botOn?d.reply:null;
    const notify=d.notify??(botOn?null:`Respuesta de ${contact?.business_name??'número sin registro'} (+${phone}): "${String(event.text??'').slice(0,300)}"`);
    if(botOn&&d.update){const {error:uErr}=await client.from('acq_contacts').update({...d.update,updated_at:new Date().toISOString()}).eq('phone',phone);if(uErr)throw uErr}
    if(notify){await client.from('acq_events').insert({event_id:`alert:${event.event_id}`,payload:{kind:'alert',phone,text:notify}})}
    return NextResponse.json({ok:true,to:phone,reply,notify})}catch{return NextResponse.json({error:'Event not recorded'},{status:503})}}
