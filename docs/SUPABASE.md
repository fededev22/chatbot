# Memoria de contactos y turnos

El servidor identifica cada contacto por el número exacto recibido de WhatsApp. Conserva su nombre conocido, primer y último contacto y sus reservas. Un saludo de una persona con turnos futuros confirmados muestra sus turnos y ofrece consultarlos o modificarlos; no ofrece otra reserva automáticamente. Los turnos cancelados, reprogramados o pasados no cuentan como próximos. Una nueva reserva solicitada expresamente puede reutilizar el nombre conocido, pero exige nuevamente consentimiento para recordatorios y confirmación.

La selección de horario se construye en el servidor con todos los horarios disponibles para el servicio y la fecha, considerando duración, descansos y reservas. La IA no redacta ni selecciona esa lista. Los textos no usan exclamaciones; se corrigen las afirmaciones interrogadas reconocidas y se descartan respuestas con signos de interrogación desbalanceados. Las instrucciones del modelo también exigen preguntas completas y buena conjugación; esto no sustituye una revisión editorial de los mensajes personalizados del negocio.

## Supabase

El esquema versionado está en `supabase/migrations/20261009230826_dental_contact_memory.sql`, generado con la CLI oficial. Crea `dental_contacts`, `dental_appointments` y `dental_save_memory`; no cambia las tablas anteriores del proyecto. La función guarda cada contacto con sus turnos en una transacción. RLS está habilitado y los roles `anon` y `authenticated` no tienen permisos sobre estas tablas ni la función. Solo se usa una clave secreta desde el servidor. No se instala ningún cliente de Supabase en el navegador.

Configuración privada en `.env`:

```dotenv
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SECRET_KEY=
SUPABASE_CLINIC_ID=clinica-principal
```

La clave puede ser una secret key actual o una credencial legacy de `service_role`; ambas son privilegiadas y jamás deben enviarse al panel, GitHub ni al chat. Antes de usar un esquema ya instalado, verificá su estado; el archivo de creación no es una instrucción para reemplazar tablas existentes. En esta instalación se aplica mediante el editor SQL, sin modificar manualmente el historial de migraciones administrado por Supabase.

`supabase-memory.mjs` guarda contactos y turnos en Supabase. Al iniciar, restaura esa memoria en la agenda local; antes de preparar respuestas intenta actualizar la memoria del remitente. Los cambios locales se encolan de forma persistente y se reintentan si falla la red. Una actualización llegada durante un envío conserva su trabajo pendiente. Los errores se guardan como códigos seguros, sin claves ni cuerpos de respuestas.

El sistema actual admite **un solo servidor activo** para esta clínica: SQLite sigue siendo la agenda transaccional y la cola de WhatsApp. Supabase conserva la memoria remota de contactos y reservas; no convierte este backend en una aplicación serverless ni permite varios escritores concurrentes. Un inicio con Supabase configurado verifica la lectura remota antes de atender. Si hay una caída posterior, el servidor conserva su copia local y los cambios pendientes para reintentar. No cambies de proyecto o `SUPABASE_CLINIC_ID` sobre una instalación vinculada sin planificar la migración.

Los mensajes del chat, documentos médicos, cuentas del panel, contraseñas, tokens, configuración de IA y trabajos internos permanecen fuera de Supabase. La IA recibe solo el indicador de que existe un turno futuro; no recibe identidad ni registros de reservas. Para una recuperación en otro servidor, Supabase restaura contactos y turnos; se necesitan copias privadas separadas para cuentas, historial de mensajes, claves, configuración y estado pendiente de WhatsApp. Consultá también [DEPLOY.md](DEPLOY.md).

Verificaciones: pruebas de restauración en un motor nuevo, aislamiento entre números y clínicas, reserva explícita con nombre recordado, reintentos, cancelaciones, lista completa sin horarios ocupados y redacción. En Supabase deben comprobarse las tablas, sus permisos y una escritura transaccional de prueba con `ROLLBACK`, antes de activar la conexión real.
