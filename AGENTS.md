# Chatbot de la clínica

El usuario autorizó vincular esta carpeta a `https://github.com/fededev22/chatbot.git` y publicar allí los cambios que solicite en este proyecto.

- Antes de trabajar, comprobá la rama, el remoto `origin` y los cambios existentes. Conservá cambios del usuario y contenido remoto; nunca hagas force push ni reemplaces el historial.
- Al completar una modificación solicitada, verificá la funcionalidad afectada y publicá el resultado con un commit descriptivo y un push al remoto autorizado. `npm run sync:github -- -Message "Descripción del cambio"` ejecuta las pruebas y sincroniza la rama actual.
- No interpretes la autorización como permiso para publicar trabajo sin terminar, mensajes a otras personas, secretos, archivos de pacientes o credenciales. `.env`, `data/`, bases SQLite, registros, capturas privadas de `docs/` y herramientas privadas permanecen excluidos. Revisá lo que se va a incluir en cada commit, incluidos archivos binarios y capturas.
- Si falta autenticación o el remoto tiene cambios que requieren resolver conflictos, completá lo que sea posible y explicá el bloqueo. No declares que GitHub se actualizó sin confirmar el push.
- El backend actual necesita Node.js 24+, SQLite persistente y un proceso continuo. Un despliegue de archivos estáticos en Vercel por sí solo no ejecuta las cuentas, conversaciones ni WhatsApp. Consultá `docs/DEPLOY.md` antes de cambiar el alojamiento.
- Los datos y cuentas se editan en el panel y se guardan en la computadora/servidor que lo ejecuta. Un push de código no copia bases de datos entre entornos.
