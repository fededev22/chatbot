import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {createRecipientResolver} from '../whatsapp.mjs';
const env = process.env;
async function graph(path, token, method = 'GET', body) {
  const res = await fetch(`https://graph.facebook.com/${env.GRAPH_VERSION || 'v25.0'}/${path}`, {
    method, headers:{authorization:`Bearer ${token}`, ...(body ? {'content-type':'application/json'} : {})},body:body ? JSON.stringify(body) : undefined,signal:AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Meta HTTP ${res.status}, código ${json.error?.code || 'desconocido'}, subcódigo ${json.error?.error_subcode || '-'}: ${(json.error?.message || '').replace(/EA[A-Za-z0-9]{30,}/g,'[TOKEN OCULTO]').slice(0,300)}`);
  return json;
}
if (!env.META_APP_ID || !env.WHATSAPP_BUSINESS_ID || !env.META_APP_SECRET || !env.WHATSAPP_TOKEN) {
  throw new Error('Faltan IDs o credenciales de Meta en .env');
}
const results = await Promise.allSettled([
  graph(`${env.META_APP_ID}/subscriptions`, `${env.META_APP_ID}|${env.META_APP_SECRET}`),
  graph(`${env.WHATSAPP_BUSINESS_ID}/subscribed_apps`, env.WHATSAPP_TOKEN),
]);
for (const [index, result] of results.entries()) {
  if (result.status === 'rejected') console.log(JSON.stringify({query:index === 0 ? 'app' : 'waba', error:result.reason.message}));
}
const subscriptions = results[0].status === 'fulfilled' ? results[0].value : {};
let accounts = results[1].status === 'fulfilled' ? results[1].value : null;
if (process.argv.includes('--subscribe') && accounts && !accounts.data?.some(a => a.whatsapp_business_api_data?.id === env.META_APP_ID)) {
  const added = await graph(`${env.WHATSAPP_BUSINESS_ID}/subscribed_apps`, env.WHATSAPP_TOKEN, 'POST');
  if (!added.success) throw new Error('Meta no confirmó la suscripción de la cuenta.');
  accounts = await graph(`${env.WHATSAPP_BUSINESS_ID}/subscribed_apps`, env.WHATSAPP_TOKEN);
}
const wa = subscriptions.data?.find(s => s.object === 'whatsapp_business_account');
console.log(JSON.stringify({
  appWebhookActive:wa?.active || false,
  callbackMatches:wa?.callback_url === env.WEBHOOK_PUBLIC_URL,
  messagesSubscribed:wa?.fields?.some(f => f.name === 'messages') || false,
  wabaSubscribed:accounts ? accounts.data?.some(a => a.whatsapp_business_api_data?.id === env.META_APP_ID) || false : null,
},null,2));
const sendPending = process.argv.includes('--send-pending');
const db = new DatabaseSync(fileURLToPath(new URL('../data/clinic.sqlite',import.meta.url)), {readOnly:!sendPending});
if (sendPending) {
  const item = db.prepare("SELECT * FROM outbox WHERE session LIKE 'wa:%' AND status='pending' AND next_try>? ORDER BY created LIMIT 1").get(Date.now()+30000);
  if (!item || item.template) throw new Error('No hay una respuesta de texto pendiente con margen para reintentar.');
  const claimed = db.prepare("UPDATE outbox SET status='diagnosing' WHERE id=? AND status='pending' AND next_try>?").run(item.id,Date.now()+30000);
  if (!claimed.changes) throw new Error('La cola cambió; no se reenvía.');
  try {
    await graph(`${env.WHATSAPP_PHONE_ID}/messages`,env.WHATSAPP_TOKEN,'POST',{messaging_product:'whatsapp',to:createRecipientResolver(env.WHATSAPP_RECIPIENT_OVERRIDES)(item.session.slice(3)),type:'text',text:{body:item.text}});
    db.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(item.id);
    console.log('Respuesta pendiente aceptada por Meta.');
  } catch (error) {
    db.prepare("UPDATE outbox SET status='pending',next_try=?,attempts=attempts+1 WHERE id=?").run(Date.now()+120000,item.id);
    console.log(JSON.stringify({deliveryError:error.message}));
  }
}
console.log(JSON.stringify({
  receivedEvents:db.prepare('SELECT count(*) AS n FROM webhooks').get().n,
  whatsappOutbox:db.prepare("SELECT status,count(*) AS n FROM outbox WHERE session LIKE 'wa:%' GROUP BY status").all(),
}));
db.close();
