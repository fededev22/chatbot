import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEngine} from '../core.mjs';
import {createWhatsAppConversations} from '../conversation-ai.mjs';
import {humanAction} from '../reception.mjs';
const config=JSON.parse(readFileSync(new URL('../business.json',import.meta.url)));
const phone='5491112345678',session=`wa:${phone}`,key='synthetic-test-key-never-a-real-credential';
const clock=()=>new Date('2026-10-08T12:00:00Z');
const settings={current:()=>({provider:'nvidia',model:'test/model',key,enabled:true})};
const response=reply=>({ok:true,json:async()=>({choices:[{message:{content:reply}}]})});
function fixture(request,options={}) {
  const e=createEngine(':memory:',()=>config,clock);
  return {e,chat:createWhatsAppConversations(e,()=>config,settings,{mode:'trial',trialRecipients:[phone],clock,request,...options})};
}
const message=(id,text)=>({id,type:'text',text:{body:text}});

test('saludo de WhatsApp ofrece servicios y reservas aun sin IA, usando la información editable vigente',async()=>{
  let current={...config,name:'Clínica de prueba',bot:{...config.bot,welcome:'¡Hola! Te damos la bienvenida a {nombre_clinica}.'}};
  const e=createEngine(':memory:',()=>current,clock);
  const chat=createWhatsAppConversations(e,()=>current,settings,{mode:'off',clock,request:async()=>{throw Error('No debe llamar al proveedor.');}});
  const send=async(id)=>{chat.receive(message(id,'hola'),session);await chat.drain();return e.query("SELECT text FROM messages WHERE role='bot' ORDER BY id DESC LIMIT 1")[0].text;};
  try{
    let reply=await send('one');assert.match(reply,/Clínica de prueba/);assert.match(reply,/reservar un turno, conocer nuestros servicios o consultar sobre la clínica/);assert.equal((reply.match(/\?/g)||[]).length,1);
    current={...current,name:'Clínica actualizada',bot:{...current.bot,welcome:'Bienvenido a {nombre_clinica}. ¿Te ayudamos a organizar tu visita?'}};
    reply=await send('two');assert.equal(reply,'Bienvenido a Clínica actualizada. ¿Querés reservar un turno, conocer nuestros servicios o consultar sobre la clínica?');
    e.save(session,{step:'name',service:'limpieza',day:'2026-10-09',time:'10:00'});
    reply=await send('three');assert.match(reply,/nombre y apellido/);assert.ok(!reply.includes('conocer nuestros servicios'));
  }finally{e.db.close();}
});

test('saludo fijo no consulta IA y la migración excluye el contexto general anterior sin borrar el historial',async()=>{
  const e=createEngine(':memory:',()=>config,clock),bodies=[];
  e.db.exec('CREATE TABLE ai_context(user_id INTEGER PRIMARY KEY,session TEXT NOT NULL,question TEXT NOT NULL,reply TEXT NOT NULL)');
  e.run('INSERT INTO messages(session,role,text,at) VALUES(?,?,?,?)',session,'user','Quiero charlar de mi día.',clock().toISOString());
  e.run('INSERT INTO messages(session,role,text,at) VALUES(?,?,?,?)',session,'bot','¿Tenés ganas de charlar un poco?',clock().toISOString());
  e.run('INSERT INTO ai_context VALUES(?,?,?,?)',1,session,'Quiero charlar de mi día.','¿Tenés ganas de charlar un poco?');
  const chat=createWhatsAppConversations(e,()=>config,settings,{mode:'trial',trialRecipients:[phone],clock,request:async(url,request)=>{bodies.push(JSON.parse(request.body));return response('Ofrecemos limpieza dental. ¿Querés buscar un turno?');}});
  try{
    chat.receive(message('hello','hola'),session);await chat.drain();assert.equal(bodies.length,0);
    assert.match(e.query('SELECT text FROM outbox')[0].text,/reservar un turno, conocer nuestros servicios o consultar sobre la clínica/);
    assert.ok(e.query('PRAGMA table_info(ai_context)').some(c=>c.name==='policy'));
    chat.receive(message('services','¿Qué servicios ofrecen?'),session);await chat.drain();
    assert.equal(bodies[0].messages.length,2);assert.ok(!JSON.stringify(bodies).includes('ganas de charlar'));
    assert.equal(e.query('SELECT text FROM messages WHERE id=2')[0].text,'¿Tenés ganas de charlar un poco?');
    chat.receive(message('follow-up','¿Cuánto cuesta una limpieza?'),session);await chat.drain();
    assert.equal(bodies[1].messages.length,4);assert.equal(bodies[1].messages[1].content,'¿Qué servicios ofrecen?');
    assert.ok(!JSON.stringify(bodies[1]).includes('ganas de charlar'));
  }finally{e.db.close();}
});

test('WhatsApp usa IA para conversar, conserva contexto y no envía comandos ni duplica webhooks',async()=>{
  const bodies=[];const {e,chat}=fixture(async(url,request)=>{assert.equal(url,'https://integrate.api.nvidia.com/v1/chat/completions');bodies.push(JSON.parse(request.body));return response(bodies.length===1?'Ofrecemos limpieza dental. ¿Querés buscar un turno?':'Podemos ayudarte con un turno para limpieza dental.');});
  try{
    assert.equal(chat.receive(message('one','¿Qué servicios ofrecen?'),session),true);
    assert.equal(chat.receive(message('one','¿Qué servicios ofrecen?'),session),false);
    assert.equal(e.query('SELECT * FROM messages').length,1);
    await chat.drain();chat.receive(message('two','bien, gracias'),session);await chat.drain();
    assert.equal(bodies.length,2);assert.equal(bodies[1].messages[1].content,'¿Qué servicios ofrecen?');assert.equal(bodies[1].messages[2].content,'Ofrecemos limpieza dental. ¿Querés buscar un turno?');
    assert.equal(e.query("SELECT * FROM conversation_jobs WHERE status='done' AND ai_used=1").length,2);
    const sends=e.query('SELECT text,status FROM outbox ORDER BY created');assert.equal(sends.length,2);assert.ok(sends.every(s=>s.status==='pending'&&!/agendar|humano:|confirmar:/.test(s.text)));
    assert.equal(e.query('SELECT * FROM messages').length,4);
  }finally{e.db.close();}
});

test('inferencia no mantiene bloqueada SQLite y una pausa cancela la respuesta en preparación',async()=>{
  let finish,started;const start=new Promise(ok=>{started=ok;});const wait=new Promise(ok=>{finish=ok;});
  const {e,chat}=fixture(async()=>{started();await wait;return response('Hola desde la IA.');});
  try{
    chat.receive(message('one','¿Qué servicios ofrecen?'),session);const draining=chat.drain();await start;
    assert.equal(e.db.isTransaction,false);assert.equal(e.query('SELECT status FROM outbox')[0].status,'generating');
    humanAction(e,{session,action:'pause'},true,clock());finish();await draining;
    assert.equal(e.query('SELECT status FROM outbox')[0].status,'cancelled');assert.equal(e.query('SELECT status FROM conversation_jobs')[0].status,'cancelled');
    chat.receive(message('two','hola de nuevo'),session);await chat.drain();assert.equal(e.query('SELECT * FROM conversation_jobs').length,1);
  }finally{finish();e.db.close();}
});

test('mensajes consecutivos se procesan en orden aunque lleguen mientras la IA responde',async()=>{
  let finish,started,calls=0;const start=new Promise(ok=>{started=ok;});const wait=new Promise(ok=>{finish=ok;});
  const {e,chat}=fixture(async(url,request)=>{calls++;if(calls===1){started();await wait;}else assert.ok(JSON.parse(request.body).messages.some(m=>m.content==='Respuesta primera.'));return response(calls===1?'Respuesta primera.':'Respuesta segunda.');});
  try{
    chat.receive(message('one','¿Qué servicios ofrecen?'),session);const draining=chat.drain();await start;chat.receive(message('two','cómo va todo'),session);
    assert.equal(chat.drain(),draining);finish();await draining;await chat.drain();
    assert.deepEqual(e.query("SELECT text FROM messages WHERE role='bot' ORDER BY id").map(m=>m.text),['Respuesta primera.','Respuesta segunda.']);
  }finally{finish();e.db.close();}
});

test('identidad y confirmación de reservas quedan locales; no se reserva por una respuesta inventada de IA',async()=>{
  let calls=0;const bodies=[];const {e,chat}=fixture(async(url,request)=>{calls++;bodies.push(request.body);return response('¿Cuál es tu nombre y apellido?');});
  let id=0;async function send(text){chat.receive(message(String(++id),text),session);await chat.drain();}
  try{
    await send('quiero una limpieza mañana a las 10');assert.equal(calls,1);assert.equal(e.query('SELECT * FROM appointments').length,0);
    await send('Ana Pérez');await send('sí');assert.equal(calls,1);await send('sí, confirmo');
    assert.equal(e.query('SELECT * FROM appointments').length,1);assert.equal(calls,1);assert.ok(bodies.every(b=>!b.includes('Ana Pérez')&&!b.includes(phone)));
    assert.ok(!e.query('SELECT text FROM outbox').some(m=>/Escribí cancelar|confirmar:|agendar:/.test(m.text)));
  }finally{e.db.close();}
});

test('contexto de la IA omite nombre, correo, teléfono, códigos y registros de turnos',async()=>{
  let body;const {e,chat}=fixture(async(url,request)=>{body=request.body;return response('La información de precios debe confirmarla recepción.');});
  try{
    e.save(session,{name:'Ana Pérez'});chat.receive(message('one','¿Cuánto cuesta una limpieza? Soy Ana Pérez, ana@example.test, +5491112345678.'),session);await chat.drain();
    assert.ok(body);for(const value of ['Ana Pérez','ana@example.test',phone,session])assert.ok(!body.includes(value));
    assert.ok(body.includes('Limpieza dental'));
  }finally{e.db.close();}
});

test('consultas clínicas se derivan localmente, sin transmitir su contenido a IA',async()=>{
  let calls=0;const {e,chat}=fixture(async()=>{calls++;return response('Respuesta que no debe usarse.');});
  try{
    chat.receive(message('one','Me duele una muela'),session);await chat.drain();assert.equal(calls,0);assert.equal(e.state(session).paused,true);
    assert.ok(!JSON.stringify(e.query('SELECT * FROM conversation_jobs')).includes('Me duele'));assert.ok(!e.query('SELECT text FROM messages').some(m=>m.text.includes('Me duele')));
    assert.equal(e.query('SELECT status FROM outbox')[0].status,'pending');assert.match(e.query('SELECT text FROM outbox')[0].text,/recepción/);
  }finally{e.db.close();}
});

test('NVIDIA de prueba solo recibe conversaciones autorizadas y nunca se activa en producción',async()=>{
  for(const options of [{trialRecipients:[]},{mode:'off'},{mode:'production'}]){
    let calls=0;const {e,chat}=fixture(async()=>{calls++;return response('Respuesta.');},options);
    try{chat.receive(message('one','¿Qué servicios ofrecen?'),session);await chat.drain();assert.equal(calls,0);assert.ok(!e.query('SELECT text FROM outbox')[0].text.includes('agendar:'));}finally{e.db.close();}
  }
});

test('fallos de proveedor y respuestas inventadas usan alternativa natural sin exponer claves',async()=>{
  for(const request of [async()=>({ok:false,status:401}),async()=>response(key),async()=>response('¡Turno confirmado!'),async()=>response('Escribí agendar para reservar.'),async()=>{throw Error(key);}]){
    const {e,chat}=fixture(request);
    try{chat.receive(message('one','¿Qué servicios ofrecen?'),session);await chat.drain();const jobs=e.query('SELECT * FROM conversation_jobs'),sends=e.query('SELECT * FROM outbox');assert.equal(jobs[0].ai_used,0);assert.ok(jobs[0].error);assert.ok(!JSON.stringify(jobs).includes(key));assert.ok(!JSON.stringify(sends).includes(key));assert.equal(sends[0].status,'pending');assert.ok(!sends[0].text.includes('agendar:'));assert.equal(e.query('SELECT * FROM appointments').length,0);}finally{e.db.close();}
  }
});

test('recupera un trabajo preparado sin repetir una operación ya aplicada ni duplicar la salida',async()=>{
  let calls=0;const {e,chat}=fixture(async()=>{calls++;return response('Respuesta.');});
  try{
    chat.receive(message('one','sí, confirmo'),session);
    e.save(session,{step:'confirm',service:'limpieza',day:'2026-10-09',time:'10:00',name:'Ana Pérez',phone,consent:false});
    const before=e.state(session),answer=e.handle(session,'sí, confirmo','whatsapp',{recordUser:false});
    const messageId=e.query("SELECT id FROM messages WHERE role='bot' ORDER BY id DESC LIMIT 1")[0].id;
    const outboxId=e.queue(session,answer.reply,false,[],null,{messageId});e.run("UPDATE outbox SET status='generating' WHERE id=?",outboxId);
    e.run("UPDATE conversation_jobs SET status='working',result=?,message_id=?,outbox_id=? WHERE id='one'",JSON.stringify({answer,before,input:'sí, confirmo'}),messageId,outboxId);
    const recovered=createWhatsAppConversations(e,()=>config,settings,{mode:'trial',trialRecipients:[phone],clock,request:async()=>{calls++;return response('Respuesta.');}});
    await recovered.drain();await recovered.drain();assert.equal(calls,0);assert.equal(e.query('SELECT * FROM appointments').length,1);assert.equal(e.query('SELECT * FROM outbox').length,1);assert.equal(e.query('SELECT status FROM outbox')[0].status,'pending');assert.equal(e.query('SELECT status FROM conversation_jobs')[0].status,'done');
  }finally{e.db.close();}
});
