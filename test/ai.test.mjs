import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createEngine} from '../core.mjs';
import {createAISettings,createTestChat} from '../ai.mjs';
const config=JSON.parse(readFileSync(new URL('../business.json',import.meta.url))),key='synthetic-test-key-never-a-real-credential';
function fixture(fetchImpl,provider='nvidia') {
  const e=createEngine(':memory:',()=>config,()=>new Date('2026-10-07T12:00:00Z'));
  const settings={current:()=>({provider,model:'test-model',enabled:true,key})};
  return {e,chat:createTestChat(e,()=>config,settings,fetchImpl)};
}
test('IA persiste configuración sin devolver claves y exige nueva clave al cambiar proveedor',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dental-ai-test-'));try{
    const path=join(dir,'ai.json'),settings=createAISettings(path);
    assert.equal(settings.status().enabled,false);
    const result=settings.save({provider:'nvidia',model:'test/model',enabled:true,key});assert.equal(result.configured,true);assert.ok(!JSON.stringify(result).includes(key));
    assert.equal(createAISettings(path).current().key,key);
    settings.save({provider:'nvidia',model:'test/new-model',enabled:true,key:''});assert.equal(settings.current().key,key);
    assert.throws(()=>settings.save({provider:'openrouter',model:'openrouter/free',enabled:true,key:''}));
    assert.throws(()=>settings.save({provider:'other',model:'test/model',enabled:true,key}));assert.throws(()=>settings.save({provider:'nvidia',model:'test/model',enabled:true,key:'bad\nheader'}));
    settings.save({provider:'nvidia',model:'test/model',enabled:false,key:''});assert.equal(settings.status().enabled,false);
  }finally{const absolute=resolve(dir);assert.equal(dirname(absolute),resolve(tmpdir()));assert.ok(basename(absolute).startsWith('dental-ai-test-'));rmSync(absolute,{recursive:true,force:true});}
});
test('IA de prueba requiere declaración de datos ficticios y nunca acepta sesiones WhatsApp',async()=>{
  let calls=0;const {e,chat}=fixture(async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:'Hola de prueba.'}}]})};});try{
    assert.equal((await chat.handle('demo:a','hola')).ai.used,false);assert.equal(calls,0);
    await assert.rejects(()=>chat.handle('wa:5491112345678','hola',true),/simulador/);assert.equal(calls,0);
    assert.equal((await chat.handle('demo:a','hola',true)).ai.used,true);assert.equal(calls,1);
  }finally{e.db.close();}
});
test('IA no recibe identidad del borrador ni registros de pacientes; reserva y confirmación son locales',async()=>{
  let calls=0,bodies=[];const {e,chat}=fixture(async(url,request)=>{calls++;bodies.push(request.body);return {ok:true,json:async()=>({choices:[{message:{content:'La limpieza dura 45 minutos. ¿Cuál es tu teléfono con código de país?'}}]})};});try{
    await chat.handle('demo:a','quiero una limpieza mañana a las 10',true);await chat.handle('demo:a','Ana Pérez',true);
    assert.equal(calls,0);await chat.handle('demo:a','¿Cuánto dura?',true);assert.equal(calls,1);assert.ok(!bodies[0].includes('Ana Pérez'));assert.ok(!bodies[0].includes('demo:a'));assert.ok(!bodies[0].includes('5491112345678'));
    await chat.handle('demo:a','+5491112345678',true);await chat.handle('demo:a','acepto',true);await chat.handle('demo:a','confirmar',true);assert.equal(calls,1);assert.equal(e.query('SELECT * FROM appointments').length,1);
    await chat.handle('demo:clinical','Me duele una muela',true);assert.equal(calls,1);
  }finally{e.db.close();}
});
test('fallos, credenciales y falsas confirmaciones del modelo no salen al chat ni crean turnos',async()=>{
  for(const result of [{ok:false,status:401,json:async()=>({error:key})},{ok:true,json:async()=>({choices:[{message:{content:key}}]})},{ok:true,json:async()=>({choices:[{message:{content:'¡Turno confirmado! Ya reservé tu turno.'}}]})}]){
    const {e,chat}=fixture(async()=>result);try{const answer=await chat.handle('demo:a','¿Tenés alguna novedad?',true);assert.equal(answer.ai.used,false);assert.ok(!JSON.stringify(answer).includes(key));assert.equal(e.query('SELECT * FROM appointments').length,0);assert.ok(!e.query('SELECT * FROM messages').some(m=>m.text.includes(key)));}finally{e.db.close();}
  }
});
test('OpenRouter exige proveedores sin recolección ni retención; preguntas concurrentes guardan respuestas en orden',async()=>{
  let calls=0;const {e,chat}=fixture(async(url,request)=>{const body=JSON.parse(request.body);assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.deepEqual(body.provider,{data_collection:'deny',zdr:true});assert.equal(body.max_tokens,450);const index=++calls;if(index===1)await new Promise(ok=>setTimeout(ok,10));return {ok:true,json:async()=>({choices:[{message:{content:`Respuesta de prueba ${index}`}}]})};},'openrouter');try{
    await Promise.all([chat.handle('demo:a','hola',true),chat.handle('demo:a','gracias',true)]);
    assert.deepEqual(e.query("SELECT text FROM messages WHERE role='bot' ORDER BY id").map(m=>m.text),['Respuesta de prueba 1','Respuesta de prueba 2']);
  }finally{e.db.close();}
});
