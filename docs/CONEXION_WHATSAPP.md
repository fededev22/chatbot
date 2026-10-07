# Estado de la conexión de WhatsApp

Actualizado el 7 de octubre de 2026.

## Recursos confirmados en Meta

- App: `fede`, ID `1087152187393203`.
- Portfolio empresarial: `Bottt`, ID `2317296985698856`.
- Número de prueba: `+1 (555) 639-7654`.
- Phone Number ID: `1458676223985022`.
- Cuenta de WhatsApp Business: `1100462899513844`.
- Meta muestra la solicitud del número como **Completado**.

## Preparación local

El archivo privado `.env` contiene el ID del número, el token de acceso generado en Meta, el secreto de la app, una clave de administración y un token de verificación del webhook generados aleatoriamente. Está excluido por `.gitignore`. El servidor y el gateway están iniciados con esta configuración. El token de prueba puede caducar.

`npm run check:connection` verificó la autenticación del panel, el bloqueo de sus rutas en el gateway, el challenge de suscripción y la aceptación/rechazo de firmas del webhook. Las 27 pruebas automatizadas pasaron. El usuario también confirmó respuestas automáticas recibidas en su celular.

## Conexión configurada

1. Generación y guardado del token completados. No generar otro salvo que el actual caduque o se revoque.
2. Celular de prueba registrado y verificado en Meta.
3. Mensaje `hello_world` enviado; recepción confirmada por el usuario en WhatsApp.
4. Secreto de la app guardado en `.env` después de la confirmación de identidad en Meta.
5. Webhook público registrado en Meta: `https://upload-ethernet-proc-promises.trycloudflare.com/webhook`. El usuario autorizó el túnel de prueba. La API confirmó la suscripción activa de `whatsapp_business_account`, el campo `messages` y la app suscripta al WABA. El gateway escucha en `127.0.0.1:3001`, admite solo GET/POST `/webhook` y bloquea el panel y sus APIs; su funcionamiento se comprobó también a través de HTTPS público. La versión de los eventos de `messages` seleccionada por Meta es v26.0; las llamadas salientes usan Graph v25.0.
6. Conversación real de prueba completada desde el celular: respuestas recibidas y un turno confirmado registrado en Agenda. La configuración de producción sigue pendiente.

El primer intento entrante no obtuvo respuesta. El diagnóstico detectó el token temporal vencido (Meta código 190, subcódigo 463). El usuario renovó la autorización y se confirmó la suscripción al WABA. Un mensaje real entrante quedó registrado, pero Meta rechazó la respuesta con código 131030 porque el formato del remitente no coincidía con el destinatario autorizado de prueba.

Se configuró un alias exacto de envío en `.env`, tomado del destinatario de prueba mostrado por Meta. `whatsapp.mjs` aplica ese alias únicamente al envío; conserva el remitente validado como identidad de la conversación y propietario de los turnos. No convierte automáticamente números argentinos ni modifica otros destinatarios. Las 16 pruebas pasaron. Se reinició el servidor y Meta aceptó la respuesta pendiente; la cola registra `sent`, sin errores ni reintentos con la corrección. El usuario confirmó que recibió el saludo o menú del bot en WhatsApp.

**Estado:** mensaje entrante, respuesta automática recibida y turno confirmado desde WhatsApp comprobados. El número de prueba no es el número definitivo de la clínica. El túnel y el token son temporales: para operar la clínica todavía se necesita infraestructura estable, credenciales adecuadas y sus datos reales.

## Panel privado del negocio

El panel local abre una bandeja de conversaciones de WhatsApp, con acceso obligatorio por cuenta individual. Permite hasta 3 cuentas, cada una con correo, teléfono y contraseña personal. La administradora invita o bloquea al equipo; una nueva sesión cierra la anterior de la misma cuenta. Incluye CAPTCHA visual local, límites de intentos, cookies HttpOnly y protección CSRF. La clave compartida anterior solo sirve para instalar la primera cuenta y no da acceso a las APIs. Muestra historial paginado, mensajes sin leer, avance de reservas, agenda, búsqueda y filtros. Actualiza cada 5 segundos. La recepción puede tomar una conversación, responder con el bot pausado y reactivarlo conservando la reserva en curso. El simulador y sus datos quedan fuera de la interfaz y las métricas del negocio.

Pasaron las 35 pruebas automatizadas, incluyendo accesos HTTP sin sesión, rechazo de la clave anterior, origen, CSRF, permisos y revocación. El correo y el teléfono no se verifican por correo o SMS; no se integró un proveedor de segundo factor.

## Recuperación y edición de información

El acceso temporal de Meta venció y la URL anterior de Cloudflare dejó de resolver. Se renovó el token sin mostrarlo y se registró el nuevo callback `https://upload-ethernet-proc-promises.trycloudflare.com/webhook`, verificado por Meta. El usuario confirmó que volvió a recibir respuestas. Servidor, gateway y túnel quedan como procesos ocultos en segundo plano; los registros y PID están en `data/`. El token y la dirección continúan siendo de prueba.

Configuración muestra los datos guardados y la fecha de actualización. El botón Editar abre el formulario de datos de la clínica, mensajes, horarios cada 15 minutos, equipo, servicios, precios y FAQs. Al guardar, vuelve a mostrar la información actualizada; esta persiste al recargar. El bot usa los cambios sin reiniciar. Las respuestas vinculadas toman la dirección, horarios y servicios actuales. Se agregó una comprobación cada 90 segundos para distinguir token vencido y webhook caído. Pasaron las 27 pruebas. La conversación real también registró un turno confirmado desde WhatsApp.

Se incorporó el procesamiento de eventos de entrega y lectura de Meta para envíos nuevos. «Aceptado por WhatsApp» no se confunde con «Entregado» o «Leído». El gateway mantiene el panel fuera del túnel público. Se revisó en el navegador la conversación real existente, la búsqueda, la lectura, la toma y devolución de atención, la conservación del borrador y el cierre e inicio de sesión. El bot quedó activo y no se enviaron mensajes adicionales durante la revisión del panel.
