import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';

const env = process.env;
for (const key of ['ADMIN_TOKEN','WHATSAPP_TOKEN','WHATSAPP_PHONE_ID','META_APP_SECRET','WEBHOOK_VERIFY_TOKEN']) {
  assert.ok(env[key], `Falta ${key}`);
}
const main = `http://127.0.0.1:${env.PORT || 3000}`;
const gateway = process.argv[2] || `http://127.0.0.1:${env.WEBHOOK_GATEWAY_PORT || 3001}`;
if (process.argv[2]) {
  const publicUrl = new URL(gateway);
  assert.equal(publicUrl.protocol, 'https:');
  assert.equal(publicUrl.username + publicUrl.password + publicUrl.search + publicUrl.hash, '');
}
async function request(url, options = {}) {
  return fetch(url, {...options, signal:AbortSignal.timeout(15000)});
}
assert.equal((await request(main + '/api/dashboard')).status, 401);
for (const path of ['/', '/api/dashboard', '/app.js']) {
  assert.equal((await request(gateway + path)).status, 404);
}
const check = new URL(gateway + '/webhook');
check.searchParams.set('hub.mode', 'subscribe');
check.searchParams.set('hub.verify_token', env.WEBHOOK_VERIFY_TOKEN);
check.searchParams.set('hub.challenge', 'local-check');
const verified = await request(check);
assert.equal(verified.status, 200);
assert.equal(await verified.text(), 'local-check');
check.searchParams.set('hub.verify_token', 'incorrecto');
assert.equal((await request(check)).status, 403);
const body = JSON.stringify({object:'whatsapp_business_account',entry:[]});
const signature = 'sha256=' + createHmac('sha256', env.META_APP_SECRET).update(body).digest('hex');
assert.equal((await request(gateway + '/webhook', {method:'POST',body,headers:{'content-type':'application/json','x-hub-signature-256':'sha256=incorrecta'}})).status, 401);
assert.equal((await request(gateway + '/webhook', {method:'POST',body,headers:{'content-type':'application/json','x-hub-signature-256':signature}})).status, 200);
const status = await request(main + '/api/dashboard', {headers:{authorization:`Bearer ${env.ADMIN_TOKEN}`}});
assert.equal(status.status, 401);
const accountStatus=await request(main+'/api/auth/status');
assert.equal(accountStatus.status,200);
assert.equal(typeof (await accountStatus.json()).setup,'boolean');
console.log(`${process.argv[2] ? 'Conexión HTTPS pública' : 'Conexión local'} verificada: panel protegido, gateway restringido, challenge y firma válidos.`);
