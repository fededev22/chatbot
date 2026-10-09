import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEngine} from '../core.mjs';
import {createWhatsAppConversations,polishReply} from '../conversation-ai.mjs';
import {createSupabaseMemory} from '../supabase-memory.mjs';
const config=JSON.parse(readFileSync(new URL('../business.json',import.meta.url)));
const clock=()=>new Date('2026-10-08T12:00:00Z');
const phone='5491112345678',session='wa:'+phone,other='wa:5491112345679';
const key='sb_secret_synthetic_memory_test_only',env={SUPABASE_URL:'https://synthetictest.supabase.co',SUPABASE_SECRET_KEY:key,SUPABASE_CLINIC_ID:'test-clinic'};
const settings={current:()=>({enabled:false})};
const message=(id,text)=>({id,type:'text',text:{body:text}});
function book(e,id=session,name='Ana Pérez',time='10:00'){
  e.handle(id,'quiero una limpieza mañana a las '+time,'whatsapp');
  if(e.state(id).step==='name')e.handle(id,name,'whatsapp');
  e.handle(id,'sin recordatorios','whatsapp');e.handle(id,'sí, confirmo','whatsapp');
  assert.equal(e.state(id).step,undefined);
}
function remote(){
  const contacts=new Map(),appointments=new Map(),writes=[];
  const request=async(url,options)=>{
    assert.equal(options.headers.apikey,key);assert.equal(options.headers.Authorization,undefined);
    const u=new URL(url);
    if(options.method==='POST'){
      const data=JSON.parse(options.body);writes.push(data);assert.equal(data.p_clinic_id,env.SUPABASE_CLINIC_ID);
      const c=data.p_contact,old=contacts.get(c.phone);contacts.set(c.phone,{...c,name:c.name||old?.name||null,clinic_id:data.p_clinic_id});
      for(const a of data.p_appointments)appointments.set(a.id,{...a,clinic_id:data.p_clinic_id,updated:c.updated});
      return {ok:true};
    }
    let rows=[...(u.pathname.endsWith('dental_contacts')?contacts:appointments).values()];
    const p=u.searchParams.get('phone')?.slice(3);if(p)rows=rows.filter(r=>r.phone===p);
    return {ok:true,json:async()=>structuredClone(rows)};
  };
  return {request,contacts,appointments,writes};
}

test('Supabase guarda contactos y turnos y los restaura en otro proceso sin subir mensajes ni claves',async()=>{
  const cloud=remote(),e=createEngine(':memory:',()=>config,clock);
  const memory=createSupabaseMemory(e,env,{clock,request:cloud.request});
  let restored;
  try{
    book(e);e.handle(session,'Me duele una muela','whatsapp');await memory.flush();
    assert.equal(cloud.contacts.get(phone).name,'Ana Pérez');assert.equal(cloud.appointments.size,1);
    const sent=JSON.stringify(cloud.writes);for(const privateText of [key,'Me duele','messages','password'])assert.ok(!sent.includes(privateText));
    restored=createEngine(':memory:',()=>config,clock);const second=createSupabaseMemory(restored,env,{clock,request:cloud.request});await second.bootstrap();
    assert.equal(restored.contact(session).name,'Ana Pérez');assert.equal(restored.upcoming(session).length,1);assert.equal(restored.query('SELECT * FROM messages').length,0);
    const chat=createWhatsAppConversations(restored,()=>config,settings,{clock,memory:second});
    chat.receive(message('hello','hola'),session);await chat.drain();await second.flush();
    const reply=restored.query('SELECT text FROM outbox ORDER BY created DESC LIMIT 1')[0].text;
    assert.match(reply,/Ana Pérez/);assert.match(reply,/turno vigente/);assert.ok(!reply.includes('reservar un turno'));assert.match(reply,/modificarlo/);
    chat.receive(message('other','hola'),other);await chat.drain();await second.flush();
    const isolated=restored.query('SELECT text FROM messages WHERE session=? ORDER BY id DESC LIMIT 1',other)[0].text;
    assert.ok(!isolated.includes('Ana Pérez'));assert.ok(!isolated.includes('turno vigente'));
    assert.equal(restored.query('SELECT * FROM appointments').length,1);
    restored.handle(session,'quiero una consulta de ortodoncia mañana a las 12','whatsapp');assert.equal(restored.state(session).step,'consent');assert.equal(restored.state(session).name,'Ana Pérez');
    assert.equal(restored.query('SELECT * FROM appointments').length,1);
    await second.flush();
  }finally{restored?.db.close();e.db.close();}
});

test('la cola de Supabase conserva cambios nuevos durante un envío y reintenta sin filtrar errores privados',async()=>{
  let at=clock(),fail=true,change=false;const e=createEngine(':memory:',()=>config,()=>at),cloud=remote();
  const request=async(url,options)=>{
    if(options.method==='POST'&&fail)throw Error(key+' private provider body');
    if(options.method==='POST'&&change){change=false;e.remember(session,{name:'Ana Actualizada'});}
    return cloud.request(url,options);
  };
  try{
    const memory=createSupabaseMemory(e,env,{clock:()=>at,request});e.remember(session,{name:'Ana Pérez'});await memory.flush();
    assert.equal(memory.status().pending,1);assert.equal(memory.status().error,'supabase_unavailable');assert.ok(!JSON.stringify(e.query('SELECT * FROM cloud_memory_jobs')).includes(key));
    fail=false;change=true;at=new Date(at.getTime()+10000);await memory.flush();assert.equal(memory.status().pending,1);
    await memory.flush();assert.equal(memory.status().pending,0);assert.equal(cloud.contacts.get(phone).name,'Ana Actualizada');
    book(e);await memory.flush();const a=e.query('SELECT id FROM appointments')[0];e.run("UPDATE appointments SET status='cancelled' WHERE id=?",a.id);e.remember(session);await memory.flush();
    assert.equal(cloud.appointments.get(a.id).status,'cancelled');
  }finally{e.db.close();}
});

test('Supabase rechaza importaciones de otra clínica y no cambia la memoria local',async()=>{
  const e=createEngine(':memory:',()=>config,clock),cloud=remote();
  cloud.contacts.set(phone,{phone,clinic_id:'another-clinic',name:'Nombre Ajeno',first_seen:clock().toISOString(),last_seen:clock().toISOString(),updated:clock().toISOString()});
  try{const memory=createSupabaseMemory(e,env,{clock,request:cloud.request});await assert.rejects(memory.bootstrap(),/supabase_invalid_data/);assert.equal(e.contact(session),null);assert.equal(e.query('SELECT * FROM appointments').length,0);}finally{e.db.close();}
});

test('el selector de horarios incluye toda la disponibilidad real y excluye horarios ocupados',async()=>{
  const e=createEngine(':memory:',()=>config,clock);let calls=0;
  const chat=createWhatsAppConversations(e,()=>config,{current:()=>({enabled:true,provider:'nvidia',model:'test',key})},{clock,mode:'trial',trialRecipients:[phone],request:async()=>{calls++;throw Error('El modelo no debe decidir los horarios.');}});
  try{
    book(e,other,'Usuario Prueba');const available=e.slots('limpieza','2026-10-09').map(s=>s.time);assert.ok(available.length>5);
    chat.receive(message('slots','quiero una limpieza mañana'),session);await chat.drain();
    const reply=e.query('SELECT text FROM outbox')[0].text;assert.equal(calls,0);for(const time of available)assert.ok(reply.includes(time),time);
    assert.ok(!reply.includes('10:00'));assert.match(reply,/hora de Argentina/);assert.match(reply,/¿Cuál preferís\?/);
  }finally{e.db.close();}
});

test('la redacción conserva preguntas reales y convierte afirmaciones mal puntuadas en oraciones',()=>{
  assert.equal(polishReply('¡Hola! ¿Para organizar el turno necesito tu nombre y apellido?'),'Hola. Para organizar el turno necesito tu nombre y apellido.');
  assert.equal(polishReply('¿Podés indicarme tu nombre y apellido?'),'¿Podés indicarme tu nombre y apellido?');
  assert.equal(polishReply('¿Querés conocé los servicios?'),'¿Querés conocer los servicios?');
});

test('el modelo recibe solo el indicador de turno vigente y no su identidad ni sus registros',async()=>{
  const e=createEngine(':memory:',()=>config,clock);let body;
  const chat=createWhatsAppConversations(e,()=>config,{current:()=>({enabled:true,provider:'nvidia',model:'test',key})},{clock,mode:'trial',trialRecipients:[phone],request:async(url,request)=>{body=JSON.parse(request.body);return {ok:true,json:async()=>({choices:[{message:{content:'La limpieza dura 45 minutos. ¿Querés consultar tu turno existente?'}}]})};}});
  try{book(e);chat.receive(message('faq','¿Cuánto dura una limpieza?'),session);await chat.drain();const payload=JSON.stringify(body);assert.ok(payload.includes('hasUpcomingAppointment'));assert.ok(payload.includes('true'));for(const value of [phone,'Ana Pérez',e.query('SELECT id FROM appointments')[0].id])assert.ok(!payload.includes(value));}finally{e.db.close();}
});

test('el servidor corrige invitaciones de la IA a reservar otro turno si ya existe uno vigente',async()=>{
  for(const modelReply of ['La limpieza dura 45 minutos. ¿Querés reservar un turno?','Podemos organizar una cita para vos.','La limpieza dura 45 minutos.']){
    const e=createEngine(':memory:',()=>config,clock);
    const chat=createWhatsAppConversations(e,()=>config,{current:()=>({enabled:true,provider:'nvidia',model:'test',key})},{clock,mode:'trial',trialRecipients:[phone],request:async()=>({ok:true,json:async()=>({choices:[{message:{content:modelReply}}]})})});
    try{book(e);chat.receive(message('cta','¿Cuánto dura una limpieza?'),session);await chat.drain();const reply=e.query('SELECT text FROM outbox')[0].text;assert.match(reply,/turno existente/);assert.ok(!/reservar|organizar una cita/.test(reply));assert.equal(e.query('SELECT count(*) AS n FROM appointments')[0].n,1);}finally{e.db.close();}
  }
});

test('la memoria sigue reconociendo el turno al día siguiente y excluye citas pasadas o canceladas',async()=>{
  let at=clock();const e=createEngine(':memory:',()=>config,()=>at),chat=createWhatsAppConversations(e,()=>config,settings,{clock:()=>at});
  try{
    book(e);at=new Date('2026-10-09T12:00:00Z');chat.receive(message('next-day','hola'),session);await chat.drain();
    assert.match(e.query("SELECT text FROM messages WHERE role='bot' ORDER BY id DESC LIMIT 1")[0].text,/Hola, Ana Pérez.+turno vigente/s);
    e.run("UPDATE appointments SET status='cancelled'");assert.equal(e.upcoming(session).length,0);
    e.run("UPDATE appointments SET status='confirmed'");at=new Date('2026-10-10T12:00:00Z');assert.equal(e.upcoming(session).length,0);assert.equal(e.contact(session).name,'Ana Pérez');
  }finally{e.db.close();}
});
