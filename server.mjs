import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,renameSync,statSync} from 'node:fs';
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createEngine,validateConfig} from './core.mjs';
import {createRecipientResolver} from './whatsapp.mjs';
import {dashboardData,conversationData,markRead,humanAction,recordDelivery,acceptedDelivery} from './reception.mjs';
import {checkWhatsAppConnection} from './connection.mjs';
import {DatabaseSync} from 'node:sqlite';
import {createAuth,authError} from './auth.mjs';
import {createAISettings} from './ai.mjs';
import {createWhatsAppConversations} from './conversation-ai.mjs';
import {createSupabaseMemory} from './supabase-memory.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
mkdirSync(`${root}data`,{recursive:true});
let config=validateConfig(JSON.parse(readFileSync(`${root}business.json`,'utf8')));
let configUpdatedAt=statSync(`${root}business.json`).mtime.toISOString();
const engine=createEngine(`${root}data/clinic.sqlite`,()=>config);
const env=process.env, host=env.HOST||'127.0.0.1', port=Number(env.PORT||3000);
const aiSettings=createAISettings(`${root}data/ai.json`);
const memory=createSupabaseMemory(engine,env);
await memory.bootstrap();
const conversations=createWhatsAppConversations(engine,()=>config,aiSettings,{mode:env.AI_WHATSAPP_MODE||'off',trialRecipients:(env.AI_TEST_RECIPIENTS||'').split(',').map(s=>s.trim()).filter(Boolean),memory});
const localHost=['127.0.0.1','localhost','::1'].includes(host);
if(!localHost&&(!env.PANEL_ORIGIN?.startsWith('https://')||!env.ADMIN_TOKEN))throw Error('El panel remoto requiere PANEL_ORIGIN HTTPS y clave privada de instalación.');
const authDb=new DatabaseSync(`${root}data/accounts.sqlite`),auth=createAuth(authDb);
const panelOrigin=env.PANEL_ORIGIN||`http://127.0.0.1:${port}`,secureCookie=new URL(panelOrigin).protocol==='https:';
const cookieName=secureCookie?'__Host-dental_session':'dental_session';
const waEnabled=!!(env.WHATSAPP_TOKEN&&env.WHATSAPP_PHONE_ID&&env.META_APP_SECRET&&env.WEBHOOK_VERIFY_TOKEN);
let connection={state:waEnabled?'checking':'unconfigured',note:waEnabled?'Comprobando WhatsApp…':'WhatsApp todavía no está configurado.'};
let checkingConnection=false;
async function refreshConnection(){if(checkingConnection)return;checkingConnection=true;try{connection=await checkWhatsAppConnection(env);}finally{checkingConnection=false;}}
void refreshConnection();setInterval(()=>void refreshConnection(),90000).unref();
const recipient=createRecipientResolver(env.WHATSAPP_RECIPIENT_OVERRIDES);
function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);}
function installation(req){return auth.count()===0&&!!env.ADMIN_TOKEN&&equal(req.headers.authorization,`Bearer ${env.ADMIN_TOKEN}`);}
function sessionToken(req){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1)||'';}
function sessionCookie(res,token){res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; ${secureCookie?'Secure; ':''}Max-Age=${token?43200:0}`);}
function sameOrigin(req){const allowed=env.PANEL_ORIGIN?[new URL(panelOrigin).host]:[`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`];if(!allowed.includes(req.headers.host))throw authError('Origen del panel inválido.',403);if(req.method!=='GET'&&req.method!=='HEAD'){const origin=secureCookie?panelOrigin:`http://${req.headers.host}`;if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')throw authError('Solicitud de otro sitio bloqueada.',403);}}
async function body(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>65536)throw authError('Solicitud demasiado grande.',413);chunks.push(c);}return Buffer.concat(chunks);}
function parseJSON(raw){try{return JSON.parse(raw);}catch{throw authError('Solicitud JSON inválida.');}}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const limits=new Map();
const captchaImages=new Map();
function rate(key){const now=Date.now();let r=limits.get(key);if(!r||now-r.at>60000) r={at:now,n:0};r.n++;limits.set(key,r);return r.n<=60;}
setInterval(()=>{for(const [key,value] of limits)if(Date.now()-value.at>60000)limits.delete(key);for(const [key,value] of captchaImages)if(Date.now()>value.expires)captchaImages.delete(key);auth.clean();},60000).unref();
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/webhook') {
      if(!env.WEBHOOK_VERIFY_TOKEN||url.searchParams.get('hub.mode')!=='subscribe'||!equal(url.searchParams.get('hub.verify_token'),env.WEBHOOK_VERIFY_TOKEN)) return json(res,403,{error:'Verificación inválida.'});
      res.writeHead(200,{'Content-Type':'text/plain'});return res.end(url.searchParams.get('hub.challenge')||'');
    }
    if(req.method==='POST'&&url.pathname==='/webhook') {
      if(!waEnabled) return json(res,503,{error:'WhatsApp no configurado.'});
      const raw=await body(req),sig=`sha256=${createHmac('sha256',env.META_APP_SECRET).update(raw).digest('hex')}`;
      if(!equal(req.headers['x-hub-signature-256'],sig)) return json(res,401,{error:'Firma inválida.'});
      const event=parseJSON(raw);
      for(const entry of event.entry||[]) for(const change of entry.changes||[]) {
        const value=change.value||{};
        if(value.metadata?.phone_number_id!==env.WHATSAPP_PHONE_ID) continue;
        for(const status of value.statuses||[]) recordDelivery(engine,status);
        for(const message of value.messages||[]) {
          if(typeof message.id!=='string'||!/^\d{10,15}$/.test(message.from)) continue;
          if(engine.db.prepare('SELECT 1 FROM webhooks WHERE id=?').get(message.id)) continue;
          const session=`wa:${message.from}`;
          conversations.receive(message,session);
        }
      }
      void conversations.drain().then(()=>void flush());
      return json(res,200,{ok:true});
    }
    if(!rate(req.socket.remoteAddress)) return json(res,429,{error:'Demasiadas solicitudes. Esperá un minuto.'});
    sameOrigin(req);
    const ip=req.socket.remoteAddress,sessionKey=sessionToken(req),access=auth.current(sessionKey);
    if(req.method==='GET'&&url.pathname==='/api/auth/status')return json(res,200,{setup:auth.count()===0,user:access?.user||null,csrf:access?.csrf||null});
    if(req.method==='GET'&&url.pathname==='/api/auth/captcha'){const challenge=auth.captcha(ip);captchaImages.set(challenge.id,{svg:challenge.svg,ip,expires:Date.now()+300000});return json(res,200,{id:challenge.id,image:`/api/auth/captcha-image?id=${challenge.id}`});}
    if(req.method==='GET'&&url.pathname==='/api/auth/captcha-image'){
      const challenge=captchaImages.get(url.searchParams.get('id'));if(!challenge||challenge.ip!==ip||challenge.expires<Date.now())return json(res,404,{error:'Código vencido.'});res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});return res.end(challenge.svg);
    }
    if(req.method==='GET'&&url.pathname==='/api/auth/invitation')return json(res,200,auth.invitation(url.searchParams.get('token')));
    if(req.method==='POST'&&['/api/auth/login','/api/auth/setup','/api/auth/accept'].includes(url.pathname)){
      if(url.pathname==='/api/auth/setup'&&!installation(req))throw authError('Usá la clave privada de instalación para crear la primera cuenta.',403);
      const data=parseJSON(await body(req)),result=await auth[url.pathname.split('/').at(-1)](data,ip);sessionCookie(res,result.token);return json(res,200,{user:result.user,csrf:result.csrf});
    }
    if(url.pathname.startsWith('/api/')){if(!access)return json(res,401,{error:'Ingresá con tu cuenta. La sesión pudo haber vencido o haberse abierto en otro dispositivo.'});if(req.method!=='GET'&&!equal(req.headers['x-csrf-token'],access.csrf))throw authError('La sesión cambió. Recargá el panel.',403);}
    if(req.method==='POST'&&url.pathname==='/api/auth/logout'){auth.logout(sessionKey);sessionCookie(res,'');return json(res,200,{ok:true});}
    if(req.method==='POST'&&url.pathname==='/api/auth/activity'){auth.activity(sessionKey);return json(res,200,{ok:true});}
    if(req.method==='GET'&&url.pathname==='/api/accounts')return json(res,200,auth.list(access.user));
    if(req.method==='POST'&&url.pathname==='/api/accounts/invite')return json(res,200,auth.invite(access.user,parseJSON(await body(req))));
    if(req.method==='POST'&&url.pathname==='/api/accounts/cancel'){auth.revokeInvite(access.user,parseJSON(await body(req)).email);return json(res,200,{ok:true});}
    if(req.method==='POST'&&url.pathname==='/api/accounts/status'){const data=parseJSON(await body(req));auth.status(access.user,data.id,data.disabled);return json(res,200,{ok:true});}
    if(req.method==='GET'&&url.pathname==='/api/dashboard') {
      return json(res,200,{...dashboardData(engine,config),configUpdatedAt,whatsapp:waEnabled,connection,reminders:!!env.REMINDER_TEMPLATE});
    }
    if(req.method==='GET'&&url.pathname==='/api/conversation') {
      return json(res,200,conversationData(engine,url.searchParams.get('session'),url.searchParams.has('before')?Number(url.searchParams.get('before')):undefined));
    }
    if(req.method==='POST'&&url.pathname==='/api/read') {
      const data=parseJSON(await body(req));markRead(engine,data.session,data.messageId);
      return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/config') {
      const next=validateConfig(parseJSON(await body(req)));
      const upcoming=engine.query("SELECT * FROM appointments WHERE status='confirmed' AND start>?",new Date().toISOString());
      if(upcoming.some(a=>!next.professionals.includes(a.professional)||!next.services.some(s=>s.id===a.service))) throw Error('No podés eliminar profesionales o servicios con turnos próximos.');
      const drafts=engine.query("SELECT state FROM sessions WHERE json_extract(state,'$.step') IS NOT NULL").map(s=>JSON.parse(s.state));
      if(drafts.some(s=>s.service&&!next.services.some(service=>service.id===s.service))) throw Error('Hay una conversación reservando un servicio que intentás quitar. Conservá ese servicio hasta que termine la reserva.');
      writeFileSync(`${root}business.json.tmp`,JSON.stringify(next,null,2));renameSync(`${root}business.json.tmp`,`${root}business.json`);config=next;configUpdatedAt=statSync(`${root}business.json`).mtime.toISOString();return json(res,200,{ok:true,config,updatedAt:configUpdatedAt});
    }
    if(req.method==='POST'&&url.pathname==='/api/human') {
      const data=parseJSON(await body(req));
      if(!['pause','resume'].includes(data.action))throw authError('El panel permite seguir las conversaciones y pausar o reactivar el bot; no envía mensajes.',403);
      humanAction(engine,data,waEnabled);
      return json(res,200,{ok:true});
    }
    const files={'/':'index.html','/app.js':'app.js','/accounts.js':'accounts.js','/settings.js':'settings.js','/bot-info.js':'../bot-info.mjs','/style.css':'style.css','/favicon.svg':'favicon.svg'};
    if(req.method==='GET'&&files[url.pathname]){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'text/javascript':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(readFileSync(`${root}public/${files[url.pathname]}`));}
    json(res,404,{error:'Ruta no encontrada.'});
  } catch(e){if(!e.status)console.error('Solicitud fallida:',e.message);json(res,e.status||400,{error:e.message});}
});
let flushing=false;
async function flush(){
  if(flushing||!waEnabled)return;flushing=true;
  try {for(const item of engine.query("SELECT * FROM outbox WHERE status='pending' AND next_try<=? ORDER BY created LIMIT 20",Date.now())){
    try {
      const textAllowed=engine.db.prepare("SELECT at FROM messages WHERE session=? AND role='user' ORDER BY id DESC LIMIT 1").get(item.session);
      if(!item.template&&(!textAllowed||Date.now()-new Date(textAllowed.at)>24*3600000)){engine.run("UPDATE outbox SET status='blocked_window' WHERE id=?",item.id);continue;}
      if(item.template&&!env.REMINDER_TEMPLATE){engine.run("UPDATE outbox SET status='blocked_template' WHERE id=?",item.id);continue;}
      // No enviar recordatorios encolados de turnos que ya se modificaron/cancelaron.
      if(item.template&&!engine.db.prepare("SELECT 1 FROM appointments WHERE id=? AND session=? AND status='confirmed' AND consent=1 AND start>?").get(item.appointment,item.session,new Date().toISOString())){engine.run("UPDATE outbox SET status='obsolete' WHERE id=?",item.id);continue;}
      const payload={messaging_product:'whatsapp',to:recipient(item.session.slice(3)),type:item.template?'template':'text',...(item.template?{template:{name:env.REMINDER_TEMPLATE,language:{code:env.REMINDER_LANGUAGE||'es_AR'},components:[{type:'body',parameters:JSON.parse(item.params).map(text=>({type:'text',text}))}]}}:{text:{body:item.text}})};
      const response=await fetch(`https://graph.facebook.com/${env.GRAPH_VERSION||'v25.0'}/${env.WHATSAPP_PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
      if(!response.ok){const detail=await response.json().catch(()=>({}));throw Error(`Meta HTTP ${response.status}, código ${detail.error?.code||'desconocido'}`);}
      const result=await response.json();
      acceptedDelivery(engine,item.id,result.messages?.[0]?.id);
    }catch(e){const attempts=item.attempts+1;engine.run('UPDATE outbox SET status=?,attempts=?,next_try=?,last_error=? WHERE id=?',attempts>=5?'failed':'pending',attempts,Date.now()+Math.min(3600000,30000*2**attempts),e.message,item.id);console.error('Envío WhatsApp:',e.message);}
  }}finally{flushing=false;}
}
setInterval(()=>{try{engine.remind();}catch(e){console.error('Recordatorios:',e.message);}void flush();},15000).unref();
setInterval(()=>void conversations.drain().then(()=>void flush()),2000).unref();
setInterval(()=>void memory.flush(),15000).unref();
void conversations.drain().then(()=>void flush());
server.listen(port,host,()=>console.log(`Clínica dental: http://${host}:${port} · WhatsApp ${waEnabled?'configurado':'demo local'}`));
process.on('SIGTERM',()=>server.close(()=>{engine.db.close();authDb.close();process.exit(0);}));
