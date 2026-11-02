import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runDispatchWorker} from '../src/lib/durableDispatch';
import type {getSupabase} from '../src/lib/supabase';
test('worker: HTTP 200 solo es aceptación; timeout no provoca reintento',async()=>{
 process.env.MAKE_CONTRACT_VERIFIED='true';process.env.MAKE_DISPATCH_WEBHOOK_URL='https://provider.example.test';
 for(const mode of ['accept','timeout','suppressed']){
  const calls:{name:string;args:Record<string,unknown>|undefined}[]=[];let sends=0;
  const mock={rpc:async(name:string,args?:Record<string,unknown>)=>{calls.push({name,args});return {error:null,data:name==='claim_dispatch'?[{id:'job',lease_token:'lease',payload:{message_text:'Sintético'}}]:name==='begin_transmission'?mode!=='suppressed':0};}};
  const send:typeof fetch=async()=>{sends++;if(mode==='timeout')throw new Error('Simula aceptación remota seguida de timeout local');return new Response('',{status:200});};
  const result=await runDispatchWorker({db:mock as unknown as ReturnType<typeof getSupabase>,send});
  assert.equal(sends,mode==='suppressed'?0:1);
  if(mode!=='suppressed')assert.equal(calls.find(x=>x.name==='finish_dispatch')?.args?.p_state,mode==='accept'?'accepted':'uncertain');
  else assert.equal(result.suppressed,true);
 }
 delete process.env.MAKE_CONTRACT_VERIFIED;delete process.env.MAKE_DISPATCH_WEBHOOK_URL;
});
