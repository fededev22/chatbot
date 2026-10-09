import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {welcomeText,botText,defaultFallback,faqAnswer,faqSources} from './bot-info.mjs';
import {interpret} from './language.mjs';
export const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function safeMessage(text) {return /\b(dolor|duele|sangrado|hinchazon|urgencia|medicamento|diagnostico|fiebre|historia clinica)\b/.test(normalize(text))?'[Consulta clínica: contenido omitido. Contactar al paciente por un canal adecuado.]':text;}
export function validateConfig(c) {
  if (!c || typeof c.name !== 'string' || !c.name.trim() || c.timezone !== 'America/Argentina/Buenos_Aires' || c.utcOffset !== '-03:00') throw Error('Usá nombre y zona horaria Argentina (-03:00).');
  if(c.address!==undefined&&(typeof c.address!=='string'||c.address.length>1000)) throw Error('Dirección inválida (máximo 1000 caracteres).');
  if(c.bot!==undefined&&(!c.bot||typeof c.bot!=='object'||Array.isArray(c.bot)||['welcome','fallback'].some(k=>c.bot[k]!==undefined&&(typeof c.bot[k]!=='string'||!c.bot[k].trim()||c.bot[k].length>2000)))) throw Error('Los mensajes del bot deben tener entre 1 y 2000 caracteres.');
  if (!Array.isArray(c.professionals) || !c.professionals.length || new Set(c.professionals).size !== c.professionals.length || c.professionals.some(x => typeof x !== 'string' || !x.trim())) throw Error('Configurá profesionales únicos.');
  if (!Array.isArray(c.services) || !c.services.length || new Set(c.services.map(s => s.id)).size !== c.services.length || c.services.some(s => !/^[a-z0-9_-]+$/.test(s.id) || typeof s.name !== 'string' || !s.name.trim() || !Number.isInteger(s.minutes) || s.minutes < 15 || s.minutes > 240 || typeof s.price !== 'string')) throw Error('Servicios inválidos. Duración: 15 a 240 minutos.');
  if (!Number.isInteger(c.bufferMinutes) || c.bufferMinutes < 0 || c.bufferMinutes > 120) throw Error('Descanso inválido.');
  if (!c.hours || !Object.keys(c.hours).length || Object.entries(c.hours).some(([d,h]) => !/^[0-6]$/.test(d) || !Array.isArray(h) || h.length !== 2 || h.some(n => !Number.isFinite(n)||!Number.isInteger(n*4)) || h[0] < 0 || h[1] > 24 || h[0] >= h[1])) throw Error('Horario inválido. Elegí apertura y cierre en intervalos de 15 minutos.');
  if (!Array.isArray(c.faqs) || c.faqs.some(f => typeof f.question !== 'string' || !f.question.trim() || typeof f.answer !== 'string' || f.answer.length>2000 || !Array.isArray(f.keywords) || !f.keywords.length || f.keywords.some(k => typeof k !== 'string' || !k.trim()) || f.source!==undefined&&!Object.hasOwn(faqSources,f.source))) throw Error('Revisá las preguntas: completá la pregunta, palabras clave, origen válido y respuesta de hasta 2000 caracteres.');
  return c;
}
export function createEngine(path, getConfig, clock = () => new Date()) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY, session TEXT, name TEXT, phone TEXT, service TEXT, professional TEXT, start TEXT, end TEXT, busy_end TEXT, status TEXT, consent INTEGER, attendance INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, session TEXT, role TEXT, text TEXT, at TEXT);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, session TEXT, text TEXT, template INTEGER DEFAULT 0, params TEXT, status TEXT, attempts INTEGER DEFAULT 0, next_try INTEGER DEFAULT 0, created TEXT, appointment TEXT);
    CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS reminders (appointment TEXT, hours INTEGER, PRIMARY KEY(appointment,hours));
    CREATE TABLE IF NOT EXISTS contacts (phone TEXT PRIMARY KEY, name TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, updated TEXT NOT NULL);`);
  for (const [name,type] of [['message_id','INTEGER'],['meta_id','TEXT'],['last_error','TEXT'],['role',"TEXT DEFAULT 'bot'"]]) {
    if (!db.prepare('PRAGMA table_info(outbox)').all().some(c=>c.name===name)) db.exec(`ALTER TABLE outbox ADD COLUMN ${name} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS session_reads (session TEXT PRIMARY KEY, message_id INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_session_id ON messages(session,id);
    CREATE INDEX IF NOT EXISTS outbox_meta_id ON outbox(meta_id);
    CREATE TABLE IF NOT EXISTS delivery_events (id TEXT PRIMARY KEY, status TEXT, error TEXT);`);
  const query = (sql,...args) => db.prepare(sql).all(...args);
  const run = (sql,...args) => db.prepare(sql).run(...args);
  db.exec(`INSERT OR IGNORE INTO contacts(phone,name,first_seen,last_seen,updated)
    SELECT substr(s.id,4),(SELECT name FROM appointments a WHERE a.session=s.id ORDER BY start DESC LIMIT 1),
      coalesce((SELECT min(at) FROM messages m WHERE m.session=s.id),s.updated),s.updated,s.updated
    FROM sessions s WHERE s.id LIKE 'wa:%';`);
  function state(id) { return JSON.parse(db.prepare('SELECT state FROM sessions WHERE id=?').get(id)?.state || '{}'); }
  function save(id,s) { run('INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated=excluded.updated',id,JSON.stringify(s),clock().toISOString()); }
  function contact(session) {return /^wa:\d{10,15}$/.test(session)?query('SELECT * FROM contacts WHERE phone=?',session.slice(3))[0]||null:null;}
  function remember(session,s=state(session)) {
    if(!/^wa:\d{10,15}$/.test(session))return;
    const name=s.name||query('SELECT name FROM appointments WHERE session=? ORDER BY start DESC LIMIT 1',session)[0]?.name||null,at=clock().toISOString();
    run('INSERT INTO contacts VALUES(?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET name=coalesce(excluded.name,contacts.name),last_seen=excluded.last_seen,updated=excluded.updated',session.slice(3),name,at,at,at);
  }
  function upcoming(session) {return query("SELECT * FROM appointments WHERE session=? AND status='confirmed' AND start>? ORDER BY start",session,clock().toISOString());}
  function slots(serviceId, day) {
    const c=getConfig(), service=c.services.find(s=>s.id===serviceId);
    if (!service || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    const date=new Date(`${day}T12:00:00${c.utcOffset}`);
    if (isNaN(date) || date.toISOString().slice(0,10)!==day || date-clock()>90*86400000) return [];
    const h=c.hours[date.getUTCDay()]; if (!h) return [];
    const found=[];
    for(let minute=h[0]*60;minute+service.minutes+c.bufferMinutes<=h[1]*60;minute+=15) {
      const time=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
      const start=new Date(`${day}T${time}:00${c.utcOffset}`).toISOString();
      if (new Date(start)<=clock()) continue;
      const end=new Date(new Date(start).getTime()+service.minutes*60000).toISOString();
      const busy=new Date(new Date(end).getTime()+c.bufferMinutes*60000).toISOString();
      for (const professional of c.professionals) {
        if (!db.prepare("SELECT id FROM appointments WHERE professional=? AND status='confirmed' AND start<? AND busy_end>?").get(professional,busy,start)) { found.push({time,start,end,busy,professional}); break; }
      }
    } return found;
  }
  const owned = (session,id) => db.prepare("SELECT * FROM appointments WHERE id=? AND session=? AND status='confirmed'").get(id,session);
  function handle(session,text,channel='demo',{recordUser=true}={}) {
    if (typeof text !== 'string' || !text.trim() || text.length>2000) throw Error('Mensaje inválido (máximo 2000 caracteres).');
    let s=state(session), n=normalize(text), c=getConfig(), intent='faq', reply='', choices=[];
    const message=interpret(text,c,s,clock());
    n=message.command||message.n;
    const result=()=>{
      save(session,s);
      remember(session,s);
      if(recordUser)run('INSERT INTO messages(session,role,text,at) VALUES(?,?,?,?)',session,'user',safeMessage(text),clock().toISOString());
      run('INSERT INTO messages(session,role,text,at) VALUES(?,?,?,?)',session,'bot',reply,clock().toISOString());
      return {reply,intent,data:s,choices};
    };
    const services=()=> { reply='¿Qué servicio querés reservar?'; choices=c.services.map(x=>({label:x.name,value:x.id})); s.step='service'; };
    const prompts={service:'¿Qué servicio querés reservar?',day:'¿Qué día preferís? Podés decir mañana, el viernes o una fecha como 08/10/2026.',time:'¿Qué horario de la lista preferís?',name:'¿Cuál es tu nombre y apellido?',phone:'¿Cuál es tu teléfono con código de país?',consent:'¿Querés recibir recordatorios? Respondé sí o sin recordatorios.',confirm:'¿Confirmás la reserva del resumen anterior?',cancel_id:'Elegí el código de tu turno a cancelar.',reschedule_id:'Elegí el código de tu turno a reprogramar.',cancel_confirm:'¿Confirmás cancelar el turno anterior?'};
    const advance=()=>{
      s.step='day';reply=prompts.day;
      const day=message.day||s.requestDay,time=message.time||s.requestTime;
      if(!day)return;
      delete s.requestDay;delete s.requestTime;
      const available=slots(s.service,day);
      if(!available.length){reply='No hay horarios disponibles para esa fecha. Elegí otro día hábil; podés decir el viernes o una fecha como 09/10/2026.';return;}
      s.day=day;s.step='time';reply=`Para el ${day}, estos horarios están disponibles (hora de Argentina). ¿Cuál preferís?`;
      choices=available.map(x=>({label:x.time,value:x.time}));
      if(!time)return;
      const slot=available.find(x=>x.time===time);
      if(!slot){reply=`A las ${time} no hay disponibilidad para el ${day}. Elegí otro horario de la lista.`;return;}
      s.time=time;s.step=s.old?'confirm':s.name?(channel==='whatsapp'?'consent':'phone'):'name';choices=s.old?confirmChoices():[];
      reply=s.old?summary(s,c):s.step==='consent'?'¿Querés recibir recordatorios de este turno por WhatsApp?':s.step==='phone'?prompts.phone:'¿Cuál es tu nombre y apellido? No envíes datos médicos.';
    };
    if (s.paused) { reply='Recepción tiene tu conversación pendiente. El bot está pausado hasta que una persona lo reactive.'; intent='humano'; return result(); }
    if (n==='humano' || safeMessage(text)!==text) {
      s={paused:true}; intent='humano'; reply='Voy a derivar tu consulta a recepción. No puedo evaluar síntomas ni recomendar tratamientos. Si creés que es una emergencia, contactá un servicio de urgencias local. No envíes estudios ni información médica por este chat.'; return result();
    }
    if (n==='reiniciar' || n==='volver' || n==='no'&&s.step!=='consent') { s={}; reply='Listo, descarté la operación pendiente. ¿En qué puedo ayudarte?'; choices=[{label:'Reservar turno',value:'agendar'},{label:'Mis turnos',value:'mis turnos'}]; return result(); }
    if (n==='confirmar asistencia') { run("UPDATE appointments SET attendance=1 WHERE session=? AND status='confirmed' AND start>?",session,clock().toISOString()); reply='Registré tu confirmación de asistencia para tus próximos turnos.'; return result(); }
    if (['mis turnos','cancelar','reprogramar'].includes(n)) {
      const appointments=query("SELECT * FROM appointments WHERE session=? AND status='confirmed' AND start>? ORDER BY start",session,clock().toISOString());
      s={step:n==='cancelar'?'cancel_id':n==='reprogramar'?'reschedule_id':undefined}; intent=n==='cancelar'?'cancelar':n==='reprogramar'?'reprogramar':'faq';
      reply=appointments.length?'Elegí tu turno. Para modificarlo escribí cancelar o reprogramar.':'No tenés turnos próximos en esta conversación.';
      choices=appointments.map(a=>({label:`${c.services.find(x=>x.id===a.service)?.name || a.service} · ${formatDate(a.start)}`,value:a.id})); return result();
    }
    if (n==='agendar' || !s.step && ['turno','cita'].includes(n)) {
      s=channel==='whatsapp'&&contact(session)?.name?{name:contact(session).name,phone:session.slice(3)}:{}; intent='agendar';
      if(message.service){s.service=message.service.id;advance();}
      else {if(message.day)s.requestDay=message.day;if(message.time)s.requestTime=message.time;services();}
      return result();
    }
    const fieldAnswer=s.step==='service'&&message.service&&!message.question||s.step==='day'&&message.day&&!message.question||s.step==='time'&&message.time&&!message.question;
    if(!message.command&&!fieldAnswer&&(message.faq||message.greeting||message.thanks||message.question)) {
      const topic=message.service?.id||s.service||s.contextService;
      if(message.service)s.contextService=topic;
      const answerConfig=c.services.some(x=>x.id===topic)&&['prices','duration'].includes(message.faq?.source)?{...c,services:c.services.filter(x=>x.id===topic)}:c;
      if(message.faq)reply=faqAnswer(message.faq,answerConfig);
      else if(message.greeting)reply=s.step?'¡Hola! Seguimos con tu turno.':welcomeText(c);
      else if(message.thanks)reply='¡De nada! Si necesitás otra consulta o un turno, acá estoy.';
      else reply=botText(c.bot?.fallback||defaultFallback,c);
      if(s.step)reply+=`\n\n${prompts[s.step]||'Seguimos con tu turno pendiente.'}`;
      else if(message.greeting)choices=[{label:'Reservar turno',value:'agendar'},{label:'Horarios',value:'horarios'},{label:'Hablar con recepción',value:'humano'}];
      return result();
    }
    if (s.step) {
      intent=s.old?'reprogramar':s.step.startsWith('cancel')?'cancelar':'agendar';
      if (s.step==='cancel_id' || s.step==='reschedule_id') {
        const id=text.match(/\b[a-f0-9]{8}\b/i)?.[0]?.toLowerCase()||text.trim();
        const a=owned(session,id);
        if(!a || new Date(a.start)<=clock()) reply='Elegí un turno propio y vigente de la lista.';
        else if(s.step==='cancel_id') { s={step:'cancel_confirm',id:a.id}; reply=`¿Confirmás cancelar ${formatDate(a.start)}?`; choices=[{label:'Sí, cancelar',value:'confirmar'},{label:'Conservar turno',value:'no'}]; }
        else { s={old:a.id,service:a.service,name:a.name,phone:a.phone,consent:!!a.consent,step:'day'}; reply='¿Para qué nueva fecha? Podés decir mañana o el viernes. Tu turno original se conserva hasta confirmar el cambio.'; }
      } else if (s.step==='cancel_confirm') {
        if(n!=='confirmar') reply='Escribí confirmar o no.';
        else { run("UPDATE appointments SET status='cancelled' WHERE id=? AND session=? AND status='confirmed'",s.id,session); s={}; reply='Tu turno fue cancelado.'; }
      } else if(s.step==='service') {
        const service=message.service;
        if(!service) { services(); } else { s.service=service.id;advance(); }
      } else if(s.step==='day') {
        advance();
      } else if(s.step==='time') {
        const slot=slots(s.service,s.day).find(x=>x.time===message.time);
        if(!slot) {reply='Ese horario ya no está disponible. Elegí otro de la lista.'; choices=slots(s.service,s.day).map(x=>({label:x.time,value:x.time}));if(!choices.length){s.step='day';delete s.time;reply='Ya no quedan horarios disponibles para ese día. ¿Qué otra fecha preferís?';}}
        else {s.time=slot.time;s.step=s.old?'confirm':s.name?(channel==='whatsapp'?'consent':'phone'):'name';reply=s.old?summary(s,c):s.step==='consent'?'¿Querés recibir recordatorios de este turno por WhatsApp?':s.step==='phone'?prompts.phone:'¿Cuál es tu nombre y apellido? No envíes datos médicos.';if(s.old)choices=confirmChoices();}
      } else if(s.step==='name') {
        if(message.name.length<3 || message.name.length>100 || !/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)+$/u.test(message.name)) reply='Ingresá tu nombre y apellido, de 3 a 100 caracteres.';
        else {s.name=message.name;s.step=channel==='whatsapp'?'consent':'phone'; if(channel==='whatsapp') s.phone=session.slice(3); reply=channel==='whatsapp'?'¿Querés recibir recordatorios de este turno por WhatsApp? Respondé sí o sin recordatorios.':'¿Cuál es tu teléfono? Incluí código de país, por ejemplo +5491112345678.';}
      } else if(s.step==='phone') {
        const phone=text.replace(/[\s()+-]/g,'');
        if(!/^\d{10,15}$/.test(phone)) reply='Usá entre 10 y 15 dígitos con código de país.';
        else {s.phone=phone;s.step='consent';reply='¿Querés recibir recordatorios?';choices=[{label:'Acepto recordatorios',value:'acepto'},{label:'Sin recordatorios',value:'sin recordatorios'}];}
      } else if(s.step==='consent') {
        if(!['acepto','sin recordatorios'].includes(n)) reply='Respondé acepto o sin recordatorios.';
        else {s.consent=n==='acepto';s.step='confirm';reply=summary(s,c);choices=confirmChoices();}
      } else if(s.step==='confirm') {
        if(n!=='confirmar') {reply=summary(s,c);choices=confirmChoices();}
        else {
          db.exec('SAVEPOINT booking');
          try {
            if(s.old && !owned(session,s.old)) throw Error('El turno original ya no está vigente.');
            const slot=slots(s.service,s.day).find(x=>x.time===s.time);
            if(!slot) throw Error('El horario se ocupó. Tu turno original sigue intacto. Elegí otro horario.');
            const id=randomUUID().slice(0,8);
            run('INSERT INTO appointments(id,session,name,phone,service,professional,start,end,busy_end,status,consent) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,session,s.name,s.phone,s.service,slot.professional,slot.start,slot.end,slot.busy,'confirmed',s.consent?1:0);
            if(s.old) run("UPDATE appointments SET status='rescheduled' WHERE id=? AND session=?",s.old,session);
            db.exec('RELEASE booking');reply=`¡Turno confirmado! ${c.services.find(x=>x.id===s.service).name} · ${formatDate(slot.start)} · ${slot.professional}. Código: ${id}. Escribí cancelar o reprogramar para modificarlo.`;s={};
          } catch(e) {db.exec('ROLLBACK TO booking; RELEASE booking'); s.step='time';reply=e.message;choices=slots(s.service,s.day).map(x=>({label:x.time,value:x.time}));}
        }
      }
      return result();
    }
    if(message.service){s.contextService=message.service.id;reply=`${message.service.name}: duración de ${message.service.minutes} minutos. Precio: ${message.service.price||'A confirmar con recepción'}. ¿Querés que busquemos un turno?`;choices=[{label:'Reservar turno',value:`quiero un turno para ${message.service.name}`}];}
    else {reply=botText(c.bot?.fallback||defaultFallback,c);choices=[{label:'Derivar a recepción',value:'humano'},{label:'Reservar turno',value:'agendar'}];}
    return result();
  }
  function queue(session,text,template=false,params=[],appointment=null,options={}) {
    const role=options.role||(template?'reminder':'bot');
    let messageId=options.messageId||null;
    if(template) messageId=Number(run('INSERT INTO messages(session,role,text,at) VALUES(?,?,?,?)',session,role,text,clock().toISOString()).lastInsertRowid);
    const id=randomUUID();
    run('INSERT INTO outbox(id,session,text,template,params,status,created,appointment,message_id,role) VALUES(?,?,?,?,?,?,?,?,?,?)',id,session,text,template?1:0,JSON.stringify(params),session.startsWith('wa:')?'pending':'demo',clock().toISOString(),appointment,messageId,role);
    return id;
  }
  function remind() {
    for(const a of query("SELECT * FROM appointments WHERE status='confirmed' AND consent=1 AND start>?",clock().toISOString())) {
      const until=(new Date(a.start)-clock())/3600000;
      for(const hours of [24,2]) if(until<=hours && until>hours-0.25 && !db.prepare('SELECT 1 FROM reminders WHERE appointment=? AND hours=?').get(a.id,hours)) {
        const service=getConfig().services.find(s=>s.id===a.service)?.name || a.service;
        db.exec('BEGIN IMMEDIATE');
        try {run('INSERT INTO reminders VALUES(?,?)',a.id,hours);queue(a.session,`Recordatorio: ${service}, ${formatDate(a.start)}. Escribí confirmar asistencia, cancelar o reprogramar.`,true,[a.name,service,formatDate(a.start)],a.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      }
    }
  }
  return {db,query,run,state,save,slots,handle,queue,remind,contact,remember,upcoming};
}
export function formatDate(s) {return new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',dateStyle:'medium',timeStyle:'short'}).format(new Date(s));}
function confirmChoices(){return [{label:'Confirmar turno',value:'confirmar'},{label:'Descartar',value:'no'}];}
function summary(s,c){return `Confirmá tu turno: ${c.services.find(x=>x.id===s.service)?.name} · ${s.day} a las ${s.time} (Argentina) · ${s.name} · +${s.phone}. ${s.consent?'Con':'Sin'} recordatorios. No se reserva hasta que confirmes.`;}
