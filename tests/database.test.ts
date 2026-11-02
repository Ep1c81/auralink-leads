import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
const uuid='11111111-1111-4111-8111-111111111111';
test('migraciones, permisos, inbox, aprobación, leases y no reenvío',async()=>{
 const db=new PGlite();
 try {
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 for(const f of (await readdir('supabase/migrations')).sort()){
  const sql=(await readFile('supabase/migrations/'+f,'utf8')).replace(/create extension if not exists "?pgcrypto"?;/gi,'');
  if(f==='202611010001_security.sql') await db.exec("insert into bizmap_leads(business_name,phone_number,website) values('Histórico sin contacto','N/A','N/A');");
  try{await db.exec(sql);}catch(e){throw new Error(f+': '+String(e));}
 }
 assert.equal((await db.query<{n:number}>("select count(*)::int n from bizmap_leads where business_name='Histórico sin contacto'")).rows[0].n,1);
 await db.exec('set role service_role');
 await db.query('select * from integration_inbox');
 await db.exec('reset role');
 await db.exec(`insert into bizmap_leads(id,business_name,phone_number) values('${uuid}','Sintético','88880000');`);
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>db.query('select * from bizmap_leads'));
  await assert.rejects(()=>db.query('select * from leads'));
  await assert.rejects(()=>db.query('select * from claim_dispatch()'));
  await db.exec('reset role');
 }
 for(let i=0;i<10;i++)await db.query(`insert into integration_inbox(provider,event_id,kind,payload) values('meta','event-1','messages','{"from":"50688880000","text":{"body":"Hola"}}') on conflict do nothing`);
 await db.query('select process_inbox()');await db.query('select process_inbox()');
 assert.equal((await db.query<{n:number}>('select count(*)::int n from lead_conversations')).rows[0].n,1);
 await db.exec(`update bizmap_leads set has_replied=false; insert into contact_permissions(phone,allowed,evidence,source) values('50688880000',true,'Permiso sintético','test'); insert into dispatch_batches(id,operator_id,campaign_key,stage) values('${uuid}','${uuid}','test','pitch'); insert into dispatch_jobs(batch_id,lead_id,phone,campaign_key,stage,payload) values('${uuid}','${uuid}','50688880000','test','pitch','{"message_text":"Texto aprobado"}'); update send_control set enabled=true;`);
 await assert.rejects(()=>db.query('select approve_dispatch($1,$2)',[uuid,'22222222-2222-4222-8222-222222222222']));
 await db.query('select approve_dispatch($1,$1)',[uuid]);await db.query('select approve_dispatch($1,$1)',[uuid]);
 const claims=await Promise.all([db.query('select * from claim_dispatch()'),db.query('select * from claim_dispatch()')]);assert.equal(claims.reduce((n,r)=>n+r.rows.length,0),1);
 await db.exec("update dispatch_jobs set lease_until=now()-interval '1 second'; update send_control set next_send_at=now();");
 const j=(await db.query<{id:string;lease_token:string}>('select * from claim_dispatch()')).rows[0];assert.ok(j);
 await db.query('select begin_transmission($1,$2)',[j.id,j.lease_token]);
 await db.exec("update dispatch_jobs set lease_until=now()-interval '1 second'; update send_control set next_send_at=now();");
 assert.equal((await db.query('select * from claim_dispatch()')).rows.length,0);
 assert.equal((await db.query<{state:string}>('select state from dispatch_jobs')).rows[0].state,'uncertain');
 await db.exec("update dispatch_jobs set state='queued'; update contact_permissions set allowed=false; update send_control set next_send_at=now();");
 assert.equal((await db.query('select * from claim_dispatch()')).rows.length,0);
 assert.equal((await db.query<{state:string}>('select state from dispatch_jobs')).rows[0].state,'suppressed');

 await db.exec("update dispatch_jobs set state='accepted',provider_message_id='provider-1';");
 await db.query("select record_dispatch_receipt('receipt-1',$1,'delivered','provider-1')",[j.id]);
 await db.query("select record_dispatch_receipt('receipt-2',$1,'accepted','provider-1')",[j.id]);
 assert.equal((await db.query<{state:string}>('select state from dispatch_jobs')).rows[0].state,'delivered');
 await assert.rejects(()=>db.query('select replay_dispatch($1,$2,$3)',[j.id,uuid,'Conciliación sintética']));
 assert.equal((await db.query<{payload:{message_text:string}}>('select payload from dispatch_jobs')).rows[0].payload.message_text,'Texto aprobado');
 await db.exec("insert into bizmap_leads(business_name,source_key) values('Sucursal','osm_node_1'),('Sucursal','osm_node_2');");
 assert.equal((await db.query<{n:number}>("select count(*)::int n from bizmap_leads where business_name='Sucursal'")).rows[0].n,2);

 const promoted=(await db.query<{id:string}>('select * from promote_bizmap($1)',[uuid])).rows[0];
 assert.ok(promoted.id);
 await db.exec(`insert into outreach_campaigns(id,name) values('${uuid}','Campaña sintética'); insert into outreach_messages(id,campaign_id,lead_id,subject,body) values('${uuid}','${uuid}','${promoted.id}','Asunto','Mensaje revisado'); update contact_permissions set allowed=true;`);
 await assert.rejects(()=>db.query('select approve_campaign_message($1,$1,$2,$3,$4)',[uuid,'Asunto','Texto modificado','50688880000']));
 await db.query('select approve_campaign_message($1,$1,$2,$3,$4)',[uuid,'Asunto','Mensaje revisado','50688880000']);
 const campaignJob=(await db.query<{id:string;payload:{message_text:string}}>('select id,payload from dispatch_jobs where outreach_message_id=$1',[uuid])).rows[0];
 assert.equal(campaignJob.payload.message_text,'Mensaje revisado');
 await assert.rejects(()=>db.query('select approve_campaign_message($1,$1,$2,$3,$4)',[uuid,'Asunto','Mensaje revisado','50688880000']));
 await db.query("select record_dispatch_receipt('campaign-delivered',$1,'delivered','cp-1')",[campaignJob.id]);
 // Un receipt no puede saltarse la transmisión: el trabajo sigue en cola.
 assert.equal((await db.query<{status:string}>('select status from outreach_messages where id=$1',[uuid])).rows[0].status,'queued');
 await db.query("update dispatch_jobs set state='accepted' where id=$1",[campaignJob.id]);
 await db.query("select record_dispatch_receipt('campaign-delivered-2',$1,'delivered','cp-1')",[campaignJob.id]);
 assert.equal((await db.query<{status:string}>('select status from outreach_messages where id=$1',[uuid])).rows[0].status,'delivered');
 await db.query("update dispatch_jobs set campaign_key='bizmap-initial-v1',stage='pitch_1',state='delivered',updated_at=now()-interval '4 days' where id=$1",[j.id]);
 await db.exec('update bizmap_leads set lead_score=9,has_replied=false');
 const followup=(await db.query<{id:string}>("select prepare_dispatch($1,5,'followup_2') id",[uuid])).rows[0].id;
 assert.equal((await db.query<{id:string}>("select prepare_dispatch($1,5,'followup_2') id",[uuid])).rows[0].id,followup);
 assert.equal((await db.query<{n:number}>("select count(*)::int n from dispatch_jobs where batch_id=$1",[followup])).rows[0].n,1);
 } finally { await db.close(); }
});
