export async function checkWhatsAppConnection(env,request=fetch) {
  const at=new Date().toISOString();
  if(!env.WHATSAPP_TOKEN||!env.WHATSAPP_PHONE_ID||!env.META_APP_SECRET||!env.WEBHOOK_VERIFY_TOKEN) return {state:'unconfigured',note:'WhatsApp todavía no está configurado.',checkedAt:at};
  try {
    const response=await request(`https://graph.facebook.com/${env.GRAPH_VERSION||'v25.0'}/${env.WHATSAPP_PHONE_ID}?fields=id`,{headers:{authorization:`Bearer ${env.WHATSAPP_TOKEN}`},signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    if(!response.ok) return {state:data.error?.code===190?'expired':'error',note:data.error?.code===190?'El acceso de WhatsApp venció. Renová el token en Meta para volver a responder.':'Meta no permite usar esta conexión. Revisá los permisos y el número de WhatsApp.',checkedAt:at};
    if(!env.WEBHOOK_PUBLIC_URL)return {state:'unreachable',note:'Falta conectar la recepción de mensajes de WhatsApp.',checkedAt:at};
    const callback=new URL(env.WEBHOOK_PUBLIC_URL);if(callback.protocol!=='https:')throw Error('Callback inválido');
    callback.searchParams.set('hub.mode','subscribe');callback.searchParams.set('hub.verify_token',env.WEBHOOK_VERIFY_TOKEN);callback.searchParams.set('hub.challenge','connection-health');
    try {
      const webhook=await request(callback,{signal:AbortSignal.timeout(10000)});
      if(!webhook.ok||await webhook.text()!=='connection-health')throw Error('Webhook no disponible');
    } catch {return {state:'unreachable',note:'El acceso a WhatsApp está activo, pero la conexión para recibir mensajes no responde. Restablecé el túnel y el webhook.',checkedAt:at};}
    return {state:'connected',note:'Acceso y recepción de mensajes de WhatsApp verificados.',checkedAt:at};
  } catch {return {state:'error',note:'No se pudo comprobar WhatsApp. Revisá la conexión a Internet.',checkedAt:at};}
}
