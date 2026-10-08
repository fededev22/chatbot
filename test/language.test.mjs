import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEngine} from '../core.mjs';
import {naturalDay,naturalTime,findService} from '../language.mjs';
const base=JSON.parse(readFileSync(new URL('../business.json',import.meta.url)));
const now=new Date('2026-10-07T12:00:00Z');
function engine(){return createEngine(':memory:',()=>base,()=>now);}
test('frase completa selecciona servicio, fecha y horario sin reservar hasta confirmar',()=>{
  const e=engine();try{
    const r=e.handle('wa:5491112345678','Hola, quiero un turno para una limpieza mañana a las 10','whatsapp');
    assert.equal(r.data.service,'limpieza');assert.equal(r.data.day,'2026-10-08');assert.equal(r.data.time,'10:00');assert.equal(r.data.step,'name');
    e.handle('wa:5491112345678','Me llamo Ana Pérez','whatsapp');e.handle('wa:5491112345678','no gracias','whatsapp');
    assert.equal(e.state('wa:5491112345678').step,'confirm');assert.equal(e.state('wa:5491112345678').consent,false);assert.equal(e.query('SELECT * FROM appointments').length,0);
    e.handle('wa:5491112345678','no confirmo todavía','whatsapp');assert.equal(e.query('SELECT * FROM appointments').length,0);
    assert.match(e.handle('wa:5491112345678','Sí, confirmo','whatsapp').reply,/Turno confirmado/);const a=e.query('SELECT * FROM appointments')[0];assert.equal(a.name,'Ana Pérez');assert.equal(a.phone,'5491112345678');assert.equal(a.consent,0);
  }finally{e.db.close();}
});
test('preguntas intercaladas conservan la reserva y nunca se guardan como nombre',()=>{
  const e=engine();try{
    e.handle('demo:a','Quisiera reservar una limpieza el jueves a las 9');
    const price=e.handle('demo:a','¿Cuánto sale?');assert.match(price.reply,/Limpieza dental/);assert.doesNotMatch(price.reply,/ortodoncia/);assert.equal(price.data.step,'name');assert.equal(price.data.name,undefined);
    const duration=e.handle('demo:a','¿Y cuánto dura?');assert.match(duration.reply,/45 minutos/);assert.doesNotMatch(duration.reply,/Precios/);
    e.handle('demo:a','¿Tiene algún descuento especial?');assert.equal(e.state('demo:a').name,undefined);assert.equal(e.state('demo:a').step,'name');
    e.handle('demo:a','Soy Ana Pérez');assert.equal(e.state('demo:a').name,'Ana Pérez');assert.equal(e.state('demo:a').step,'phone');
  }finally{e.db.close();}
});
test('puede consultar un servicio y luego preguntar precio o duración con contexto actualizado',()=>{
  let config=structuredClone(base);const e=createEngine(':memory:',()=>config,()=>now);try{
    e.handle('demo:a','limpieza');assert.match(e.handle('demo:a','¿Cuánto dura?').reply,/Limpieza dental: 45 minutos/);
    config.services.find(x=>x.id==='limpieza').price='Precio de prueba';assert.match(e.handle('demo:a','¿Cuánto cuesta?').reply,/Precio de prueba/);
    e.handle('demo:b','¿Cuánto dura?');assert.equal(e.state('demo:b').contextService,undefined);
  }finally{e.db.close();}
});
test('datos adelantados se conservan cuando aún falta seleccionar servicio',()=>{
  const e=engine();try{
    e.handle('demo:a','Quiero un turno el viernes a las 11');const r=e.handle('demo:a','para limpieza');assert.equal(r.data.day,'2026-10-09');assert.equal(r.data.time,'11:00');assert.equal(r.data.step,'name');
  }finally{e.db.close();}
});
test('fechas naturales usan Argentina y los horarios inválidos conservan la selección',()=>{
  assert.equal(naturalDay('el viernes',now),'2026-10-09');assert.equal(naturalDay('pasado mañana',now),'2026-10-09');assert.equal(naturalDay('08/10/2026',now),'2026-10-08');
  assert.equal(naturalDay('el viernes a las 10 de la mañana',now),'2026-10-09');assert.equal(naturalDay('el viernes de la próxima semana',now),'2026-10-16');
  assert.equal(naturalDay('mañana',new Date('2026-10-08T01:00:00Z')),'2026-10-08');assert.equal(naturalDay('a las 10 de la mañana',now),null);
  assert.equal(naturalTime('a las 3 de la tarde'),'15:00');assert.equal(naturalTime('25:00'),null);
  const e=engine();try{
    const closed=e.handle('demo:a','Quiero reservar una limpieza el sábado');assert.equal(closed.data.step,'day');assert.equal(e.query('SELECT * FROM appointments').length,0);
    e.handle('demo:a','mañana a las 25');assert.equal(e.state('demo:a').step,'time');e.handle('demo:a','a las 10');assert.equal(e.state('demo:a').step,'name');
  }finally{e.db.close();}
});
test('rechaza servicios ambiguos y no inicia reservas negadas',()=>{
  assert.equal(findService('limpieza u ortodoncia',base.services),null);
  const e=engine();try{e.handle('demo:a','No quiero reservar un turno');assert.equal(e.state('demo:a').step,undefined);assert.equal(e.query('SELECT * FROM appointments').length,0);}finally{e.db.close();}
});
test('preguntar por un servicio no inicia una reserva y el saludo admite conversación',()=>{
  const e=engine();try{
    assert.match(e.handle('demo:a','Quiero saber cuánto sale una limpieza').reply,/Limpieza dental/);assert.equal(e.state('demo:a').step,undefined);
    assert.match(e.handle('demo:a','Hola, ¿cómo estás?').reply,/Hola/);assert.match(e.handle('demo:a','gracias').reply,/De nada/);
  }finally{e.db.close();}
});
test('cancelación natural sigue exigiendo código propio y confirmación',()=>{
  const e=engine();try{
    for(const t of ['Quiero una limpieza mañana a las 10','Ana Pérez','+5491112345678','Sí por favor','confirmo'])e.handle('demo:a',t);
    const a=e.query('SELECT * FROM appointments')[0];e.handle('demo:b','Quiero anular mi turno');e.handle('demo:b',`mi código es ${a.id}`);assert.equal(e.query('SELECT * FROM appointments')[0].status,'confirmed');
    e.handle('demo:a','Quiero cancelar mi turno');e.handle('demo:a',`el código es ${a.id}`);assert.equal(e.query('SELECT * FROM appointments')[0].status,'confirmed');
    e.handle('demo:a','Sí, cancelar');assert.equal(e.query('SELECT * FROM appointments')[0].status,'cancelled');
  }finally{e.db.close();}
});
