import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,cpSync,rmSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const secure of [false,true])test(`HTTP ${secure?'con proxy HTTPS':'local'}: instalación, cookies, CSRF, permisos y sesión única`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),'dental-auth-test-'));
  const socket=createServer();await new Promise((ok,bad)=>socket.once('error',bad).listen(0,'127.0.0.1',ok));const port=socket.address().port;await new Promise(ok=>socket.close(ok));
  for(const file of ['server.mjs','auth.mjs','core.mjs','reception.mjs','connection.mjs','whatsapp.mjs','bot-info.mjs','business.json'])copyFileSync(join(root,file),join(directory,file));
  cpSync(join(root,'public'),join(directory,'public'),{recursive:true});
  const origin=`${secure?'https':'http'}://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[join(directory,'server.mjs')],{cwd:directory,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PANEL_ORIGIN:secure?origin:'',ADMIN_TOKEN:'installation-test-only',WHATSAPP_TOKEN:'',WHATSAPP_PHONE_ID:'',META_APP_SECRET:'',WEBHOOK_VERIFY_TOKEN:''},stdio:['ignore','pipe','pipe']});
  const exit=new Promise(ok=>child.once('exit',ok));let cookie='',csrf='';const base=`http://127.0.0.1:${port}`,password='Una frase de acceso para pruebas';
  async function call(path,data,headers={}){return fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(data===undefined?{}:{Origin:origin}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(15000)});}
  async function captcha(){const c=await (await call('/api/auth/captcha')).json(),svg=await (await call(c.image)).text();return {captchaId:c.id,captchaAnswer:[...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(m=>m[1]).join('')};}
  function installSession(response,result){cookie=response.headers.get('set-cookie').split(';')[0];csrf=result.csrf;}
  try{
    await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('Servidor de prueba no inició.')),10000);child.once('error',bad);child.stdout.on('data',chunk=>{if(chunk.toString().includes('Clínica dental:')){clearTimeout(timer);ok();}});child.once('exit',code=>{clearTimeout(timer);bad(Error(`Servidor terminó: ${code}`));});});
    assert.equal((await call('/api/dashboard')).status,401);
    assert.equal((await call('/api/dashboard',undefined,{Authorization:'Bearer installation-test-only'})).status,401);
    const invalidHost=await new Promise((ok,bad)=>{const req=httpRequest(base+'/api/auth/status',{headers:{Host:'evil.test'}},res=>{res.resume();ok(res.statusCode);});req.once('error',bad);req.end();});assert.equal(invalidHost,403);
    assert.equal((await call('/api/auth/setup',{}, {Origin:'https://evil.test'})).status,403);
    assert.equal((await call('/api/auth/setup',{})).status,403);
    const malformed=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"password":"private-test-value'});assert.equal(malformed.status,400);assert.deepEqual(await malformed.json(),{error:'Solicitud JSON inválida.'});
    const fields={email:'owner@example.test',phone:'+5491112345678',password};
    const setup=await call('/api/auth/setup',{...fields,...await captcha()},{Authorization:'Bearer installation-test-only'});assert.equal(setup.status,200);assert.match(setup.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(setup.headers.get('set-cookie').includes('Secure;'),secure);if(secure)assert.ok(setup.headers.get('set-cookie').startsWith('__Host-dental_session='));const owner=await setup.json();installSession(setup,owner);
    assert.equal((await call('/api/dashboard')).status,200);
    assert.equal((await call('/api/config',{}, {'X-CSRF-Token':'incorrect'})).status,403);
    assert.equal((await call('/api/auth/setup',{},{Authorization:'Bearer installation-test-only'})).status,403);
    assert.equal((await call('/api/accounts')).status,200);
    const invite=await (await call('/api/accounts/invite',{email:'staff@example.test',phone:'+5491112345679'})).json();
    const oldCookie=cookie,oldCsrf=csrf;cookie='';csrf='';const accepted=await call('/api/auth/accept',{invite:invite.token,password,...await captcha()});assert.equal(accepted.status,200);installSession(accepted,await accepted.json());assert.equal((await call('/api/accounts')).status,403);assert.equal((await call('/api/accounts/invite',{email:'third@example.test',phone:'+5491112345680'})).status,403);
    const login=await call('/api/auth/login',{...fields,...await captcha()});assert.equal(login.status,200);const newOwner=await login.json();cookie=oldCookie;csrf=oldCsrf;assert.equal((await call('/api/dashboard')).status,401);installSession(login,newOwner);
    assert.equal((await call('/api/auth/activity',{})).status,200);assert.equal((await call('/api/auth/logout',{})).status,200);assert.equal((await call('/api/dashboard')).status,401);
  }finally{child.kill();await exit;const absolute=resolve(directory);assert.equal(dirname(absolute),resolve(tmpdir()));assert.ok(basename(absolute).startsWith('dental-auth-test-'));rmSync(absolute,{recursive:true,force:true});}
});
