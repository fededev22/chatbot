const $=id=>document.getElementById(id);
export function createAIControl({api,onNotice}) {
  let owner=false,dirty=false,busy=false,epoch=0;
  const defaults={nvidia:'meta/llama-3.1-8b-instruct',openrouter:'openrouter/free'};
  function showStatus(data){$('ai-status').textContent=`${data.configured?'Clave guardada':'Sin clave de API'} · ${data.provider==='nvidia'?'NVIDIA NIM':'OpenRouter'} · ${data.model}.`;$('ai-key').placeholder=data.configured?'Dejá vacío para conservar la clave guardada.':'Pegá la clave aquí';}
  async function refresh(){if(!owner)return;const version=epoch;try{const data=await api('ai');if(version!==epoch)return;showStatus(data);if(!dirty){$('ai-provider').value=data.provider;$('ai-model').value=data.model;}}catch(error){if(version===epoch)onNotice(error.message);}}
  $('ai-provider').onchange=()=>{$('ai-model').value=defaults[$('ai-provider').value];$('ai-key').value='';dirty=true;};
  $('ai-form').oninput=()=>{dirty=true;};
  $('ai-form').onsubmit=async event=>{event.preventDefault();if(!owner||busy)return;busy=true;const version=epoch,key=$('ai-key').value;$('ai-key').value='';$('ai-save').disabled=true;try{const data=await api('ai',{provider:$('ai-provider').value,model:$('ai-model').value,key,enabled:false});if(version!==epoch)return;dirty=false;showStatus(data);onNotice('Proveedor guardado en este servidor.');}catch(error){if(version===epoch)onNotice(error.message);}finally{busy=false;$('ai-save').disabled=false;}};
  return {refresh,setUser(user){owner=user.role==='owner';$('ai-settings-section').classList.toggle('hidden',!owner);},clear(){epoch++;owner=dirty=false;$('ai-key').value='';$('ai-status').textContent='';$('ai-settings-section').classList.add('hidden');}};
}