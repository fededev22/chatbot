import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseObject,webhookEvents} from '../security.mjs';
import {createEngine,validateConfig} from '../core.mjs';
import {createWhatsAppConversations,botLimits} from '../conversation-ai.mjs';
const config=JSON.parse(readFileSync(new URL('../business.json',import.meta.url)));
const session='wa:5491112345678',other='wa:5491112345679';
const message=(id,text='hola')=>({id,from:session.slice(3),type:'text',text:{body:text}});
const event=messages=>({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'test-phone'},messages}}]}]});
function fixture(limits){let time=new Date('2026-10-08T12:00:00Z').getTime();const clock=()=>new Date(time),e=createEngine(':memory:',()=>config,clock),chat=createWhatsAppConversations(e,()=>config,{current:()=>({})},{clock,limits:{...botLimits,...limits}});return {e,chat,advance(ms){time+=ms;}};}
test('el webhook valida tipos, identidad y todo el lote antes de procesarlo',()=>{
  for(const raw of ['null','[]','"texto"','1'])assert.throws(()=>parseObject(raw),/objeto JSON/);
  for(const value of [{entry:{}},{entry:[null]},event([message('one'),{...message('two'),text:{body:{}}}]),event([{...message('bad'),from:5491112345678}]),event([{...message('bad'),id:'x'.repeat(257)}])])assert.throws(()=>webhookEvents(value,'test-phone'),/inválido/);
  assert.equal(webhookEvents(event([message('ok')]),'test-phone').messages.length,1);
  assert.equal(webhookEvents(event([message('other-phone')]),'unrelated-phone').messages.length,0);
  assert.throws(()=>webhookEvents(event(Array.from({length:201},(_,i)=>message(String(i)))),'test-phone'),/demasiado grande/);
});
test('límites persistentes por remitente: duplicados no gastan cupo, aislamiento y renovación',async()=>{
  const f=fixture({minute:2});try{
    assert.equal(f.chat.receive(message('one'),session),true);await f.chat.drain();
    assert.equal(f.chat.receive(message('one'),session),false);
    assert.equal(f.chat.receive(message('two'),session),true);await f.chat.drain();
    const restarted=createWhatsAppConversations(f.e,()=>config,{current:()=>({})},{clock:()=>new Date('2026-10-08T12:00:00Z'),limits:{...botLimits,minute:2}});
    assert.equal(restarted.receive(message('three'),session),false);assert.equal(f.e.query('SELECT count(*) n FROM messages')[0].n,4);
    assert.equal(f.chat.receive(message('other'),other),true);await f.chat.drain();
    f.advance(60000);assert.equal(f.chat.receive(message('renewed'),session),true);
  }finally{f.e.db.close();}
});
test('límite diario y global frena consumo; saturación devuelve 503 sin perder el mensaje',async()=>{
  const f=fixture({day:2,globalDay:3,pendingPerSender:1});try{
    assert.equal(f.chat.receive(message('one'),session),true);
    assert.throws(()=>f.chat.receive(message('two'),session),error=>error.status===503);
    assert.equal(f.e.query('SELECT 1 FROM webhooks WHERE id=?','two').length,0);await f.chat.drain();
    assert.equal(f.chat.receive(message('two'),session),true);await f.chat.drain();
    f.advance(60000);assert.equal(f.chat.receive(message('three'),session),false);
    assert.equal(f.chat.receive(message('other'),other),true);await f.chat.drain();assert.equal(f.chat.receive(message('global'),other),false);
    f.advance(86400000);assert.equal(f.chat.receive(message('next-day'),session),true);
  }finally{f.e.db.close();}
});
test('una credencial recibida no queda en mensajes, trabajos, contexto ni salida hacia la IA',async()=>{
  const f=fixture();try{
    const credential='nvapi-'+Array.from({length:50},()=> 'z').join('');
    f.chat.receive(message('secret','Mi clave es '+credential),session);await f.chat.drain();
    for(const table of ['messages','conversation_jobs','ai_context','outbox','sessions'])assert.ok(!JSON.stringify(f.e.query(`SELECT * FROM ${table}`)).includes(credential));
    assert.match(f.e.query('SELECT text FROM outbox')[0].text,/No compartas claves/);
    assert.equal(f.e.query('SELECT ai_used FROM conversation_jobs')[0].ai_used,0);
  }finally{f.e.db.close();}
});
test('datos malformados de configuración se rechazan antes de guardar',()=>{
  for(const c of [{...config,services:[null]},{...config,faqs:[null]},{...config,services:[{...config.services[0],id:{}}]},{...config,name:'x'.repeat(201)}])assert.throws(()=>validateConfig(c),error=>error.status===400);
});
