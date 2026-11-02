import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'operador@example.test',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:user.id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})+'.mock';
let authorized=true,lookups=0;
const auth=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url?.startsWith('/auth/v1/token'))return res.end(JSON.stringify({access_token:token,refresh_token:'synthetic-refresh-token',expires_in:3600,token_type:'bearer',user}));if(req.url==='/auth/v1/user'){lookups++;return res.end(JSON.stringify(authorized?user:{...user,id:'22222222-2222-4222-8222-222222222222',email:'otro@example.test'}));}res.statusCode=204;res.end();});
await new Promise(r=>auth.listen(3201,'127.0.0.1',r));
const base='http://127.0.0.1:3200';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3200'],{stdio:'ignore',env:{...process.env,APP_ORIGIN:base,SUPABASE_URL:'http://127.0.0.1:3201',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:3201',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public-key',SUPABASE_SERVICE_ROLE_KEY:'',OPERATOR_EMAILS:user.email,OPERATOR_IDS:'',SHIELDY_INGEST_SECRET:'synthetic-shieldy',META_APP_SECRET:'synthetic-meta'}});
try{
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
 const login=await fetch(base+'/api/auth',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:'synthetic-password'})});assert.equal(login.status,200);
 const cookies=login.headers.getSetCookie();assert.ok(cookies.some(c=>/HttpOnly/i.test(c)));
 const cookie=cookies.map(c=>c.split(';')[0]).join('; ');
 const allowed=await fetch(base+'/api/cron/auto-prospect',{headers:{Cookie:cookie}});assert.equal(allowed.status,405);assert.ok(lookups>0,'La identidad se verificó en el servidor Auth');
 const csrf=await fetch(base+'/api/prospecting',{method:'POST',headers:{Cookie:cookie,Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
 authorized=false;const denied=await fetch(base+'/api/leads',{headers:{Cookie:cookie}});assert.equal(denied.status,401);
 const shieldy=await fetch(base+'/api/integrations/shieldy',{method:'POST',headers:{Authorization:'Bearer synthetic-shieldy','Content-Type':'application/json'},body:'{}'});assert.equal(shieldy.status,400);
 const body=JSON.stringify({object:'whatsapp_business_account',entry:[]});const signature='sha256='+createHmac('sha256','synthetic-meta').update(body).digest('hex');
 const meta=await fetch(base+'/api/webhooks/whatsapp',{method:'POST',headers:{'X-Hub-Signature-256':signature},body});assert.equal(meta.status,200);
 const invalid=await fetch(base+'/api/webhooks/whatsapp',{method:'POST',headers:{'X-Hub-Signature-256':signature},body:body+' '});assert.equal(invalid.status,401);
 console.log('7 verificaciones con Auth/integraciones simuladas: login, cookie HttpOnly, identidad remota, CSRF, allowlist, Shieldy y firmas Meta correctas.');
}finally{server.kill('SIGTERM');await new Promise(r=>auth.close(r));}
