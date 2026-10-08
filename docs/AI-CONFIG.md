# IA: configuración para desarrollo

El panel es exclusivamente para el negocio: conversaciones, turnos, información de la clínica y cuentas. No contiene controles de proveedor de IA, modelos ni claves. Las rutas `/api/ai`, `/api/chat` y `/ai-panel.js` no están disponibles.

La implementación de NVIDIA NIM y OpenRouter permanece en `ai.mjs`, con pruebas aisladas en `test/ai.test.mjs`. `createAISettings` carga y valida la configuración privada del servidor; `createTestChat` permite evaluaciones con datos sintéticos. El servidor de WhatsApp no importa estas funciones ni envía conversaciones de pacientes a proveedores externos.

## Archivo privado

Las credenciales ya guardadas permanecen en `data/ai.json`. Este archivo queda excluido de Git; ni un commit ni un despliegue desde GitHub lo copian. Si necesitás cambiarlo, editá el archivo únicamente en el servidor. Ejemplo sin credencial:

```json
{
  "provider": "nvidia",
  "model": "meta/llama-3.1-8b-instruct",
  "key": "",
  "enabled": false
}
```

Para OpenRouter, el proveedor es `openrouter` y el modelo inicial `openrouter/free`. La clave debe permanecer en el archivo privado, sin pegarla en chats, documentación o comandos que queden en el historial. Conservá `enabled: false` salvo durante una evaluación aislada con datos sintéticos. Cambiar este archivo no activa IA en WhatsApp.

GitHub contiene el código y estas instrucciones, nunca las credenciales. La visibilidad del código depende de la configuración del repositorio en GitHub. Si una clave fue compartida en un chat o publicada, revocala desde el proveedor y reemplazala por una nueva.
