# GitHub y despliegue

La carpeta se vincula al remoto `origin` del repositorio `chatbot`. Un cambio se publica con commit y push; guardar un archivo por sí solo no es un push. Codex tiene instrucciones en `AGENTS.md` para publicar al terminar los cambios que el usuario solicite.

```powershell
npm run sync:github -- -Message "Descripción del cambio"
```

El comando comprueba el remoto, ejecuta las pruebas, verifica que el historial remoto no haya avanzado, crea un commit y hace push. Nunca usa force push. Requiere una cuenta de GitHub autorizada en Git y una identidad de autor configurada en este repositorio.

`.env`, `data/`, cuentas, conversaciones, reservas, secretos y herramientas privadas no se suben. Las variables reales se configuran por separado en el servidor. El repositorio conserva una plantilla `.env.example` sin valores privados. Las cuentas de una computadora no aparecen automáticamente en otra.

## Vercel

[Vercel puede desplegar automáticamente los pushes del repositorio conectado](https://vercel.com/docs/git/vercel-for-github). Este proyecto todavía no es una aplicación completa compatible con su ejecución serverless: abre `data/clinic.sqlite` y `data/accounts.sqlite`, escribe `business.json` y mantiene una cola de WhatsApp con un temporizador continuo. [Vercel no ofrece persistencia local para SQLite](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), y sus [funciones tienen un sistema de archivos de solo lectura con espacio temporal en `/tmp`](https://vercel.com/docs/functions/runtimes).

Para ponerlo en producción hay dos caminos:

1. Alojar el sistema completo en un servidor Node.js 24+ con disco persistente, HTTPS, reinicios automáticos y copias de seguridad de `data/` y `business.json`. Es el camino compatible con la implementación actual. Configurar `PANEL_ORIGIN` y las credenciales privadas en ese servidor.
2. Alojar la interfaz en Vercel y ejecutar el backend en un servicio persistente, con un proxy del mismo origen para `/api/` y los webhooks. Hay que adaptar el origen, el proxy y la entrega del módulo compartido `bot-info.mjs`; aún no está implementado ese despliegue. Otra alternativa es migrar todo a almacenamiento remoto y adaptar las rutas y las tareas de salida a funciones y trabajos programados.

No importes el repositorio esperando que un despliegue estático mantenga cuentas y turnos: la pantalla sola no tiene esas funciones. La memoria de contactos y turnos se conserva también en [Supabase](SUPABASE.md), pero el servidor sigue necesitando disco persistente y un proceso continuo para cuentas, historial y colas. El despliegue definitivo se hará como una tarea explícita antes de publicar el panel. El número de WhatsApp es de prueba y se usa un token de usuario del sistema de mayor duración.
