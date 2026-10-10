import {authError} from './auth.mjs';
import {safeMessage} from './core.mjs';

const stages={service:'Eligiendo servicio',day:'Eligiendo fecha',time:'Eligiendo horario',name:'Ingresando nombre',phone:'Confirmando teléfono',consent:'Eligiendo recordatorios',confirm:'No confirmado · falta CONFIRMAR',cancel_id:'Eligiendo turno a cancelar',cancel_confirm:'Confirmando cancelación',reschedule_id:'Eligiendo turno a reprogramar'};
const issues="('failed','blocked_window','blocked_template')";
const scalar=(e,sql,...args)=>e.query(sql,...args)[0].n;

export function dashboardData(e,config) {
  const sessions=e.query("SELECT * FROM sessions WHERE id LIKE 'wa:%' ORDER BY updated DESC LIMIT 100").map(row=>{
    const state=JSON.parse(row.state), last=e.query('SELECT id,role,text,at FROM messages WHERE session=? ORDER BY id DESC LIMIT 1',row.id)[0];
    const patient=e.query('SELECT name FROM appointments WHERE session=? ORDER BY start DESC LIMIT 1',row.id)[0];
    return {id:row.id,updated:row.updated,name:state.name||e.contact(row.id)?.name||patient?.name||`+${row.id.slice(3)}`,phone:row.id.slice(3),state,appointmentCodes:e.query('SELECT id FROM appointments WHERE session=?',row.id).map(a=>a.id),
      status:state.paused?'human':state.step?'booking':'bot',stage:state.paused?'Recepción · bot pausado':stages[state.step]||'Asistente activo',last,
      unread:scalar(e,"SELECT count(*) n FROM messages WHERE session=? AND role='user' AND id>coalesce((SELECT message_id FROM session_reads WHERE session=?),0)",row.id,row.id),
      issues:scalar(e,`SELECT count(*) n FROM outbox WHERE session=? AND status IN ${issues}`,row.id)};
  });
  const pendingBookings=sessions.filter(s=>s.state.service&&s.state.day&&s.state.time&&s.state.step&&!s.state.step.startsWith('cancel')).map(s=>({session:s.id,name:s.name,phone:s.phone,service:s.state.service,day:s.state.day,time:s.state.time,step:s.state.step,change:!!s.state.old}));
  return {config,sessions,pendingBookings,appointments:e.query("SELECT * FROM appointments WHERE session LIKE 'wa:%' ORDER BY start DESC LIMIT 200"),
    metrics:{conversations:scalar(e,"SELECT count(*) n FROM sessions WHERE id LIKE 'wa:%'"),
      unread:scalar(e,"SELECT count(*) n FROM sessions s WHERE id LIKE 'wa:%' AND EXISTS(SELECT 1 FROM messages m WHERE m.session=s.id AND m.role='user' AND m.id>coalesce((SELECT message_id FROM session_reads r WHERE r.session=s.id),0))"),
      handoffs:scalar(e,"SELECT count(*) n FROM sessions WHERE id LIKE 'wa:%' AND json_extract(state,'$.paused')=1"),
      bookings:scalar(e,"SELECT count(*) n FROM appointments WHERE session LIKE 'wa:%' AND status='confirmed' AND start>?",new Date().toISOString()),
      issues:scalar(e,`SELECT count(*) n FROM outbox WHERE session LIKE 'wa:%' AND status IN ${issues}`)},
    updatedAt:new Date().toISOString(),limit:100};
}

function validSession(e,id) {
  if(typeof id!=='string'||!/^wa:\d{10,15}$/.test(id)||!e.query('SELECT 1 FROM sessions WHERE id=?',id).length) throw authError('Conversación de WhatsApp inexistente.');
}

export function conversationData(e,id,before) {
  validSession(e,id);
  if(before!==undefined&&(!Number.isSafeInteger(before)||before<1)) throw authError('Página inválida.');
  const messages=e.query(`SELECT m.id,m.role,m.text,m.at,o.status,o.last_error FROM messages m
    LEFT JOIN outbox o ON o.message_id=m.id WHERE m.session=? AND m.id<? ORDER BY m.id DESC LIMIT 81`,id,before||Number.MAX_SAFE_INTEGER);
  const hasMore=messages.length>80;
  if(hasMore) messages.pop();
  messages.reverse();
  return {session:id,messages,hasMore,before:messages[0]?.id,
    appointments:e.query('SELECT * FROM appointments WHERE session=? ORDER BY start DESC LIMIT 10',id),
    outbox:e.query('SELECT id,text,status,created,last_error,role FROM outbox WHERE session=? ORDER BY created DESC LIMIT 12',id)};
}

export function markRead(e,id,messageId) {
  validSession(e,id);
  if(!Number.isSafeInteger(messageId)||!e.query("SELECT 1 FROM messages WHERE id=? AND session=? AND role='user'",messageId,id).length) throw authError('Mensaje inválido.');
  e.run('INSERT INTO session_reads VALUES(?,?) ON CONFLICT(session) DO UPDATE SET message_id=max(message_id,excluded.message_id)',id,messageId);
}

export function humanAction(e,data,enabled,now=new Date()) {
  validSession(e,data.session);
  const state=e.state(data.session);
  e.db.exec('BEGIN IMMEDIATE');
  try {
    if(data.action==='pause') {
      e.save(data.session,{...state,paused:true});
      e.run("UPDATE outbox SET status='cancelled' WHERE session=? AND status IN ('pending','generating') AND role='bot'",data.session);
    } else if(data.action==='resume') {
      delete state.paused;
      e.save(data.session,state);
    } else if(data.action==='reply') {
      if(!state.paused) throw authError('Tomá la atención antes de responder.');
      if(!enabled) throw authError('WhatsApp no está configurado.');
      if(typeof data.text!=='string'||!data.text.trim()||data.text.length>2000) throw authError('Escribí una respuesta de hasta 2000 caracteres.');
      const last=e.query("SELECT at FROM messages WHERE session=? AND role='user' ORDER BY id DESC LIMIT 1",data.session)[0];
      if(!last||now-new Date(last.at)>24*3600000) throw authError('Pasaron 24 horas desde el último mensaje del paciente. Esperá un nuevo mensaje para responder desde aquí.');
      const text=data.text.trim(),messageId=Number(e.run('INSERT INTO messages(session,role,text,at) VALUES(?,?,?,?)',data.session,'human',safeMessage(text),now.toISOString()).lastInsertRowid);
      e.queue(data.session,text,false,[],null,{role:'human',messageId});
      e.save(data.session,state);
    } else throw authError('Acción inválida.');
    e.db.exec('COMMIT');
  } catch(error) {e.db.exec('ROLLBACK');throw error;}
}

const rank={sent:1,delivered:2,read:3,failed:4};
export function recordDelivery(e,event) {
  if(typeof event.id!=='string'||!Object.hasOwn(rank,event.status)) return;
  const previous=e.query('SELECT status FROM delivery_events WHERE id=?',event.id)[0]?.status;
  if(previous&&rank[previous]>=rank[event.status]) return;
  const error=event.status==='failed'?`Meta: código ${Number(event.errors?.[0]?.code)||'desconocido'}`:null;
  e.run('INSERT INTO delivery_events VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,error=excluded.error',event.id,event.status,error);
  e.run('UPDATE outbox SET status=?,last_error=? WHERE meta_id=?',event.status,error,event.id);
}

export function acceptedDelivery(e,outboxId,metaId) {
  const event=typeof metaId==='string'?e.query('SELECT status,error FROM delivery_events WHERE id=?',metaId)[0]:null;
  e.run('UPDATE outbox SET status=?,meta_id=?,last_error=? WHERE id=?',event?.status||'sent',metaId||null,event?.error||null,outboxId);
}
