import {defaultWelcome,defaultFallback,welcomeText,botText,faqAnswer,faqSources} from './bot-info.js';
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const field=(label,control,hint)=>{const wrap=node('label',undefined,'editor-field');wrap.append(node('span',label),control);if(hint)wrap.append(node('small',hint));return wrap;};
const input=(id,value,type='text')=>{const n=node('input');n.id=id;n.type=type;n.value=value??'';return n;};
const area=(id,value,rows=3)=>{const n=node('textarea');n.id=id;n.rows=rows;n.value=value??'';return n;};
const section=(title,description)=>{const n=node('section',undefined,'editor-section');n.append(node('h3',title),node('p',description,'muted'));return n;};
const hourText=value=>`${String(Math.floor(value)).padStart(2,'0')}:${String(Math.round(value%1*60)).padStart(2,'0')}`;
function hourSelect(id,value,closing=false) {const n=node('select');n.id=id;for(let minute=closing?15:0;minute<=(closing?1440:1425);minute+=15){const o=node('option',hourText(minute/60));o.value=String(minute/60);n.append(o);}n.value=String(value);return n;}

export function createSettingsEditor({onSave,onNotice,onModeChange}) {
  const root=document.getElementById('settings-fields'),form=document.getElementById('settings-form'),save=document.getElementById('config-save'),state=document.getElementById('config-save-state');
  const savedView=document.getElementById('bot-saved-view'),savedInformation=document.getElementById('saved-bot-information');
  let base,latest,signature='',savedSignature='',dirty=false,saving=false,editing=false,updatedAt;
  function setEditing(value){editing=value;form.classList.toggle('hidden',!editing);savedView.classList.toggle('hidden',editing);onModeChange?.(editing);if(!editing&&!document.getElementById('settings').classList.contains('hidden'))document.getElementById('main').scrollIntoView({block:'start'});}
  function renderSaved(config){
    const nextSignature=JSON.stringify(config)+updatedAt;if(nextSignature===savedSignature)return;savedSignature=nextSignature;
    document.getElementById('saved-clinic-name').textContent=config.name;
    document.getElementById('saved-info-state').textContent=updatedAt?`Información guardada · ${new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',dateStyle:'medium',timeStyle:'short'}).format(new Date(updatedAt))}`:'Esta es la información que usa el bot.';
    savedInformation.replaceChildren();
    const facts=section('Datos de la clínica','Información actual del negocio.');const grid=node('dl',undefined,'saved-facts');
    for(const [label,value] of [['Dirección',config.address||'Pendiente de configurar'],['Profesionales',config.professionals.join(', ')],['Descanso entre turnos',`${config.bufferMinutes} minutos`]]){const pair=node('div');pair.append(node('dt',label),node('dd',value));grid.append(pair);}facts.append(grid);savedInformation.append(facts);
    const messages=section('Mensajes guardados','El asistente usa estos textos al responder por WhatsApp.');messages.append(node('h4','Bienvenida'),node('p',welcomeText(config),'saved-message'),node('h4','Cuando no encuentra información'),node('p',botText(config.bot?.fallback||defaultFallback,config),'saved-message'));savedInformation.append(messages);
    const hours=section('Horarios de atención','Hora de Argentina.');hours.append(node('p',faqAnswer({source:'hours',answer:''},config),'saved-message'));savedInformation.append(hours);
    const services=section('Servicios y precios','Descripción, alcance y precio opcional que el bot comparte con los pacientes.');for(const service of config.services){const row=node('div',undefined,'saved-service'),info=node('div');info.append(node('strong',service.name),node('p',service.description||'Todavía no se agregó una descripción.','saved-service-description'));row.append(info,node('span',`${service.minutes} minutos${service.price?' · '+service.price:' · Sin precio publicado'}`));services.append(row);}savedInformation.append(services);
    const faqs=section('Respuestas guardadas',`${config.faqs.length} preguntas configuradas.`);for(const faq of config.faqs){const row=node('article',undefined,'faq');row.append(node('h3',faq.question),node('p',faqAnswer(faq,config)));faqs.append(row);}savedInformation.append(faqs);
  }
  const byId=id=>root.querySelector(`#${id}`);
  function changed(){dirty=true;state.textContent='Cambios sin guardar';save.disabled=saving;updatePreview();}
  function getConfig() {
    const hours={};for(const row of root.querySelectorAll('.hours-row'))if(row.querySelector('input').checked)hours[row.dataset.day]=[Number(row.querySelector('.hour-open').value),Number(row.querySelector('.hour-close').value)];
    const services=[...root.querySelectorAll('.service-editor')].map(row=>({...(base.services.find(s=>s.id===row.dataset.id)||{}),id:row.dataset.id,name:row.querySelector('.service-name').value.trim(),description:row.querySelector('.service-description').value.trim(),minutes:Number(row.querySelector('.service-minutes').value),price:row.querySelector('.service-price').value.trim()}));
    const faqs=[...root.querySelectorAll('.faq-editor')].map(row=>({question:row.querySelector('.faq-question').value.trim(),keywords:row.querySelector('.faq-keywords').value.split(',').map(k=>k.trim()).filter(Boolean),source:row.querySelector('.faq-source').value,answer:row.querySelector('.faq-answer').value.trim()}));
    return {...base,name:byId('clinic-name').value.trim(),address:byId('clinic-address').value.trim(),professionals:byId('clinic-professionals').value.split('\n').map(p=>p.trim()).filter(Boolean),bufferMinutes:Number(byId('clinic-buffer').value),hours,services,faqs,bot:{...base.bot,welcome:byId('welcome-message').value.trim(),fallback:byId('fallback-message').value.trim()}};
  }
  function updatePreview() {
    if(!base||!byId('welcome-message'))return;
    const draft=getConfig();byId('welcome-preview').textContent=welcomeText(draft);
    for(const row of root.querySelectorAll('.faq-editor')) {
      const answer=row.querySelector('.faq-answer'),source=row.querySelector('.faq-source').value;answer.disabled=source!=='custom';answer.required=source==='custom';
      if(source!=='custom')answer.value=faqAnswer({source,answer:answer.value},draft);
    }
    for(const row of root.querySelectorAll('.hours-row'))row.querySelectorAll('select').forEach(n=>n.disabled=!row.querySelector('input').checked);
  }
  function addService(service={id:`servicio-${crypto.randomUUID().slice(0,8)}`,name:'',minutes:30,price:''}) {
    const row=node('div',undefined,'service-editor');row.dataset.id=service.id;const id=service.id;
    const name=input(`service-name-${id}`,service.name);name.className='service-name';name.required=true;name.maxLength=120;
    const minutes=input(`service-minutes-${id}`,service.minutes,'number');minutes.className='service-minutes';minutes.min=15;minutes.max=240;minutes.required=true;
    const price=input(`service-price-${id}`,service.price);price.className='service-price';price.maxLength=300;
    const description=area(`service-description-${id}`,service.description,4);description.className='service-description';description.maxLength=2000;description.placeholder='Explicá en qué consiste, qué incluye y cualquier información que quieras compartir.';
    const remove=node('button','Quitar','quiet remove-item');remove.type='button';remove.setAttribute('aria-label',`Quitar servicio ${service.name||'nuevo'}`);remove.onclick=()=>{row.remove();changed();};
    const details=field('Descripción y qué incluye',description,'Opcional, hasta 2000 caracteres. El bot usa este texto al explicar el servicio.');details.classList.add('service-description-field');
    row.append(field('Servicio',name),field('Duración (minutos)',minutes),field('Precio (opcional)',price,'Dejalo vacío si no querés publicar un precio.'),remove,details);byId('services-editor').append(row);
  }
  function addFaq(faq={question:'',keywords:[],answer:'',source:'custom'}) {
    const row=node('article',undefined,'faq-editor'),id=crypto.randomUUID().slice(0,8);
    const question=input(`faq-question-${id}`,faq.question);question.className='faq-question';question.required=true;question.maxLength=200;
    const keywords=input(`faq-keywords-${id}`,faq.keywords.join(', '));keywords.className='faq-keywords';keywords.required=true;keywords.maxLength=350;
    const source=node('select');source.id=`faq-source-${id}`;source.className='faq-source';for(const [value,label] of Object.entries(faqSources)){const option=node('option',label);option.value=value;source.append(option);}source.value=faq.source||'custom';
    const answer=area(`faq-answer-${id}`,faq.answer);answer.className='faq-answer';answer.maxLength=2000;
    const remove=node('button','Quitar pregunta','quiet remove-item');remove.type='button';remove.onclick=()=>{row.remove();changed();};
    const top=node('div',undefined,'editor-grid');top.append(field('Pregunta',question),field('Palabras clave, separadas por comas',keywords));
    row.append(top,field('Información para la respuesta',source),field('Respuesta del bot',answer,'Elegí respuesta escrita para redactar tu propio texto.'),remove);byId('faqs-editor').append(row);
  }
  function render(config,force=false,date) {
    latest=config;if(date)updatedAt=date;renderSaved(config);if(!force&&(dirty||signature===JSON.stringify(config)))return;
    base=structuredClone(config);signature=JSON.stringify(config);dirty=false;root.replaceChildren();
    const info=section('Datos de la clínica','El nombre y la dirección se pueden usar en los mensajes del asistente.');const grid=node('div',undefined,'editor-grid');
    const name=input('clinic-name',config.name);name.required=true;name.maxLength=120;const address=input('clinic-address',config.address);address.maxLength=1000;
    grid.append(field('Nombre de la clínica',name),field('Dirección',address));info.append(grid);root.append(info);
    const messages=section('Mensajes del bot','Los cambios se aplican a las próximas respuestas después de guardar.');const greeting=area('welcome-message',config.bot?.welcome||defaultWelcome,5);greeting.required=true;greeting.maxLength=2000;
    const fallback=area('fallback-message',config.bot?.fallback||defaultFallback);fallback.required=true;fallback.maxLength=2000;
    const preview=node('div',undefined,'welcome-preview');preview.append(node('span','Vista previa del saludo','eyebrow'));const text=node('p');text.id='welcome-preview';preview.append(text);
    messages.append(field('Mensaje de bienvenida',greeting,'Usá {nombre_clinica} y {direccion} para insertar los datos de la clínica.'),preview,field('Respuesta cuando no encuentra información',fallback));root.append(messages);
    const schedule=section('Horarios y equipo','Estos horarios determinan la disponibilidad de los turnos.');const hours=node('div',undefined,'hours-editor');hours.id='hours-editor';
    for(const [day,label] of [[1,'Lunes'],[2,'Martes'],[3,'Miércoles'],[4,'Jueves'],[5,'Viernes'],[6,'Sábado'],[0,'Domingo']]){
      const row=node('div',undefined,'hours-row');row.dataset.day=day;const check=input(`open-day-${day}`,'','checkbox');check.checked=!!config.hours[day];
      const open=hourSelect(`open-time-${day}`,config.hours[day]?.[0]??9);open.className='hour-open';const close=hourSelect(`close-time-${day}`,config.hours[day]?.[1]??18,true);close.className='hour-close';
      row.append(field(label,check),field('Apertura',open),field('Cierre',close));hours.append(row);
    }
    const people=area('clinic-professionals',config.professionals.join('\n'));people.required=true;const buffer=input('clinic-buffer',config.bufferMinutes,'number');buffer.min=0;buffer.max=120;buffer.required=true;
    const team=node('div',undefined,'editor-grid');team.append(field('Profesionales',people,'Un nombre por línea. Cada nombre tiene su propia disponibilidad.'),field('Descanso entre turnos (minutos)',buffer));schedule.append(hours,team);root.append(schedule);
    const services=section('Servicios, descripción y precios','Explicá qué significa cada servicio y qué incluye. El precio es opcional; la duración determina los horarios disponibles.');const serviceList=node('div');serviceList.id='services-editor';services.append(serviceList);root.append(services);config.services.forEach(addService);
    const add=node('button','+ Agregar servicio','quiet add-item');add.type='button';add.onclick=()=>{addService();changed();};services.append(add);
    const faqs=section('Preguntas y respuestas','Las palabras clave permiten reconocer la consulta. Dirección, horarios y servicios pueden usar los datos de arriba automáticamente.');const faqList=node('div');faqList.id='faqs-editor';faqs.append(faqList);root.append(faqs);config.faqs.forEach(addFaq);
    const addQuestion=node('button','+ Agregar pregunta','quiet add-item');addQuestion.type='button';addQuestion.onclick=()=>{addFaq();changed();};faqs.append(addQuestion);
    state.textContent='Todos los cambios guardados';save.disabled=true;updatePreview();
  }
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  document.getElementById('edit-bot-info').onclick=()=>{if(latest&&!dirty)render(latest,true);setEditing(true);};
  document.getElementById('config-discard').onclick=()=>{if(latest)render(latest,true);setEditing(false);};
  form.onsubmit=async event=>{event.preventDefault();if(saving||!base)return;saving=true;save.disabled=true;state.textContent='Guardando…';try{const next=getConfig(),result=await onSave(next);render(result?.config||next,true,result?.updatedAt);state.textContent='Información guardada. El bot ya usa estos datos.';setEditing(false);}catch(error){state.textContent=error.message;onNotice(error.message);}finally{saving=false;save.disabled=!dirty;}};
  return {render,getConfig,clear(){root.replaceChildren();savedInformation.replaceChildren();base=latest=undefined;signature=savedSignature='';dirty=false;updatedAt=undefined;state.textContent='';setEditing(false);},isDirty:()=>dirty,isEditing:()=>editing};
}
