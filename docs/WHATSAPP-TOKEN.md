# Acceso de WhatsApp de mayor duración

El token de usuario generado por el asistente de pruebas de Meta vence en unas 24 horas. No se puede alargar ese plazo editando el chatbot. Meta permite generar tokens de usuario del sistema con duración de 60 días o sin vencimiento, según las opciones disponibles en la cuenta. Referencia: [documentación oficial de Meta en Postman](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-d0e227d1-e520-4b12-a8f6-32657a52d26e).

## Preparar el token en Meta

1. Abrí Configuración del negocio → Usuarios → Usuarios del sistema en el portfolio propietario de la app y del WhatsApp.
2. Creá un usuario técnico con el rol de empleado, dedicado al chatbot. Aceptá las políticas que Meta solicite después de revisarlas.
3. Asignale únicamente la app del chatbot y la cuenta de WhatsApp correspondiente, con los permisos necesarios para usar esos activos. No le asignes otras apps, publicidad ni cuentas ajenas.
4. En Generar token, seleccioná la app. Elegí Sin vencimiento si aparece; de lo contrario, 60 días.
5. Seleccioná `whatsapp_business_messaging` y `whatsapp_business_management`. Este proyecto usa el primero para mensajes y el segundo para comprobar el número y administrar las suscripciones de WhatsApp. Revisá cualquier permiso adicional antes de concederlo.
6. Completá vos las verificaciones de identidad o autenticación que Meta solicite. Guardá la credencial únicamente en el servidor.

Si Meta no muestra la app, revisá que pertenezca al portfolio y esté asignada al usuario del sistema. Si no aparecen permisos, revisá los activos y la configuración de WhatsApp de la app. No des permisos a todo el negocio como solución automática.

## Instalar y comprobar

Reemplazá únicamente `WHATSAPP_TOKEN` en el archivo privado `.env`, conservando los IDs, el secreto de la app y la verificación del webhook. No lo pegues en el chat ni lo subas a GitHub. Reiniciá el proceso para cargar el cambio:

```powershell
npm run restart
npm run meta:status
npm run check:connection
```

Comprobá también que la URL HTTPS del webhook siga activa y que una conversación de prueba tenga el bot reactivado. Escribí un mensaje nuevo desde un destinatario autorizado y verificá la respuesta en WhatsApp y su estado en el panel. La entrega real no se demuestra solamente con un token válido.

Sin vencimiento significa que no caduca por una fecha programada; Meta o el administrador pueden revocarlo. La duración del token tampoco mantiene encendida la PC ni hace permanente un túnel temporal de Cloudflare. Para operación continua se necesita un servidor y una URL HTTPS estable, como explica [DEPLOY.md](DEPLOY.md).
