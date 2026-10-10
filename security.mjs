import {authError} from './auth.mjs';

export function parseObject(raw){
  let value;try{value=JSON.parse(raw);}catch{throw authError('Solicitud JSON inválida.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw authError('La solicitud debe contener un objeto JSON.');
  return value;
}

// Validate the entire delivery before storing anything; a malformed batch cannot
// partially enqueue work and then cause Meta to retry it indefinitely.
export function webhookEvents(event,phoneId){
  const list=value=>Array.isArray(value)?value:null;
  if(event.object!==undefined&&event.object!=='whatsapp_business_account'||!list(event.entry)||event.entry.length>50)throw authError('Evento de WhatsApp inválido.');
  const messages=[],statuses=[];let changes=0,items=0;
  for(const entry of event.entry){
    if(!entry||!list(entry.changes))throw authError('Evento de WhatsApp inválido.');
    for(const change of entry.changes){
      if(++changes>100||!change||!change.value||typeof change.value!=='object'||Array.isArray(change.value))throw authError('Evento de WhatsApp inválido.');
      const value=change.value;
      for(const key of ['messages','statuses'])if(value[key]!==undefined&&!list(value[key]))throw authError('Evento de WhatsApp inválido.');
      if(value.metadata?.phone_number_id!==phoneId)continue;
      for(const message of value.messages||[]){
        if(++items>200)throw authError('Evento de WhatsApp demasiado grande.',413);
        if(!message||typeof message.id!=='string'||message.id.length<1||message.id.length>256||typeof message.from!=='string'||!/^\d{10,15}$/.test(message.from)||typeof message.type!=='string'||message.type.length>40||message.type==='text'&&typeof message.text?.body!=='string')throw authError('Mensaje de WhatsApp inválido.');
        messages.push(message);
      }
      for(const status of value.statuses||[]){
        if(++items>200)throw authError('Evento de WhatsApp demasiado grande.',413);
        if(!status||typeof status.id!=='string'||status.id.length>256||typeof status.status!=='string'||status.status.length>40)throw authError('Estado de WhatsApp inválido.');
        statuses.push(status);
      }
    }
  }
  return {messages,statuses};
}
