import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3100';
const cases=[['/api/leads','GET',401],['/api/bizmap-leads','GET',401],['/api/prospecting','POST',401],['/api/qualify','POST',401],['/api/enrich-lead','POST',401],['/api/cron/auto-prospect','POST',401],['/api/outreach/dispatch','POST',401],['/api/outreach/jobs','GET',401],['/api/cron/worker','POST',401],['/api/cron/sweep','GET',401],['/api/integrations/shieldy','POST',401],['/api/webhooks/whatsapp','POST',401],['/api/webhooks/make-receipt','POST',401],['/api/auth','POST',403]];
for(const[path,method,status]of cases){const r=await fetch(base+path,{method,redirect:'manual',...(method==='POST'?{body:'{}',headers:{'Content-Type':'application/json'}}:{})});assert.equal(r.status,status,path);console.log(`${method} ${path}: ${status}`);}
for(const path of ['/','/dashboard','/outreach']){const r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,307,path);assert.ok(r.headers.get('location')?.includes('/login'));}
console.log('17 verificaciones HTTP sin credenciales: correctas.');
