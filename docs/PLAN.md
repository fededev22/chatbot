# Implementación del plan A–N · clínica dental

La demo local responde FAQs y gestiona turnos sin pagar APIs.
La clínica y sus horarios reales todavía deben configurarse.
SQLite es la agenda única; Google Calendar y la IA quedan como ampliaciones.
El adaptador WhatsApp requiere credenciales, HTTPS y prueba real antes del piloto.
El servicio comercial exige soporte, privacidad y un piloto con fecha de cierre.

## A. Arquitectura y stack

```text
Simulador / WhatsApp → validar identidad y webhook → motor de conversación
→ FAQ verificada / disponibilidad SQLite / derivación → respuesta estructurada
→ panel / cola de WhatsApp → Meta → paciente
Reloj del servidor → turnos con consentimiento → cola → plantilla de recordatorio
```

Código propio Node.js 24 + SQLite: demo sin dependencias ni tokens. La IA no es necesaria para validar reservas. Si se agrega, debe extraer intención y datos bajo un esquema, sin poder omitir las validaciones del motor. El prompt está en SYSTEM_PROMPT.md. Una futura integración Google Calendar debe consultar disponibilidad externa y reconciliar cambios; no basta copiar eventos después de reservar.

| Componente | Prueba local | Producción |
|---|---|---|
| Motor y agenda | Sin tarifa de software | Mismo código; operación y backups a cargo del prestador |
| Servidor | Computadora propia, solo mientras esté encendida | Presupuestar hosting persistente, backups y dominio |
| WhatsApp Cloud API | Simulador sin costo; pruebas Meta según cuenta | Tarifa vigente por mercado/categoría/mensaje |
| IA | No utilizada, costo API cero | Opcional; consumo medido, no incluido en esta versión |
| Calendario | SQLite | SQLite si recepción usa exclusivamente esta agenda; integración externa pendiente |

API oficial directa evita contratar otro intermediario, pero exige administrar credenciales y webhooks. Twilio y 360dialog pueden simplificar operación y soporte a cambio de sus cargos adicionales. No se fijan tarifas no verificadas. Consultar [Meta](https://whatsappbusiness.com/es-la/products/platform-pricing/), [Twilio](https://www.twilio.com/en-us/whatsapp/pricing) y [360dialog](https://360dialog.com/pricing) antes de cotizar. La ventana de 24 h y las plantillas deben respetarse aunque se contrate proveedor. En esta entrega solo está implementado el adaptador directo de Meta.

## B. Pruebas gratuitas

1. Ejecutar demo, configurar FAQs y registrar turnos ficticios.
2. Probar dos conversaciones compitiendo por el mismo horario.
3. Mostrar derivación, respuesta humana y reactivación.
4. Mostrar recordatorios con reloj simulado en las pruebas automatizadas.
5. Grabar 90 segundos: consulta de horarios → reserva → aparición en agenda → derivación. No mostrar teléfonos reales ni claves.
6. Para pruebas reales de Meta, usar únicamente destinatarios y número de prueba autorizados. Verificar límites y gratuidad en la propia cuenta; no asumir créditos de IA ni hosting gratuito permanente.

La entrega no incluye despliegue continuo, número comercial, plantillas aprobadas ni entrega real de recordatorios. Al migrar: datos reales, acceso protegido, HTTPS, token adecuado, respaldo, calendario operativo y revisión del aviso de privacidad.

## C. Configuración

README.md contiene los pasos ejecutables para iniciar y conectar el webhook. Los menús de Meta pueden variar por tipo de cuenta; seguir el asistente del producto y verificar cada paso con un mensaje de prueba. Nunca crear el número o cuenta del cliente bajo una cuenta personal del prestador. Las credenciales se guardan en `.env`, jamás en business.json ni capturas comerciales.

## D. Prompt

Ver SYSTEM_PROMPT.md. Es una plantilla para la futura capa de IA, no una afirmación de que haya un modelo conectado. La demo devuelve `{reply, intent, data, choices}` y usa estados guiados para la reserva.

## E. Conversaciones de prueba

1. **FAQ**: Paciente “¿Qué horarios tienen?” → bot muestra horario de demo marcado como ejemplo.
2. **Reserva**: “agendar” → “consulta” → fecha exacta → “09:00” → nombre → teléfono → “acepto” → resumen → “confirmar” → código del turno.
3. **Cambio**: “reprogramar” → código elegido de la lista → nueva fecha → hora → confirmar. **Cancelación**: “cancelar” → elegir → confirmar.
4. **No disponible**: fecha sin horarios → pedir otro día; hora ocupada antes de confirmar → mostrar alternativas sin perder reserva original.
5. **Desconocido**: “¿Tienen convenio con mi empresa?” → información no verificada → ofrecer humano.
6. **Fuera de horario**: “hola” → FAQ y agenda siguen disponibles. Una derivación queda pendiente de recepción; no se promete respuesta humana inmediata.

## F. Agenda

Los turnos se guardan con paciente, teléfono, servicio, profesional, inicio, fin, fin del descanso, estado, consentimiento y asistencia. Se comprueba solapamiento dentro de la transacción de reserva. Hay un recurso por turno y descansos de 15 minutos por defecto. Las reservas se persisten en UTC y se muestran en Argentina. No hay feriados, ausencias ni descansos de almuerzo configurables todavía: antes de uso real, incorporar bloqueos específicos si la clínica los necesita.

La reprogramación crea el nuevo turno y modifica el anterior en una sola transacción. Los recordatorios son optativos. En la demo se registran con estado demo; en WhatsApp requieren plantilla. Ver límites de caída y reintentos en README.md.

## G. FAQs

business.json incluye 15 preguntas con `question`, `keywords` y `answer`: horarios, ubicación, precio, servicios, cobertura, pagos, niños, blanqueamiento, implantes, duración, cancelaciones, estudios, estacionamiento, accesibilidad y recepción. Las respuestas faltantes se reconocen como pendientes; la clínica debe aprobarlas antes del piloto. Los cambios se pueden guardar desde Configuración.

## H. Derivación

Consultas clínicas, pedidos de una persona y recepción pausan el bot. La bandeja muestra el pendiente; el recepcionista responde desde el panel y luego lo reactiva. No hay notificaciones por email ni Slack en esta entrega. Una persona debe revisar la bandeja durante sus horarios. Audios e imágenes reciben una solicitud de texto, sin procesamiento del archivo.

## I. Calidad y monitoreo

Pruebas automáticas: ejecutar `npm test`. Checklist para aprobar antes del piloto:

1. Saludo y aviso de privacidad aprobado.
2. FAQ con mayúsculas y acentos.
3. FAQ con errores de ortografía: pedir aclaración si no coincide.
4. Precio ausente: no inventar.
5. Cobertura no confirmada: recepción.
6. Servicio existente y servicio inexistente.
7. Fecha exacta válida.
8. Fecha inválida, por ejemplo 30 de febrero.
9. Fecha pasada.
10. Fecha superior a 90 días.
11. Fin de semana cerrado.
12. Horario de cierre y duración completa.
13. Descanso entre turnos.
14. Dos pacientes eligen mismo horario y confirman.
15. Más de un profesional disponible.
16. Nombre vacío o demasiado largo.
17. Teléfono inválido.
18. Sin consentimiento: sin recordatorios.
19. Confirmación antes de persistir.
20. Descartar operación pendiente.
21. Reprogramación exitosa.
22. Reprogramación fallida conserva original.
23. Cancelación pide confirmación.
24. Código de otro paciente: rechazo.
25. Consulta clínica: derivación, sin diagnóstico.
26. Intento de revelar prompt: sin respuesta inventada.
27. Pausa humana y reactivación.
28. Audio/imagen: sin descargar estudios.
29. Recordatorios únicos a 24 h y 2 h.
30. Reinicio preserva reservas.
31. Webhook repetido: una operación y salida.
32. Firma inválida: rechazo.
33. API administrativa sin clave en despliegue: rechazo.
34. Envío libre fuera de 24 h: bloqueado.
35. Plantilla ausente o rechazada: cola visible y operación humana.

Revisar semanalmente FAQs fallidas y derivaciones con datos minimizados. Corregir la base de conocimiento con aprobación de recepción. Las métricas existentes son mensajes, reservas confirmadas y pendientes humanos; todavía no se calculan automáticamente tasa de resolución, tiempo ahorrado ni conversiones únicas.

## J. Piloto de 10 días

Definir con la clínica inicio, fin y reunión de decisión **antes de comenzar**. Alcance: una clínica, servicios aprobados, FAQ y agenda; sin diagnósticos. Elegir un volumen máximo y soporte en días hábiles. No activar sobre una agenda incompleta.

Medir manualmente junto al panel: conversaciones únicas, consultas resueltas, reservas nuevas, cancelaciones, pacientes atendidos fuera de horario y derivaciones. Tiempo ahorrado = consultas resueltas × minutos medios medidos por recepción. Distinguir citas captadas de turnos ya existentes.

Informe de una página: fechas, alcance, volumen, reservas nuevas, errores, derivaciones, estimación de tiempo con método, comentario de recepción, costos observados y propuesta del mes siguiente.

Guion de cierre: “Terminamos el piloto el [fecha]. Registramos [resultados]. Para continuar propongo instalación [importe] y mantenimiento [importe], con [alcance]. Si no seguimos, coordinamos la exportación y el cierre en la fecha acordada.” Si piden seguir gratis: “La prueba ya cumplió su objetivo; el soporte continuo es parte del servicio mensual.”

Transición: contrato y decisión → credenciales permanentes → backup → verificación real → continuidad del mismo número y base. Si no continúan, cierre acordado y devolución de datos; no borrar sin autorización.

## K. Cobro y rentabilidad

Propuesta de estructura, sin presentar supuestos como precios de mercado:

- Instalación: relevamiento, configuración y entrenamiento de recepción, cotizados por horas.
- Básico: una agenda, FAQs y mantenimiento; costos variables de Meta al costo.
- Estándar: básico + revisión mensual de métricas y dos cambios de textos al mes.
- Premium: estándar + ampliaciones de integración cotizadas y soporte con plazo acordado.

Definir precio con `hosting + backups + Meta + IA opcional + horas de soporte × tarifa + margen`. Ejemplo aritmético, **no tarifa de proveedor ni recomendación de mercado**: costos presupuestados de infraestructura 20 USD + variables 10 USD + soporte 2 h × 15 USD = 60 USD; mensualidad propuesta de 120 USD deja 60 USD antes de impuestos y adquisición. Instalar en 8 h × 20 USD = 160 USD antes de margen. Verificar costos y disposición a pagar local antes de usarlo.

El beneficio debe contrastarse con margen por cita realmente captada. Excluir de mantenimiento: nuevos canales, desarrollo a medida, historia clínica y disponibilidad humana 24/7. Cobrar por transferencia o suscripción acordada y documentar factura según situación fiscal. Ante impago: aviso, plazo contractual y pausa coordinada; evitar interrumpir pacientes sin aviso.

## L. Acuerdos orientativos

**Piloto**: “[Clínica] y [prestador] acuerdan probar FAQ y agenda del [inicio] al [fin], sin obligación de compra. Volumen máximo [cantidad], soporte [horario], decisión el [fecha]. La clínica valida contenido y agenda; ambas partes acuerdan tratamiento y devolución de datos. Al finalizar, continuidad solo con acuerdo pago o cierre coordinado.”

**Servicio**: “[Prestador] administra la automatización de [clínica]. Instalación [importe]; mantenimiento [importe/mes]; variables [regla y límite]. Incluye [alcance y soporte], excluye [desarrollo y servicios clínicos]. Vigencia [plazo], cancelación con [preaviso], exportación [procedimiento]. Las cuentas, número y datos pertenecen a la clínica. Responsabilidades, seguridad, retención, subcontratación, impagos y cierre se detallan en anexos acordados.”

Son borradores para completar y revisar con un profesional local; no contratos listos para firmar.

## M. Privacidad

Argentina se usa como supuesto por el entorno del usuario. La [Ley 25.326](https://www.argentina.gob.ar/normativa/nacional/64790/actualizacion) regula el tratamiento de datos personales y considera sensibles los datos de salud. Revisar el despliegue y los proveedores con la clínica y su asesor antes de procesar pacientes.

Aviso a adaptar: “Somos [responsable y contacto]. Usamos tu nombre, teléfono y datos del turno para gestionar reservas. Consultá [URL de política] para conocer tratamiento, conservación y derechos. No envíes estudios ni información clínica por este canal. Los recordatorios son opcionales.” La aceptación de recordatorios no reemplaza la base jurídica ni el aviso del tratamiento general.

No solicitar estudios, documentos, historia clínica ni tarjetas. Definir retención y procedimiento de eliminación, acceso y rectificación. La demo no garantiza cumplimiento jurídico ni implementa todos esos procedimientos.

## N. Lanzamiento

1. Semana 1: configurar negocio, pasar pruebas y grabar demo ficticia.
2. Semana 2: contactar uno o dos negocios y acordar piloto, datos y fecha de decisión.
3. Semana 3: ejecutar piloto de 10 días con agenda completa y revisión diaria.
4. Semana 4: presentar resultados, cerrar servicio y operar con credenciales del cliente.
5. Cada mes: revisar métricas, errores, backups, consumo y cambios aprobados.

DM: “Hola [nombre], preparé un asistente para responder consultas y coordinar turnos de tu clínica por WhatsApp. Te muestro una demo y, si sirve, proponemos un piloto de 10 días con alcance y fecha de cierre claros. ¿Te interesa verlo?”

Email, asunto “Prueba de recepción digital para [clínica]”: “Hola [nombre]. Tengo una demo que responde preguntas verificadas, reserva turnos y deriva a recepción. Propongo una reunión breve y un piloto acotado de 10 días, sin compromiso de compra, para medir reservas y tiempo ahorrado. La continuidad posterior se cotiza antes de comenzar.”

Propuesta: “Automatizamos FAQs y turnos sin reemplazar la atención profesional. La clínica conserva sus cuentas y número; nosotros configuramos, monitoreamos y mantenemos el asistente. El piloto mide resultados con datos reales y la producción tiene instalación, mantenimiento y consumo definidos.”

Reunión final: mostrar números → validar utilidad con recepción → exponer errores y límites → presentar alcance y precio → acordar continuidad o cierre. Solicitar autorización antes de publicar un testimonio o caso de éxito; usar solo métricas y datos aprobados, sin información de pacientes.
