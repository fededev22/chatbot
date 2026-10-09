# IA: configuración para desarrollo

El panel es exclusivamente para el negocio: conversaciones, turnos, información de la clínica y cuentas. No contiene controles de proveedor de IA, modelos ni claves. Las rutas `/api/ai`, `/api/chat` y `/ai-panel.js` no están disponibles.

`ai.mjs` administra las credenciales privadas de NVIDIA NIM y OpenRouter. `conversation-ai.mjs` conecta la conversación de WhatsApp al modelo, conserva contexto breve y deja las reservas bajo control del servidor. `createTestChat` también permite evaluaciones aisladas. La integración está cubierta por `test/ai.test.mjs` y `test/conversation-ai.test.mjs`.

## Archivo privado

Las credenciales ya guardadas permanecen en `data/ai.json`. Este archivo queda excluido de Git; ni un commit ni un despliegue desde GitHub lo copian. Si necesitás cambiarlo, editá el archivo únicamente en el servidor. Ejemplo sin credencial:

```json
{
  "provider": "nvidia",
  "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
  "key": "",
  "enabled": false
}
```

Para OpenRouter, el proveedor es `openrouter` y el modelo inicial `openrouter/free`. La clave debe permanecer en el archivo privado, sin pegarla en chats, documentación o comandos que queden en el historial. Para activar IA, configurá `enabled: true` y el modo correspondiente en `.env`, y reiniciá el servidor.

## Prueba por WhatsApp con NVIDIA

En `.env`, configurá `AI_WHATSAPP_MODE=trial` y `AI_TEST_RECIPIENTS` con los números de los participantes autorizados, solo dígitos y separados por coma. No publiques números reales. Solo esos remitentes usan el modelo; el resto recibe respuestas del motor local. Usá datos ficticios durante las pruebas. La [API gratuita de NVIDIA es para pruebas y prototipos](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf), no para atención de pacientes en producción.

El modelo anterior `meta/llama-3.1-8b-instruct` devolvía HTTP 410 durante la verificación. Se reemplazó por el modelo vigente del catálogo [Nemotron 3.5 Lightning](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/build), con razonamiento desactivado para obtener una respuesta breve dentro del límite de tokens.

## Operación

El webhook registra y deduplica cada entrada antes de responder a Meta. La generación de IA corre fuera de las transacciones SQLite; los trabajos pendientes y preparados se recuperan al reiniciar. Los mensajes de una conversación se procesan en orden. Pausar el bot cancela las respuestas que todavía se están preparando.

La IA recibe la consulta actual, hasta cuatro intercambios recientes y la información configurada de la clínica. No se envía el historial antiguo del panel. Se omiten teléfonos, correos y nombres conocidos de la conversación; la identidad, las listas de turnos propios y las confirmaciones se procesan localmente. El enmascaramiento no garantiza detectar todo dato sensible: no ingreses datos reales de pacientes en la prueba. Las consultas clínicas reconocidas se derivan a recepción sin llamar al modelo.

Para una instalación de producción, se admite `AI_WHATSAPP_MODE=production` con OpenRouter; NVIDIA gratuita queda bloqueada en ese modo. La selección de modelo, condiciones de uso y tratamiento de datos deben corresponder al despliegue. OpenRouter se solicita con `data_collection: deny` y `zdr: true`; si no tiene un proveedor compatible, se usa la respuesta local.

El modelo conversa con naturalidad y no recibe herramientas para modificar turnos. Las confirmaciones, la identidad y la disponibilidad las valida el motor local. Si falla la API, vence el plazo de 20 segundos o se descarta una respuesta, se usa una alternativa local sin menús de comandos. El diagnóstico queda en `conversation_jobs.error`, dentro de la base privada; no muestra claves ni el cuerpo del error del proveedor.

GitHub contiene el código y estas instrucciones, nunca las credenciales. La visibilidad del código depende de la configuración del repositorio en GitHub. Si una clave fue compartida en un chat o publicada, revocala desde el proveedor y reemplazala por una nueva.
