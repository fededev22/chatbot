export const defaultWelcome='Hola, soy el asistente de {nombre_clinica}. Puedo ayudarte con consultas y turnos. Guardamos nombre, teléfono y turno para gestionar tu reserva. No compartas información médica. Podés solicitar a recepción acceso o eliminación de tus datos.';
export const defaultFallback='No tengo una respuesta verificada para esa consulta. ¿Querés hablar con recepción?';
export const faqSources={custom:'Respuesta escrita por la clínica',address:'Usar dirección de la clínica',hours:'Usar horarios de atención',services:'Usar lista de servicios',prices:'Usar precios de los servicios',duration:'Usar duración de los servicios'};
const dayNames={0:'Domingo',1:'Lunes',2:'Martes',3:'Miércoles',4:'Jueves',5:'Viernes',6:'Sábado'};
const hour=h=>`${String(Math.floor(h)).padStart(2,'0')}:${String(Math.round((h%1)*60)).padStart(2,'0')}`;
export function botText(text,c) {return text.replaceAll('{nombre_clinica}',c.name||'la clínica').replaceAll('{direccion}',c.address||'Dirección a confirmar con recepción');}
export function welcomeText(c) {return botText(c.bot?.welcome||defaultWelcome,c);}
export function faqAnswer(f,c) {
  let answer=f.answer;
  if(f.source==='address')answer=c.address?.trim()?`Nos encontrás en ${c.address.trim()}.`:'La dirección está pendiente de configurar. Consultá con recepción.';
  if(f.source==='hours')answer='Horarios de atención (hora de Argentina):\n'+[1,2,3,4,5,6,0].filter(d=>c.hours[d]).map(d=>`${dayNames[d]}: ${hour(c.hours[d][0])} a ${hour(c.hours[d][1])}`).join('\n');
  if(f.source==='services')answer='Servicios de la clínica:\n'+c.services.map(s=>`• ${s.name}`).join('\n');
  if(f.source==='prices')answer='Precios e información de los servicios:\n'+c.services.map(s=>`• ${s.name}: ${s.price||'A confirmar con recepción'}`).join('\n');
  if(f.source==='duration')answer='Duración de los turnos:\n'+c.services.map(s=>`• ${s.name}: ${s.minutes} minutos`).join('\n');
  return botText(answer,c);
}
