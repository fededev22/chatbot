import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEngine} from '../core.mjs';
import {dashboardData,conversationData,markRead,humanAction,recordDelivery,acceptedDelivery} from '../reception.mjs';
const config=JSON.parse(readFileSync(new URL('../business.json',import.meta.url)));
const sender='wa:5491112345678',other='wa:5491198765432',now=new Date();
function engine(){return createEngine(':memory:',()=>config,()=>now);}

test('bandeja y métricas excluyen pruebas y distinguen reservas de atención humana',()=>{
  const e=engine();try{
    e.handle('demo:test','hola');e.handle(sender,'agendar','whatsapp');e.handle(other,'humano','whatsapp');
    const d=dashboardData(e,config);assert.equal(d.metrics.conversations,2);assert.equal(d.metrics.unread,2);assert.equal(d.metrics.handoffs,1);
    assert.equal(d.sessions.find(s=>s.id===sender).status,'booking');assert.equal(d.sessions.find(s=>s.id===other).status,'human');assert.equal(d.appointments.length,0);
    assert.throws(()=>conversationData(e,'demo:test'));
  }finally{e.db.close();}
});
test('lecturas son persistentes, por conversación y no ocultan mensajes posteriores',()=>{
  const e=engine();try{
    e.handle(sender,'hola','whatsapp');e.handle(other,'hola','whatsapp');const id=conversationData(e,sender).messages.find(m=>m.role==='user').id;
    markRead(e,sender,id);assert.equal(dashboardData(e,config).metrics.unread,1);assert.throws(()=>markRead(e,other,id));
    e.handle(sender,'horarios','whatsapp');assert.equal(dashboardData(e,config).sessions.find(s=>s.id===sender).unread,1);
    markRead(e,sender,id);assert.equal(dashboardData(e,config).metrics.unread,2);
  }finally{e.db.close();}
});
test('historial pagina sin perder ni repetir mensajes y rechaza cursores inválidos',()=>{
  const e=engine();try{
    for(let i=0;i<52;i++)e.handle(sender,'hola','whatsapp');
    const recent=conversationData(e,sender),older=conversationData(e,sender,recent.before);
    assert.equal(recent.messages.length,80);assert.equal(recent.hasMore,true);assert.equal(older.messages.length,24);assert.equal(older.hasMore,false);
    assert.equal(new Set([...recent.messages,...older.messages].map(m=>m.id)).size,104);assert.ok(older.messages.at(-1).id<recent.messages[0].id);
    assert.throws(()=>conversationData(e,sender,NaN));
  }finally{e.db.close();}
});
test('tomar atención pausa respuestas pendientes y reactivar conserva la reserva en curso',()=>{
  const e=engine();try{
    e.handle(sender,'agendar','whatsapp');e.queue(sender,'Elegí un servicio');humanAction(e,{session:sender,action:'pause'},true,now);
    assert.equal(e.state(sender).paused,true);assert.equal(e.query('SELECT status FROM outbox')[0].status,'cancelled');
    humanAction(e,{session:sender,action:'reply',text:'Te atiende recepción.'},true,now);
    const d=conversationData(e,sender);assert.equal(d.messages.at(-1).role,'human');assert.equal(d.messages.at(-1).status,'pending');
    humanAction(e,{session:sender,action:'resume'},true,now);assert.equal(e.state(sender).paused,undefined);assert.equal(e.state(sender).step,'service');
    assert.throws(()=>humanAction(e,{session:sender,action:'reply',text:'Hola'},true,now));
  }finally{e.db.close();}
});
test('respuesta fuera de ventana o sin conexión no guarda ni encola mensajes',()=>{
  const e=engine();try{
    e.handle(sender,'hola','whatsapp');humanAction(e,{session:sender,action:'pause'},true,now);
    const count=e.query('SELECT * FROM messages').length;
    assert.throws(()=>humanAction(e,{session:sender,action:'reply',text:'Hola'},true,new Date(now.getTime()+25*3600000)),/24 horas/);
    assert.throws(()=>humanAction(e,{session:sender,action:'reply',text:'Hola'},false,now),/configurado/);
    assert.equal(e.query('SELECT * FROM messages').length,count);assert.equal(e.query('SELECT * FROM outbox').length,0);
  }finally{e.db.close();}
});
test('estados de Meta toleran duplicados, desorden y llegada anterior a la respuesta HTTP',()=>{
  const e=engine();try{
    e.handle(sender,'hola','whatsapp');e.queue(sender,'Respuesta');const id=e.query('SELECT id FROM outbox')[0].id;
    recordDelivery(e,{id:'wamid.test',status:'read'});acceptedDelivery(e,id,'wamid.test');assert.equal(e.query('SELECT status FROM outbox')[0].status,'read');
    recordDelivery(e,{id:'wamid.test',status:'delivered'});recordDelivery(e,{id:'wamid.test',status:'sent'});assert.equal(e.query('SELECT status FROM outbox')[0].status,'read');
    recordDelivery(e,{id:'wamid.unknown',status:'invalid'});assert.equal(e.query('SELECT * FROM delivery_events').length,1);
  }finally{e.db.close();}
});
test('fallo de entrega llega al historial con el código sin exponer credenciales',()=>{
  const e=engine();try{
    e.handle(sender,'hola','whatsapp');humanAction(e,{session:sender,action:'pause'},true,now);humanAction(e,{session:sender,action:'reply',text:'Hola'},true,now);
    const id=e.query('SELECT id FROM outbox')[0].id;acceptedDelivery(e,id,'wamid.failed');
    recordDelivery(e,{id:'wamid.failed',status:'failed',errors:[{code:131026,message:'sensitive provider detail'}]});
    const last=conversationData(e,sender).messages.at(-1);assert.equal(last.status,'failed');assert.equal(last.last_error,'Meta: código 131026');assert.equal(dashboardData(e,config).metrics.issues,1);
  }finally{e.db.close();}
});
