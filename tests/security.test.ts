import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {allowedOperator,sameSecret,validMetaSignature,validOrigin,readBody} from '../src/lib/security/policy';
import {publicAddress,safeFetch} from '../src/lib/security/safeFetch';
test('allowlist cerrada, secretos ausentes y origen',()=>{
 assert.equal(allowedOperator('id','a@example.com','',''),false);
 assert.equal(allowedOperator('id','a@example.com','','a@example.com'),true);
 assert.equal(sameSecret('',undefined),false);
 process.env.APP_ORIGIN='https://crm.example';
 assert.equal(validOrigin(new Request('https://crm.example',{headers:{origin:'https://evil.example'}})),false);
 assert.equal(validOrigin(new Request('https://crm.example',{headers:{origin:'https://crm.example'}})),true);
});
test('firma sobre bytes originales',()=>{const raw=Buffer.from('{"x":1}'), sig='sha256='+createHmac('sha256','test').update(raw).digest('hex');assert.ok(validMetaSignature(raw,sig,'test'));assert.equal(validMetaSignature(Buffer.from('{"x":2}'),sig,'test'),false);assert.equal(validMetaSignature(raw,null,'test'),false);});
test('rechaza direcciones internas, reservadas y equivalentes IPv6',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);
 await assert.rejects(()=>safeFetch('http://127.0.0.1'));
 await assert.rejects(()=>safeFetch('http://example.com:22'));
 await assert.rejects(()=>safeFetch('file:///etc/passwd'));
});
test('limita bytes del body',async()=>{await assert.rejects(()=>readBody(new Request('https://example.com',{method:'POST',body:'x'.repeat(50)}),20));});
