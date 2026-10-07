import {createSettingsEditor} from './settings.js';
import {faqAnswer} from './bot-info.js';
import {createAccountAccess} from './accounts.js';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const legacyKey=sessionStorage.getItem('admin-token')||'';
let token=false,csrf='',accountAccess,dashboard,selected=null,filter='all',refreshing=false,authEpoch=0,detailVersion=0,history=[],hasMore=false,historySignature='',acting=false;
const drafts=new Map(),readIds=new Map();
const labels={confirmed:'Confirmado',cancelled:'Cancelado',rescheduled:'Reprogramado',cancelled_send:'Descartado',pending:'En cola',sent:'Aceptado por WhatsApp',delivered:'Entregado',read:'Leído',failed:'Falló el envío',blocked_window:'Fuera de las 24 horas',blocked_template:'Falta plantilla',obsolete:'Recordatorio descartado',diagnosing:'Comprobando envío'};
const date=s=>new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
const time=s=>new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',minute:'2-digit'}).format(new Date(s));
const service=id=>dashboard?.config.services.find(s=>s.id===id)?.name||id;
const notice=text=>$('notice').textContent=text;
const settingsEditor=createSettingsEditor({onSave:async next=>{const result=await api('config',next);if(dashboard){dashboard.config=result.config;dashboard.configUpdatedAt=result.updatedAt;}await refresh();notice('Información del bot guardada.');return result;},onNotice:notice,onModeChange:editing=>{if(!$('settings').classList.contains('hidden')){$('title').textContent=editing?'Editar información del bot':'Información del bot';$('subtitle').textContent=editing?'Modificá los datos y guardá los cambios.':'Datos guardados que el asistente usa en WhatsApp.';}}});
function lock(error='') {
  authEpoch++;detailVersion++;token=false;csrf='';dashboard=undefined;selected=null;history=[];drafts.clear();readIds.clear();
  accountAccess?.clear();$('app').classList.add('hidden');$('login').classList.remove('hidden');$('login-error').textContent=error;
  for(const id of ['conversation-list','chat-log','appointment-rows','faq-list','delivery-list','patient-appointments'])$(id).replaceChildren();
  settingsEditor.clear();delete $('faq-list').dataset.signature;$('reply').value='';$('contact-name').textContent='';$('contact-phone').textContent='';$('access-password').value='';
}
async function api(path,data) {
  const epoch=authEpoch;
  const r=await fetch(`/api/${path}`,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(15000)});
  const result=await r.json();if(epoch!==authEpoch)throw Error('La sesión cambió.');
  if(!r.ok){if(r.status===401){lock(result.error);void accountAccess.init(result.error);throw Error(result.error);}throw Error(result.error||'No se pudo completar la operación.');}return result;
}
function show(view) {
  if(view==='accounts')void accountAccess.refreshAccounts();
  document.querySelectorAll('.view').forEach(n=>n.classList.toggle('hidden',n.id!==view));document.querySelectorAll('.nav').forEach(n=>{n.classList.toggle('active',n.dataset.view===view);n.setAttribute('aria-current',n.dataset.view===view?'page':'false');});
  $('title').textContent={inbox:'Conversaciones',appointments:'Agenda de turnos',knowledge:'Respuestas del bot',settings:settingsEditor.isEditing()?'Editar información del bot':'Información del bot',accounts:'Cuentas del equipo'}[view];
  $('subtitle').textContent={inbox:'Seguí la atención de tus pacientes en WhatsApp.',appointments:'Reservas, cambios y confirmaciones de tus pacientes.',knowledge:'Información que la clínica comparte por WhatsApp.',settings:settingsEditor.isEditing()?'Modificá los datos y guardá los cambios.':'Datos guardados que el asistente usa en WhatsApp.',accounts:'Administrá los accesos al panel del negocio.'}[view];
}
function renderList() {
  if(!dashboard)return;const query=$('search').value.trim().toLocaleLowerCase('es');
  const sessions=dashboard.sessions.filter(s=>(filter==='all'||filter==='unread'&&s.unread>0||filter==='issues'&&s.issues>0||s.status===filter)&&`${s.name} ${s.phone} ${s.last?.text||''}`.toLocaleLowerCase('es').includes(query));$('conversation-list').replaceChildren();
  for(const s of sessions) {
    const button=el('button',undefined,`conversation-row${s.id===selected?' selected':''}`);button.setAttribute('aria-pressed',String(s.id===selected));const avatar=el('span',s.name.startsWith('+')?'P':s.name.slice(0,1).toUpperCase(),'contact-avatar'),content=el('span',undefined,'row-content'),top=el('span',undefined,'row-top');top.append(el('strong',s.name),el('time',time(s.last?.at||s.updated)));
    const foot=el('span',undefined,'row-foot');foot.append(el('span',s.stage,`status-text ${s.status}`));if(s.unread)foot.append(el('span',s.unread,'unread-count'));if(s.issues)foot.append(el('span','!','issue-count'));
    content.append(top,el('span',`${s.last?.role==='user'?'Paciente':s.last?.role==='human'?'Recepción':'Bot'}: ${s.last?.text||'Sin mensajes'}`,'row-preview'),foot);button.append(avatar,content);button.onclick=()=>selectConversation(s.id);$('conversation-list').append(button);
  }
  if(!sessions.length){const empty=el('div',undefined,'list-empty');empty.append(el('strong',dashboard.sessions.length?'Sin coincidencias':'Todavía no hay conversaciones'),el('p',dashboard.sessions.length?'Probá otra búsqueda o filtro.':'Los mensajes recibidos por WhatsApp aparecerán aquí.'));$('conversation-list').append(empty);}
  $('list-count').textContent=`${sessions.length} visibles · ${dashboard.metrics.conversations} en total${dashboard.metrics.conversations>dashboard.limit?' · últimas 100 conversaciones':''}`;
}
async function selectConversation(id) {
  if(selected)drafts.set(selected,$('reply').value);if(selected!==id){selected=id;detailVersion++;history=[];historySignature='';$('chat-log').replaceChildren();$('reply').value=drafts.get(id)||'';$('activity').open=false;}
  $('inbox').classList.add('detail-open');renderList();renderContact();try{await refreshDetail();}catch(e){if(token)notice(e.message);}
}
function renderContact() {
  const s=dashboard?.sessions.find(s=>s.id===selected);$('no-selection').classList.toggle('hidden',!!s);$('selected-detail').classList.toggle('hidden',!s);if(!s)return;
  $('contact-name').textContent=s.name;$('contact-phone').textContent=`+${s.phone} · WhatsApp`;$('contact-avatar').textContent=s.name.startsWith('+')?'P':s.name.slice(0,1).toUpperCase();$('contact-stage').textContent=s.stage;$('contact-stage').className=`state ${s.status}`;
  $('booking-progress').textContent=[s.state.service?service(s.state.service):'',s.state.day,s.state.time].filter(Boolean).join(' · ');$('takeover').textContent=s.state.paused?'Reactivar bot':'Tomar atención';$('takeover').disabled=acting;
  const lastPatient=history.filter(m=>m.role==='user').at(-1),openWindow=lastPatient&&Date.now()-new Date(lastPatient.at)<24*3600000,canReply=s.state.paused&&dashboard.whatsapp&&openWindow&&!acting;
  $('reply').disabled=!canReply;$('send').disabled=!canReply;$('reply').placeholder=s.state.paused?'Escribí una respuesta de recepción…':'Tomá la atención para responder…';
  $('reply-hint').textContent=!dashboard.whatsapp?'WhatsApp no está configurado.':!openWindow?'Para responder, el paciente debe haber escrito en las últimas 24 horas.':s.state.paused?'Recepción está atendiendo. El bot permanece pausado.':'El asistente está atendiendo. Tomá la conversación para responder.';
}
function renderHistory() {
  const signature=JSON.stringify(history)+hasMore;if(signature===historySignature)return;const log=$('chat-log'),bottom=log.scrollHeight-log.scrollTop-log.clientHeight<70,first=historySignature==='',oldHeight=log.scrollHeight,oldTop=log.scrollTop;log.replaceChildren();
  if(hasMore){const b=el('button','Cargar mensajes anteriores','load-earlier');b.onclick=loadEarlier;log.append(b);}let day='';
  for(const m of history){const current=new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',dateStyle:'medium'}).format(new Date(m.at));if(day!==current){day=current;log.append(el('div',current,'day-divider'));}
    const bubble=el('article',undefined,`bubble ${m.role}`),meta=el('div',undefined,'bubble-meta');meta.append(el('strong',m.role==='user'?'Paciente':m.role==='human'?'Recepción':m.role==='reminder'?'Recordatorio':'Asistente'),el('time',time(m.at)));bubble.append(meta,el('p',m.text));if(m.status)bubble.append(el('small',labels[m.status]||m.status,`message-status ${['failed','blocked_window','blocked_template'].includes(m.status)?'error':''}`));log.append(bubble);
  }
  if(!history.length)log.append(el('p','Sin mensajes registrados.','empty'));historySignature=signature;log.scrollTop=first||bottom?log.scrollHeight:oldTop+(log.scrollHeight-oldHeight);
}
function mergeHistory(messages) {const map=new Map(history.map(m=>[m.id,m]));messages.forEach(m=>map.set(m.id,m));history=[...map.values()].sort((a,b)=>a.id-b.id);}
async function refreshDetail() {
  if(!selected)return;const id=selected,version=++detailVersion,detail=await api(`conversation?session=${encodeURIComponent(id)}`);if(id!==selected||version!==detailVersion)return;
  const hadEarlier=history.length&&history[0].id<detail.before;mergeHistory(detail.messages);if(!hadEarlier)hasMore=detail.hasMore;renderHistory();renderContact();renderActivity(detail);
  const latest=history.filter(m=>m.role==='user').at(-1);if(latest&&latest.id>(readIds.get(id)||0)&&!$('inbox').classList.contains('hidden')&&document.visibilityState==='visible'){
    await api('read',{session:id,messageId:latest.id});readIds.set(id,latest.id);const s=dashboard.sessions.find(s=>s.id===id);if(s?.unread){s.unread=0;dashboard.metrics.unread=Math.max(0,dashboard.metrics.unread-1);renderMetrics();renderList();}
  }
}
async function loadEarlier() {
  const id=selected,before=history[0]?.id,version=detailVersion;if(!id||!before)return;try{const d=await api(`conversation?session=${encodeURIComponent(id)}&before=${before}`);if(id!==selected||version!==detailVersion)return;const height=$('chat-log').scrollHeight,top=$('chat-log').scrollTop;mergeHistory(d.messages);hasMore=d.hasMore;renderHistory();$('chat-log').scrollTop=top+$('chat-log').scrollHeight-height;}catch(e){notice(e.message);}
}
function renderActivity(d) {
  $('patient-appointments').replaceChildren(el('h3','Turnos del paciente'));for(const a of d.appointments)$('patient-appointments').append(el('p',`${service(a.service)} · ${date(a.start)} · ${labels[a.status]||a.status}`));if(!d.appointments.length)$('patient-appointments').append(el('p','Sin reservas registradas.'));
  $('delivery-list').replaceChildren(el('h3','Últimos envíos'));for(const o of d.outbox){const row=el('div',undefined,'delivery-row');row.append(el('p',o.text),el('span',`${date(o.created)} · ${labels[o.status]||o.status}`,'muted'));if(o.last_error)row.append(el('small',o.last_error,'error'));$('delivery-list').append(row);}if(!d.outbox.length)$('delivery-list').append(el('p','Sin envíos registrados.'));
}
function renderMetrics() {for(const key of ['conversations','unread','handoffs','bookings'])$(`metric-${key}`).textContent=dashboard.metrics[key];$('badge').textContent=dashboard.metrics.handoffs;}
function renderAgenda() {
  $('appointment-rows').replaceChildren();for(const a of dashboard.appointments){const row=el('tr');row.append(el('td',a.name),el('td',service(a.service)),el('td',date(a.start)),el('td',a.professional));const status=el('td');status.append(el('span',`${labels[a.status]||a.status}${a.attendance?' · Asistirá':''}`,'state'));const cell=el('td'),link=el('button','Ver chat ↗','quiet');link.onclick=()=>{show('inbox');selectConversation(a.session);};cell.append(link);row.append(status,cell);$('appointment-rows').append(row);}
  if(!dashboard.appointments.length){const row=el('tr'),cell=el('td','Todavía no hay turnos reservados por WhatsApp.');cell.colSpan=6;row.append(cell);$('appointment-rows').append(row);}
}
async function refresh() {
  if(!token||refreshing)return;refreshing=true;const epoch=authEpoch;try{
    const d=await api('dashboard');if(epoch!==authEpoch)return;if(dashboard?.configUpdatedAt&&d.configUpdatedAt<dashboard.configUpdatedAt){d.config=dashboard.config;d.configUpdatedAt=dashboard.configUpdatedAt;}dashboard=d;$('app').classList.remove('hidden');$('login').classList.add('hidden');$('business-name').textContent=d.config.name;
    $('connection').textContent={connected:'WhatsApp activo',checking:'Comprobando WhatsApp',expired:'Acceso vencido',unreachable:'Recepción sin conexión',error:'Revisar conexión',unconfigured:'WhatsApp sin configurar'}[d.connection?.state]||'WhatsApp configurado';
    $('connection-detail').textContent=d.connection?.note||'';$('connection-detail').classList.toggle('connection-issue',['expired','unreachable','error','unconfigured'].includes(d.connection?.state));
    const connectionIssue=['expired','unreachable','error','unconfigured'].includes(d.connection?.state);$('connection-alert').textContent=connectionIssue?d.connection.note:'';$('connection-alert').classList.toggle('hidden',!connectionIssue);
    renderMetrics();renderList();renderContact();renderAgenda();
    settingsEditor.render(d.config,false,d.configUpdatedAt);const faqSignature=JSON.stringify(d.config);if($('faq-list').dataset.signature!==faqSignature){$('faq-list').dataset.signature=faqSignature;$('faq-list').replaceChildren();for(const f of d.config.faqs){const item=el('article',undefined,'faq');item.append(el('h3',f.question),el('p',faqAnswer(f,d.config)));$('faq-list').append(item);}}
    await refreshDetail();$('sync').textContent=`Actualizado ${time(d.updatedAt)} · cada 5 s`;$('sync').parentElement.classList.remove('offline');
  }catch(e){if(token){$('sync').textContent='Sin actualizar · reintentando';$('sync').parentElement.classList.add('offline');notice('No se pudo actualizar el panel. '+e.message);}}finally{refreshing=false;}
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{show(b.dataset.view);if(b.dataset.view==='inbox')refreshDetail().catch(e=>notice(e.message));});
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(n=>n.classList.toggle('active',n===b));renderList();});$('search').oninput=renderList;$('back-list').onclick=()=>$('inbox').classList.remove('detail-open');
$('takeover').onclick=async()=>{if(acting||!selected)return;acting=true;renderContact();try{await api('human',{session:selected,action:dashboard.sessions.find(s=>s.id===selected).state.paused?'resume':'pause'});await refresh();notice('Estado de atención actualizado.');}catch(e){notice(e.message);}finally{acting=false;renderContact();}};
$('reply').oninput=()=>drafts.set(selected,$('reply').value);
$('reply-form').onsubmit=async e=>{e.preventDefault();if(acting||!selected)return;acting=true;renderContact();const id=selected,text=$('reply').value;try{await api('human',{session:id,action:'reply',text});drafts.delete(id);if(selected===id)$('reply').value='';await refresh();notice('Respuesta en cola de envío a WhatsApp.');}catch(err){notice(err.message);}finally{acting=false;renderContact();}};
accountAccess=createAccountAccess({legacyKey,api,onNotice:notice,onLocked:lock,onAuthenticated:async result=>{authEpoch++;token=true;csrf=result.csrf;accountAccess.setUser(result.user);show('inbox');await refresh();}});
$('logout').onclick=$('mobile-logout').onclick=()=>accountAccess.logout();$('refresh').onclick=()=>{notice('');refresh();};
$('export').onclick=()=>{const fields=['id','name','phone','service','professional','start','status'],cell=x=>'"'+String(x??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"',csv='\uFEFF'+[fields,...dashboard.appointments.map(a=>fields.map(f=>a[f]))].map(row=>row.map(cell).join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=el('a');a.href=url;a.download='turnos-whatsapp.csv';a.click();URL.revokeObjectURL(url);};
$('today').textContent=new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'numeric',month:'long'}).format(new Date());
void accountAccess.init();
let lastActivity=0;for(const event of ['pointerdown','keydown'])document.addEventListener(event,()=>{if(token&&Date.now()-lastActivity>60000){lastActivity=Date.now();void api('auth/activity',{}).catch(()=>{});}}, {passive:true});
setInterval(()=>{if(token&&!acting&&document.visibilityState==='visible')refresh();},5000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&token)refresh();});
