# Chatbot para una clínica dental

Demo funcional de recepción en español, con agenda local persistente y adaptador de WhatsApp Cloud API. Los datos iniciales son ejemplos: falta el nombre, dirección, horarios, profesionales y servicios reales de la clínica.

## Ejecutar

Necesitás Node.js 24 o posterior. No hay dependencias ni instalación de paquetes.

```powershell
npm start
```

Abrí **http://127.0.0.1:3000** en el navegador de tu computadora. Para verificar la lógica:

```powershell
npm test
```

1. Configurá `ADMIN_TOKEN` en `.env` (copiá `.env.example` si todavía no existe). Es la clave privada de instalación y autoriza únicamente la creación de la primera cuenta.
2. Creá la cuenta administradora con correo, teléfono internacional, contraseña personal de 15 a 128 caracteres y CAPTCHA. Después ingresá con correo, contraseña y CAPTCHA. La clave anterior ya no da acceso a las APIs del panel. El panel es exclusivamente para el equipo del negocio; los pacientes escriben por WhatsApp.
3. En **Conversaciones**, buscá por nombre, teléfono o último mensaje. Filtrá las últimas 100 conversaciones por mensajes sin leer, recepción, reservas en curso o incidencias.
4. Elegí una conversación para ver su historial y avance. Se actualiza cada 5 segundos; permite cargar mensajes anteriores de a 80. La lectura del panel se guarda por clínica, compartida entre quienes usan la misma clave; no marca leído en WhatsApp.
5. El historial es exclusivamente de seguimiento: no hay un cuadro para escribir ni enviar mensajes desde el panel. Usá **Pausar bot** para gestionar el contacto por el canal de recepción de la clínica; **Reactivar bot** retoma la reserva pendiente.
6. Revisá la agenda y exportá los turnos. El panel excluye sesiones y reservas del simulador; los datos anteriores permanecen guardados.
7. En **Configuración**, se muestra la información guardada y su fecha de actualización. Pulsá **Editar** para modificar nombre, dirección, saludo, respuesta alternativa, horarios, profesionales, servicios, precios y preguntas frecuentes. **Guardar cambios** vuelve a la vista de los datos actualizados; **Cancelar edición** descarta el borrador. No hace falta editar JSON ni reiniciar; los mensajes siguientes usan la información guardada. Las respuestas de dirección, horarios, servicios, precios y duración pueden vincularse a los datos del negocio o escribirse manualmente.
8. El panel comprueba el acceso de Meta y la recepción por HTTPS cada 90 segundos. Muestra un aviso si el token vence o el webhook deja de responder; no basta con tener credenciales guardadas.
9. La cuenta administradora tiene **Cuentas del equipo**. Puede crear invitaciones privadas de un solo uso, que vencen en 24 horas y reservan un cupo. Cada invitado elige su contraseña. Hay como máximo 3 cuentas registradas, contando invitaciones pendientes; las cuentas bloqueadas también ocupan un cupo. Podés cancelar una invitación pendiente para liberar ese cupo. Bloquear una cuenta cierra su sesión; habilitarla permite volver a iniciar sesión.

## Qué funciona

- 15 FAQs configurables y respuesta prudente cuando no hay información.
- Frases naturales para reservar: «quiero una limpieza mañana a las 10», fechas como «el viernes» o «08/10/2026» y horarios como «a las 3 de la tarde».
- Consultas de precio y duración con contexto del servicio; preguntas durante la reserva conservan los datos pendientes. «Me llamo Ana Pérez» y respuestas «sí» / «no gracias» para recordatorios.
- Reserva, reprogramación y cancelación con confirmación explícita.
- Validación de disponibilidad en SQLite, duración y descansos por profesional.
- Horarios de Argentina; fechas futuras hasta 90 días. Fines de semana cerrados por defecto.
- Nombre, teléfono, servicio, profesional, fecha, estado y consentimiento.
- Derivación, pausa y reactivación del bot; historial de seguimiento para el negocio.
- Recordatorios a 24 h y 2 h, con consentimiento, y confirmación de asistencia.
- Métricas reales básicas, exportación CSV y bandeja de envíos.
- Webhook con firma HMAC, deduplicación persistente y cola de salida con reintentos.
- No descarga adjuntos ni procesa audios o imágenes. Omite del historial los mensajes con palabras clínicas reconocidas.

## Alcance y límites

WhatsApp usa interpretación local de frases y una agenda local, **sin Google Calendar**. Reconoce solicitudes de turnos, servicios configurados, fechas y horas habituales; responde consultas con los datos guardados por la clínica y mantiene el contexto del servicio. La IA externa todavía no está conectada a WhatsApp. El panel no incluye chat de prueba ni envío manual de mensajes. Ante una pregunta desconocida el motor local usa la respuesta alternativa editable. Las fechas se muestran explícitamente antes de confirmar; «el viernes» se interpreta como la próxima ocurrencia, incluido hoy si es viernes. El contenido médico no debe ingresarse: la omisión por palabras clave no constituye un filtro completo de datos sensibles.

## Proveedor de IA

El proveedor de IA se administra únicamente desde el servidor para pruebas de desarrollo. El panel del negocio no muestra proveedores, modelos ni claves y no ofrece una API para consultar o modificar esa configuración. El código está en `ai.mjs` y las instrucciones en [docs/AI-CONFIG.md](docs/AI-CONFIG.md). Las claves ya guardadas en `data/ai.json` se conservan privadas y quedan excluidas de GitHub. La IA externa todavía no está conectada a WhatsApp.

SQLite es la fuente única de disponibilidad: los turnos de otros sistemas no se importan. Antes de un piloto, cargá todos los bloqueos de agenda o implementá una sincronización bidireccional con la agenda real. El panel es para un negocio, con una cuenta administradora y hasta dos cuentas de equipo. Todas operan la recepción y la información del bot; solo la administradora habilita o bloquea accesos.

En WhatsApp la identidad se toma del remitente validado del webhook, nunca del texto ingresado por el paciente. No compartas el acceso del panel con pacientes. Las APIs del negocio requieren una sesión de cuenta válida; las rutas públicas de autenticación no incluyen datos de pacientes. No hay acceso automático por conectarse desde localhost ni acceso con la clave anterior.

## Cuentas y sesiones

Las contraseñas se guardan como hashes scrypt con sal aleatoria (`N=131072`, `r=8`, `p=1`), sin guardar el texto original. Los identificadores de sesión e invitación también se guardan como hashes. Una cookie `HttpOnly` y `SameSite=Strict` mantiene la sesión; no se guardan contraseñas ni identificadores de sesión en localStorage o sessionStorage. Una sesión nueva reemplaza la anterior de esa cuenta: como máximo hay 3 sesiones activas. La sesión vence a las 12 horas o después de 30 minutos sin interacción; el sondeo automático de conversaciones no prolonga ese plazo. Cerrar sesión la revoca en el servidor.

Las escrituras requieren el origen del panel y un token CSRF de la sesión. Se validan los encabezados Host y Origin. Tras 8 intentos fallidos por cliente o correo se bloquea el acceso por 15 minutos; el contador persiste al reiniciar. El CAPTCHA visual local vence en 5 minutos, está ligado al cliente y es de un solo uso. Es una defensa complementaria, no una garantía contra bots avanzados. Estas medidas siguen las referencias de [autenticación de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) y [sesiones de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

El correo y el teléfono son datos de contacto; no se verifican ni son un segundo factor. Las invitaciones no envían correos ni SMS: el administrador comparte el enlace privado. En localhost, el enlace requiere acceso a esta misma computadora. Esta versión no incluye recuperación automática de contraseña por correo o teléfono. Para publicar el panel hay que configurar `PANEL_ORIGIN` con el origen HTTPS exacto y un proxy HTTPS propio; las cookies se marcan `Secure`. El túnel de prueba de WhatsApp continúa exponiendo únicamente `/webhook`.

Los recordatorios se generan mientras el servidor corre, en una ventana de 15 minutos después de cada umbral. No recupera recordatorios vencidos durante una caída. La aceptación de Meta (`sent`) se muestra como «Aceptado por WhatsApp»; la entrega, lectura o fallo se actualizan cuando llegan los eventos firmados de Meta para envíos nuevos. Los envíos históricos sin identificador de Meta conservan su estado anterior. Los reintentos de red pueden duplicar un envío si Meta lo aceptó y la respuesta se perdió.

## Conectar WhatsApp real

1. La clínica debe ser propietaria de su número y de sus cuentas empresariales. Crear la aplicación empresarial en Meta y agregar WhatsApp, siguiendo el asistente vigente del producto.
2. Empezar con el número de prueba y destinatarios permitidos que muestre Meta. No se promete un límite o crédito gratuito: verificarlo en la cuenta.
3. Copiar `.env.example` a `.env`. Completar `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `META_APP_SECRET` y `WEBHOOK_VERIFY_TOKEN`. Configurar también un `ADMIN_TOKEN` aleatorio largo.
4. Para producción, usar HTTPS con proxy inverso, persistencia de `data/`, reinicio automático y backups. Escuchar fuera de localhost requiere `HOST=0.0.0.0` y `ADMIN_TOKEN`. No publiques el panel sin protegerlo.
5. En la configuración de webhooks de WhatsApp, registrar `https://TU-DOMINIO/webhook`, el mismo verify token y suscribirse al campo `messages`. La ruta GET responde al challenge y la POST verifica `X-Hub-Signature-256`.
6. Confirmar que la aplicación está suscripta al WABA correcto y que el ID del número coincide. Enviar un mensaje desde un destinatario autorizado. Revisar Atención humana y la cola.
7. Crear una plantilla de utilidad para recordatorios con tres parámetros de cuerpo: nombre, servicio, fecha/hora. Configurar su nombre exacto e idioma en `REMINDER_TEMPLATE` y `REMINDER_LANGUAGE` solo después de aprobación. Incluir las instrucciones de confirmar, cancelar y reprogramar en el texto de la plantilla.
8. Mantener los mensajes libres dentro de la ventana de atención de 24 h. El servidor bloquea respuestas libres fuera de la ventana y usa plantillas para recordatorios.
9. Antes de producción, verificar permisos, token de usuario del sistema y versión de Graph habilitada para la aplicación. El token temporal del asistente dura unas 24 horas; reemplazarlo siguiendo [docs/WHATSAPP-TOKEN.md](docs/WHATSAPP-TOKEN.md). `GRAPH_VERSION` es configurable; el valor del ejemplo debe validarse en Meta.

`npm run meta:status` consulta las suscripciones de la app y del WABA, y muestra únicamente conteos de mensajes y estados de envío. Requiere `META_APP_ID`, `WHATSAPP_BUSINESS_ID` y las credenciales en `.env`. `npm run meta:status -- --subscribe` completa la suscripción del WABA si falta, mediante el [endpoint documentado por Meta](https://www.postman.com/meta/whatsapp-business-platform/request/ju40fld/subscribe-app-to-waba-s-webhooks). Para comprobar las rutas y firmas con ambos procesos activos, ejecutá `npm run check:connection`; podés pasarle la URL HTTPS del túnel para comprobarlas también desde Internet.

Si un número de prueba devuelve 131030 pese a estar verificado, compará el remitente del webhook con el destinatario exacto que usa el comando de Meta. `WHATSAPP_RECIPIENT_OVERRIDES` admite un objeto JSON con alias explícitos **de números verificados**. Afecta solo al envío, nunca a la identidad ni a la propiedad de los turnos. No uses una conversión general por país; quitá los alias de prueba cuando configures el número definitivo. Nunca copies enlaces de exportación de Meta en documentos públicos: pueden incluir el token de acceso codificado.

Referencias oficiales: [Colección de Meta](https://www.postman.com/meta/whatsapp-business-platform/overview), [verificación de webhook documentada por Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/). El SDK de esa segunda referencia está archivado; este proyecto no lo usa.

## Operación y privacidad

Para una prueba con un túnel HTTPS temporal, ejecutá `npm run webhook` además de `npm start` y apuntá el túnel al puerto **3001**, no al puerto del panel. El gateway permite solo GET/POST `/webhook`; conserva los bytes del cuerpo y la firma de Meta. Antes de abrir el túnel, completá `.env` y reiniciá el servidor. [Los Quick Tunnels de Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) requieren que la computadora y ambos procesos sigan encendidos; su URL es temporal y se deben usar para pruebas. La suscripción del webhook se debe actualizar cuando cambie esa URL.

En esta computadora Windows, `npm run restart` inicia el servidor en segundo plano; `npm run webhook:background` hace lo mismo con el gateway y `npm run tunnel` con Cloudflare. Los PID y registros quedan en `data/`. Al renovar el token guardado en `.env`, reiniciá el servidor. Si cambiás la URL del túnel, `npm run webhook:register -- https://<nombre>.trycloudflare.com/webhook` verifica y actualiza la suscripción existente de Meta a `messages`, usando las credenciales privadas. El registro sigue el endpoint de suscripciones del [ejemplo oficial de Meta](https://github.com/fbsamples/lead-ads-webhook-sample/blob/main/postman/FB%20Lead%20Ads%20(Part%201%20-%20The%20Webhook).postman_collection.json). Estos procesos duran mientras la PC está encendida; no se agregó inicio automático con Windows. Para producción, usá una dirección estable y credenciales persistentes de la clínica.

Guardá `.env` fuera del control de versiones. `data/clinic.sqlite` y `data/accounts.sqlite` contienen datos personales y de acceso: restringí acceso, cifrá el disco y los backups, acordá retención y procedimientos de acceso/eliminación con la clínica. Conservá ambos archivos al actualizar o reiniciar; borrar `accounts.sqlite` elimina las cuentas y vuelve a habilitar la instalación inicial. No hay borrado automático. El aviso genérico del saludo debe reemplazarse por el aviso aprobado de la clínica, con responsable, finalidad, contacto y derechos. La revisión jurídica y de seguridad previa al piloto sigue pendiente.

Las solicitudes HTTP se limitan a 64 KB y el panel a 60 solicitudes por minuto por IP. Las APIs del negocio requieren autorización; sin `ADMIN_TOKEN` no se puede crear la primera cuenta. Una vez creada, el inicio de sesión usa las cuentas guardadas.

## GitHub y despliegue

Repositorio: [fededev22/chatbot](https://github.com/fededev22/chatbot). Para publicar una modificación desde esta carpeta:

```powershell
npm run sync:github -- -Message "Descripción del cambio"
```

Codex tiene instrucciones para hacer commit y push al finalizar los cambios solicitados. GitHub ejecuta las pruebas en cada push a `main`. Las credenciales, bases de datos y conversaciones no se suben. Para desplegar, consultá [docs/DEPLOY.md](docs/DEPLOY.md): el backend actual requiere almacenamiento persistente y no funciona completo como una web estática en Vercel.

## Archivos del proyecto

- `core.mjs`: conversación, agenda, persistencia y recordatorios.
- `language.mjs`: interpretación local de frases, fechas, horas y contexto de consultas.
- `ai.mjs`: configuración privada de NVIDIA/OpenRouter y funciones de evaluación de IA para pruebas de desarrollo.
- `server.mjs`: servidor HTTP, acceso, webhook y envíos WhatsApp.
- `reception.mjs`: bandeja privada, lecturas, historial, atención humana y estados de entrega.
- `bot-info.mjs`: mensajes editables y respuestas vinculadas a los datos actuales del negocio.
- `connection.mjs`: comprobación de credenciales y disponibilidad del webhook.
- `auth.mjs`: cuentas, hashes, sesiones, CAPTCHA, invitaciones y límites de acceso.
- `business.json`: conocimiento y datos adaptables de la clínica.
- `public/`: panel interno del negocio, con acceso por clave y bandeja de WhatsApp.
- `test/core.test.mjs`: pruebas de la lógica crítica.
- `test/reception.test.mjs`: aislamiento de pruebas, lecturas, paginación, atención humana y eventos de Meta.
- `test/auth.test.mjs` y `test/auth-http.test.mjs`: autorización inicial, límite de cuentas, sesiones, cookies, CSRF, privilegios, CAPTCHA y bloqueos.
- `docs/PLAN.md`: aplicación de las fases A–N del documento adjunto.
- `docs/SYSTEM_PROMPT.md`: prompt preparado para una futura capa de IA; no se usa en la demo.
