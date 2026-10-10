import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,cpSync,rmSync,existsSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const root=fileURLToPath(new URL('../',import.meta.url));
test('HTTP público: firma Meta, validación atómica, tamaño, tipos JSON y archivos privados',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'dental-security-test-')),socket=createServer();
  await new Promise((ok,bad)=>socket.once('error',bad).listen(0,'127.0.0.1',ok));const port=socket.address().port;await new Promise(ok=>socket.close(ok));
  for(const file of ['server.mjs','auth.mjs','security.mjs','core.mjs','language.mjs','ai.mjs','conversation-ai.mjs','supabase-memory.mjs','reception.mjs','connection.mjs','whatsapp.mjs','bot-info.mjs','business.json'])copyFileSync(join(root,file),join(directory,file));
  cpSync(join(root,'public'),join(directory,'public'),{recursive:true});
  const base=`http://127.0.0.1:${port}`,appSecret='synthetic-signature-secret';
  const child=spawn(process.execPath,[join(directory,'server.mjs')],{cwd:directory,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PANEL_ORIGIN:'',ADMIN_TOKEN:'synthetic-installation',WHATSAPP_TOKEN:'synthetic-not-a-token',WHATSAPP_PHONE_ID:'test-phone',META_APP_SECRET:appSecret,WEBHOOK_VERIFY_TOKEN:'synthetic-verification',SUPABASE_URL:'',SUPABASE_SECRET_KEY:''},stdio:['ignore','pipe','pipe']});
  const exit=new Promise(ok=>child.once('exit',ok));
  const post=(path,raw,headers={})=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:raw,signal:AbortSignal.timeout(5000)});
  const signed=raw=>post('/webhook',raw,{'X-Hub-Signature-256':'sha256='+createHmac('sha256',appSecret).update(raw).digest('hex')});
  try{
    await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('Servidor no inició.')),10000);child.once('error',bad);child.stdout.on('data',chunk=>{if(chunk.toString().includes('Clínica dental:')){clearTimeout(timer);ok();}});child.once('exit',code=>{clearTimeout(timer);bad(Error('Servidor terminó: '+code));});});
    assert.equal((await post('/webhook','{}')).status,401);
    assert.equal((await post('/webhook','{}',{'X-Hub-Signature-256':'sha256='+'0'.repeat(64)})).status,401);
    assert.equal((await signed('{"entry":[]}')).status,200);
    assert.equal((await signed('null')).status,400);
    assert.equal((await signed('{"entry":{}}')).status,400);
    const malformed={entry:[{changes:[{value:{metadata:{phone_number_id:'test-phone'},messages:[{id:'should-never-be-stored',from:'5491112345678',type:'text',text:{body:'hola'}},{id:'invalid',from:'5491112345678',type:'text',text:{body:{}}}]}}]}]};
    assert.equal((await signed(JSON.stringify(malformed))).status,400);
    const db=new DatabaseSync(join(directory,'data/clinic.sqlite'));try{assert.equal(db.prepare('SELECT count(*) n FROM messages').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM webhooks').get().n,0);}finally{db.close();}
    assert.equal((await post('/api/auth/login','x'.repeat(65537))).status,413);
    assert.equal((await post('/api/auth/login','{}',{'Content-Type':'text/plain'})).status,415);
    for(const raw of ['null','[]','"privado"']){const response=await post('/api/auth/login',raw);assert.equal(response.status,400);assert.ok(!(await response.text()).includes('TypeError'));}
    for(const path of ['/.env','/data/accounts.sqlite','/data/clinic.sqlite','/data/ai.json','/business.json','/server.mjs'])assert.equal((await fetch(base+path)).status,404);
    assert.ok(!existsSync(join(directory,'data/ai.json')));
    assert.equal((await fetch(base+'/api/dashboard')).status,401);
  }finally{child.kill();await exit;const absolute=resolve(directory);assert.equal(dirname(absolute),resolve(tmpdir()));assert.ok(basename(absolute).startsWith('dental-security-test-'));rmSync(absolute,{recursive:true,force:true});}
});
