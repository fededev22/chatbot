import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEngine,validateConfig} from '../core.mjs';
import {checkWhatsAppConnection} from '../connection.mjs';
const base=JSON.parse(readFileSync(new URL('../business.json',import.meta.url)));
test('el bot usa los datos y mensajes editados sin reiniciar ni alterar el historial',()=>{
  let config=structuredClone(base);const e=createEngine(':memory:',()=>config);
  try {e.handle('demo:editable','hola');config={...config,name:'Clínica de prueba',address:'Dirección de prueba',bot:{welcome:'Hola, te atiende {nombre_clinica}. Ubicación: {direccion}.',fallback:'Recepción puede ayudarte.'}};
    assert.equal(e.handle('demo:editable','hola').reply,'Hola, te atiende Clínica de prueba. Ubicación: Dirección de prueba.');assert.equal(e.handle('demo:editable','consulta desconocida 123').reply,'Recepción puede ayudarte.');
    assert.match(e.query("SELECT text FROM messages WHERE role='bot' ORDER BY id")[0].text,/Hola/);
  }finally{e.db.close();}
});
test('respuestas vinculadas usan dirección, horarios y precios actuales; una respuesta manual se conserva',()=>{
  let config={...structuredClone(base),address:'Avenida de prueba 100',hours:{1:[9.5,17.75]},services:[{id:'consulta',name:'Evaluación',minutes:45,price:'Precio a confirmar'}],faqs:[{question:'Ubicación',keywords:['ubicacion'],source:'address',answer:''},{question:'Horario',keywords:['horario'],source:'hours',answer:''},{question:'Precio',keywords:['precio'],source:'prices',answer:''},{question:'Pago',keywords:['pago'],source:'custom',answer:'Respuesta escrita por la clínica.'}]};
  const e=createEngine(':memory:',()=>config,()=>new Date('2026-10-07T12:00:00Z'));
  try{validateConfig(config);assert.match(e.handle('demo:info','ubicación').reply,/Avenida de prueba 100/);assert.match(e.handle('demo:info','horario').reply,/Lunes: 09:30 a 17:45/);assert.match(e.handle('demo:info','precio').reply,/Evaluación: Precio a confirmar/);
    config={...config,address:'Otra dirección de prueba'};assert.match(e.handle('demo:info','ubicación').reply,/Otra dirección/);assert.equal(e.handle('demo:info','pago').reply,'Respuesta escrita por la clínica.');assert.equal(e.slots('consulta','2026-10-12')[0].time,'09:30');
  }finally{e.db.close();}
});
test('configuración rechaza mensajes vacíos, orígenes desconocidos y horarios incoherentes',()=>{
  assert.throws(()=>validateConfig({...base,bot:{welcome:''}}));assert.throws(()=>validateConfig({...base,bot:{welcome:'a'.repeat(2001)}}));assert.throws(()=>validateConfig({...base,hours:{1:[17,9]}}));assert.throws(()=>validateConfig({...base,faqs:[{question:'Q',keywords:['q'],answer:'A',source:'inventado'}]}));
});
const env={WHATSAPP_TOKEN:'private-test-token',WHATSAPP_PHONE_ID:'123',META_APP_SECRET:'private-test-secret',WEBHOOK_VERIFY_TOKEN:'private-verify',WEBHOOK_PUBLIC_URL:'https://example.test/webhook'};
test('estado distingue token vencido de webhook caído sin exponer secretos',async()=>{
  const expired=await checkWhatsAppConnection(env,async()=>({ok:false,json:async()=>({error:{code:190,message:'private-test-token'}})}));assert.equal(expired.state,'expired');assert.ok(!JSON.stringify(expired).includes('private-test-token'));
  let n=0;const callback=await checkWhatsAppConnection(env,async()=>{if(n++)throw Error('DNS');return {ok:true,json:async()=>({id:'123'})};});assert.equal(callback.state,'unreachable');
  const healthy=await checkWhatsAppConnection(env,async()=>({ok:true,json:async()=>({id:'123'}),text:async()=>'connection-health'}));assert.equal(healthy.state,'connected');
});
