import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEngine,validateConfig} from '../core.mjs';
import {createWhatsAppConversations,polishReply} from '../conversation-ai.mjs';
import {dashboardData} from '../reception.mjs';
import {serviceCatalog,serviceDetails} from '../bot-info.mjs';
const base=JSON.parse(readFileSync(new URL('../business.json',import.meta.url)));
const clock=()=>new Date('2026-10-09T23:40:00Z'),phone='5491112345678',session='wa:'+phone;
const settings={current:()=>({enabled:true,provider:'nvidia',model:'test',key:'synthetic-booking-test-key'})};
function fixture(){
  let config=structuredClone(base),calls=0,id=0;const e=createEngine(':memory:',()=>config,clock);
  const chat=createWhatsAppConversations(e,()=>config,settings,{clock,mode:'trial',trialRecipients:[phone],request:async()=>{calls++;throw Error('La IA no controla las reservas.');}});
  return {e,chat,setConfig:c=>config=c,calls:()=>calls,send:async text=>{chat.receive({id:'flow-'+(++id),type:'text',text:{body:text}},session);await chat.drain();return e.query("SELECT text FROM messages WHERE role='bot' ORDER BY id DESC LIMIT 1")[0].text;}};
}
test('la conversación reportada sale de una reprogramación vacía y exige CONFIRMAR antes de guardar en la agenda',async()=>{
  const {e,send,calls}=fixture();
  try{
    e.save(session,{step:'reschedule_id'});
    assert.match(await send('quiero reserva un turno'),/servicios/);
    assert.equal(e.state(session).step,'service');
    await send('no sé, limpieza dental');assert.equal(e.state(session).step,'day');
    assert.match(await send('9:30 el viernes que viene puede ser?'),/nombre y apellido/);
    assert.equal(e.state(session).day,'2026-10-16');assert.equal(e.state(session).time,'09:30');
    assert.match(await send('Ana Pérez'),/teléfono de contacto/);assert.equal(e.state(session).step,'phone');
    await send('sí');assert.equal(e.state(session).step,'consent');
    const summary=await send('sí');assert.match(summary,/NO está confirmado/);assert.match(summary,/Escribí CONFIRMAR.*o NO/);assert.match(summary,/Ana Pérez/);assert.match(summary,new RegExp(phone));
    const draft=dashboardData(e,base);assert.equal(draft.appointments.length,0);assert.equal(draft.pendingBookings.length,1);assert.match(draft.sessions[0].stage,/falta CONFIRMAR/);
    for(const ambiguous of ['sí','sí, confirmo','perfecto']){assert.match(await send(ambiguous),/Escribí CONFIRMAR/);assert.equal(e.query('SELECT count(*) n FROM appointments')[0].n,0);}
    assert.match(await send('CONFIRMAR'),/Turno confirmado/);assert.equal(calls(),0);
    const saved=dashboardData(e,base);assert.equal(saved.pendingBookings.length,0);assert.equal(saved.appointments.length,1);assert.equal(saved.appointments[0].status,'confirmed');assert.equal(saved.appointments[0].phone,phone);
    assert.equal(saved.sessions[0].appointmentCodes[0],saved.appointments[0].id);
    const again=await send('hola');assert.match(again,/Ana Pérez/);assert.match(again,/turno vigente/);assert.ok(!again.includes('reservar un turno'));
    assert.match(await send(saved.appointments[0].id),/Tu turno está confirmado/);assert.equal(calls(),0);
    assert.ok((await send('mis turnos')).includes(saved.appointments[0].id));assert.equal(calls(),0);
  }finally{e.db.close();}
});

test('NO descarta la solicitud sin crear un turno ni cancelar el turno original de una reprogramación',async()=>{
  const {e,send}=fixture();
  try{
    for(const text of ['quiero una limpieza el lunes a las 10','Ana Pérez','sí','sin recordatorios'])await send(text);
    await send('NO');assert.equal(e.query('SELECT count(*) n FROM appointments')[0].n,0);assert.equal(dashboardData(e,base).pendingBookings.length,0);
    for(const text of ['quiero una limpieza el lunes a las 10','sin recordatorios','CONFIRMAR'])await send(text);
    const a=e.query('SELECT * FROM appointments')[0];assert.ok(a);
    for(const text of ['reprogramar',a.id,'martes','11:00'])await send(text);
    assert.match(await send('sí'),/original sigue confirmado/);
    await send('NO');assert.equal(e.query('SELECT status FROM appointments WHERE id=?',a.id)[0].status,'confirmed');assert.equal(e.query('SELECT count(*) n FROM appointments')[0].n,1);
  }finally{e.db.close();}
});

test('muestra una tabla de horarios reales y la conserva al consultar precios durante la selección',async()=>{
  const {e,send,calls}=fixture();
  try{
    const available=e.slots('limpieza','2026-10-12').map(s=>s.time);
    const reply=await send('quiero una limpieza el lunes');assert.match(reply,/09:00 \| 09:15 \| 09:30/);
    for(const time of available)assert.ok(reply.includes(time));assert.ok(!reply.includes('18:00'));
    const faq=await send('¿Cuánto cuesta?');for(const time of available)assert.ok(faq.includes(time));assert.equal(e.state(session).step,'time');assert.equal(calls(),0);
    await send('¿Puede ser a las 9:30?');assert.equal(e.state(session).step,'name');
  }finally{e.db.close();}
});

test('descripciones editadas se aplican al catálogo y a consultas, con precio opcional y validación',async()=>{
  const {e,send,setConfig,calls}=fixture();
  let config=structuredClone(base);config.services.find(s=>s.id==='limpieza').description='Descripción de prueba aprobada por el negocio. Incluye los puntos que define la clínica.';config.services.find(s=>s.id==='limpieza').price='';setConfig(validateConfig(config));
  try{
    const first=await send('quiero reservar un turno');assert.match(first,/Descripción de prueba aprobada/);assert.ok(!first.includes('Precio: .'));
    const details=await send('¿Qué incluye la limpieza dental?');assert.match(details,/Descripción de prueba aprobada/);assert.ok(!details.includes('Precio:'));
    config.services.find(s=>s.id==='limpieza').description='Descripción actualizada.';config.services.find(s=>s.id==='limpieza').price='$ 100 de prueba';setConfig(validateConfig(config));
    const changed=await send('¿Qué incluye la limpieza dental?');assert.match(changed,/Descripción actualizada/);assert.match(changed,/\$ 100 de prueba/);assert.equal(calls(),0);
    assert.throws(()=>validateConfig({...config,services:[{...config.services[0],description:'x'.repeat(2001)}]}));
    const long={...config,services:config.services.map(s=>({...s,description:'Descripción extensa de prueba. '.repeat(60)}))};assert.ok(serviceCatalog(long).length<3500);assert.ok(serviceDetails(long.services[0]).includes(long.services[0].description.trim()));
  }finally{e.db.close();}
});

test('el teléfono de contacto se verifica contra el remitente y no cambia la identidad por otro número',async()=>{
  const {e,send}=fixture();try{
    await send('quiero una limpieza el lunes a las 10');await send('Ana Pérez');
    assert.match(await send('+5491198765432'),/número desde el que escribís/);assert.equal(e.state(session).step,'phone');
    await send('+5491112345678');assert.equal(e.state(session).phone,phone);assert.equal(e.state(session).step,'consent');
  }finally{e.db.close();}
});

test('corrige las conjugaciones reportadas y rechaza una confirmación inventada por el modelo',async()=>{
  assert.equal(polishReply('¿Elegí las 9:30 para tu turno?'),'¿Elegís las 9:30 para tu turno?');
  assert.equal(polishReply('¿Necesitás algo más o te ayudá con algo más?'),'¿Necesitás algo más o te ayudo con algo más?');
  const e=createEngine(':memory:',()=>base,clock),chat=createWhatsAppConversations(e,()=>base,settings,{clock,mode:'trial',trialRecipients:[phone],request:async()=>({ok:true,json:async()=>({choices:[{message:{content:'Excelente, quedamos con tu turno de limpieza dental para el viernes a las 9:30.'}}]})})});
  try{chat.receive({id:'invented',type:'text',text:{body:'¿Qué servicios ofrecen?'}},session);await chat.drain();assert.equal(e.query('SELECT count(*) n FROM appointments')[0].n,0);assert.equal(e.query('SELECT error FROM conversation_jobs')[0].error,'ai_response_rejected');assert.ok(!e.query('SELECT text FROM outbox')[0].text.includes('quedamos'));}finally{e.db.close();}
});
