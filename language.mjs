// Local interpretation only: availability and all writes remain in core.mjs.
const normalize=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const words=s=>normalize(s).match(/[a-z0-9]+/g)||[];
const filler=new Set(['consulta','dental','de','del','la','el','para','una','un']);
export function findService(text,services) {
  const n=normalize(text), tokens=words(n);
  const exact=services.find(s=>n===s.id||n===normalize(s.name));
  if(exact)return exact;
  const found=services.filter(s=>[...words(s.name),s.id].some(w=>!filler.has(w)&&w.length>=4&&tokens.includes(w)));
  return found.length===1?found[0]:null;
}
export function naturalDay(text,now) {
  const n=normalize(text),today=new Date(now.getTime()-3*3600000),iso=d=>d.toISOString().slice(0,10);
  const exact=n.match(/\b\d{4}-\d{2}-\d{2}\b/);if(exact)return exact[0];
  const slash=n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if(slash){let year=Number(slash[3]||today.getUTCFullYear());const make=()=>`${year}-${slash[2].padStart(2,'0')}-${slash[1].padStart(2,'0')}`;if(!slash[3]&&make()<iso(today))year++;return make();}
  const dateText=n.replace(/\b(?:de la|por la) manana\b/g,'');
  let delta;
  if(/\bpasado manana\b/.test(dateText))delta=2;
  else if(/\bmanana\b/.test(dateText))delta=1;
  else if(/\bhoy\b/.test(dateText))delta=0;
  else {const days=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];const day=days.findIndex(d=>new RegExp(`\\b${d}\\b`).test(dateText));if(day>=0){delta=(day-today.getUTCDay()+7)%7;if(/\bproxima semana\b/.test(dateText))delta=(7-today.getUTCDay())%7+(7+day-1)%7+1;else if(/\b(?:que viene|proximo)\b/.test(dateText)&&delta===0)delta=7;}}
  return delta===undefined?null:iso(new Date(today.getTime()+delta*86400000));
}
export function naturalTime(text) {
  const n=normalize(text);
  let m=n.match(/\b(\d{1,2}):(\d{2})\b/),h=m?Number(m[1]):null,minute=m?Number(m[2]):0;
  if(!m){m=n.match(/^(\d{1,2})(?:\s*(?:hs?|horas?))?$/)||n.match(/\ba las?\s+(\d{1,2})(?:\s*(?:hs?|horas?))?\b/);if(m)h=Number(m[1]);}
  if(h===null)return null;
  if(/\b(?:tarde|noche|pm)\b/.test(n)&&h<12)h+=12;
  if(/\b(?:am|manana)\b/.test(n)&&h===12)h=0;
  return h>=0&&h<24&&minute<60?`${String(h).padStart(2,'0')}:${String(minute).padStart(2,'0')}`:null;
}
export function interpret(text,config,state,now) {
  const n=normalize(text).replace(/[,¿¡]/g,'').replace(/[?!.]+$/g,'').trim();
  const negative=/\b(?:no|nunca|tampoco)\b/.test(n),service=findService(n,config.services);
  let command=null;
  if(!negative&&/\b(?:humano|persona|recepcion|asesor)\b/.test(n))command='humano';
  else if(/^(?:reiniciar|volver|empezar de nuevo|descartar|dejarlo para despues)$/.test(n)||n==='no'&&state.step!=='consent')command='volver';
  else if(!negative&&/^(?:confirmar asistencia|confirmo (?:mi )?asistencia|si,? (?:voy|asistire)|voy a asistir)$/.test(n))command='confirmar asistencia';
  else if(!negative&&/\b(?:cancelar|anular)\b/.test(n)&&!['cancel_confirm','confirm','consent'].includes(state.step))command='cancelar';
  else if(!negative&&/\b(?:reprogramar|cambiar (?:mi |el )?(?:turno|cita)|mover (?:mi |el )?(?:turno|cita))\b/.test(n))command='reprogramar';
  else if(/^(?:mis turnos|mis citas)$/.test(n)||/\b(?:cuando|cual)\b.*\b(?:mi turno|mi cita|tengo turno)\b/.test(n))command='mis turnos';
  else if(!negative&&(n==='agendar'||!state.step&&(/\b(?:reservar|agendar|sacar un turno|pedir un turno)\b/.test(n)||/\b(?:quiero|quisiera|necesito|me gustaria)\b/.test(n)&&(/\b(?:turno|cita)\b/.test(n)||service&&!/\b(?:cuanto|precio|costo|sale|cuesta|dura|duracion|informacion|saber|consultar|conocer)\b/.test(n)))))command='agendar';
  const yes=/^(?:si(?: por favor)?|acepto|confirmar|confirmo(?: el turno| la reserva| la cancelacion)?|si,? confirmo|dale,? confirm(?:o|a)|si,? cancelar)$/.test(n);
  if(['confirm','cancel_confirm'].includes(state.step)&&yes)command='confirmar';
  if(state.step==='consent'){
    if(/^(?:no(?: gracias)?|sin recordatorios|no quiero (?:recibir )?recordatorios)$/.test(n))command='sin recordatorios';
    else if(yes||/^(?:si,? (?:quiero|acepto)(?: (?:los )?recordatorios)?|acepto recordatorios)$/.test(n))command='acepto';
  }
  // Specific intent wins over a broad keyword such as "cuanto".
  const duration=/\b(?:dura|duracion|demora|tiempo lleva|tiempo tarda)\b/.test(n);
  const faq=duration?config.faqs.find(f=>f.source==='duration')||config.faqs.find(f=>f.keywords.some(k=>/dur|demora/.test(normalize(k)))):
    config.faqs.map(f=>({f,score:Math.max(0,...f.keywords.filter(k=>n.includes(normalize(k))).map(k=>normalize(k).length))})).sort((a,b)=>b.score-a.score).find(x=>x.score)?.f;
  const question=/[¿?]/.test(text)||/^(?:cuanto|cuando|donde|como|que|cual|tienen|atienden|aceptan|puedo|me podes|me podrias)\b/.test(n);
  return {n,command,service,day:naturalDay(n,now),time:naturalTime(n),faq,question,
    greeting:/^(?:hola(?: que tal| como estas)?|que tal|como estas|buenas|buen dia|buenos dias|buenas tardes|buenas noches|inicio|menu)$/.test(n),
    thanks:/^(?:muchas gracias|gracias(?: por (?:todo|la ayuda))?|perfecto|genial|chau|hasta luego)$/.test(n),
    name:text.trim().replace(/^(?:me llamo|mi nombre es|soy)\s+/i,'')};
}
