# Recuperación de WhatsApp y Make

## Hallazgos confirmados (16 de noviembre de 2026)

Las capturas del operador muestran el escenario 6403421 inactivo y el mismo
número en Sender ID y Receiver. Receiver y Body {{1}} son valores fijos,
no campos del Iterator. El evento histórico indica HTTP 400 / código 100;
su detalle ya no está disponible. No se puede atribuir ese error histórico
exclusivamente al autoenvío sin una ejecución nueva controlada.

GitHub no administra la configuración del escenario. Este parche no activa
Make, no modifica sus conexiones y no confirma entrega de WhatsApp.

## Configuración del escenario existente

Mantenerlo inactivo mientras se corrige. Revisar la cola sin reprocesarla:
puede contener lotes antiguos. No eliminar ni reenviar esos lotes a ciegas.

| Módulo/campo | Valor esperado |
| --- | --- |
| Webhook | URL igual a MAKE_DISPATCH_WEBHOOK_URL en el despliegue correcto |
| Iterator / Array | `1.leads[]` (seleccionar el array completo del webhook) |
| WhatsApp / Connection | Conexión con acceso a la WABA y al emisor seleccionados |
| WhatsApp / Sender ID | Emisor seleccionado en la lista, Map desactivado |
| WhatsApp / Receiver | `2.phone` del Iterator; nunca el teléfono del emisor |
| WhatsApp / Message Template | `auralink_pitch_resenas (es_CR)`, verificar estado aprobado en Meta |
| WhatsApp / Body {{1}} | `2.business_name` del Iterator |
| Botón «Sí, envíeme el video» / Payload | `enviar` |
| Botón «No, gracias» / Payload | `no` |

Verificar también el filtro entre Iterator y WhatsApp: un filtro que descarta
el elemento puede terminar con éxito sin que se ejecute el envío.
Los botones requieren una automatización de respuesta aparte; su presencia
no envía el video ni registra una baja por sí sola.

## Prueba controlada de un solo mensaje

1. Usar otro celular propio con WhatsApp, distinto del emisor, autorizado para
   esta prueba. No usar la lista de prospectos ni el endpoint de despacho.
2. Configurar `WHATSAPP_SENDER_PHONE` (número real internacional, no su ID) y
   `MAKE_DISPATCH_WEBHOOK_URL` de forma privada. El script conserva
   `MAKE_WEBHOOK_URL` como alias anterior. Nunca publicar los valores.
3. Vista previa, sin red ni cambios en Supabase:
   `node scripts/test-make-webhook.mjs 506XXXXXXXX`
4. Solo después de comprobar mapeo y cola, hacer que Make escuche la prueba
   aislada. Si hay cola antigua, usar un escenario de prueba separado sin cola.
5. Enviar explícitamente el único elemento sintético:
   `node scripts/test-make-webhook.mjs 506XXXXXXXX --send`
6. Comprobar que el módulo WhatsApp ejecutó exactamente una operación, capturar
   el `Message ID` y verificar recepción en el celular. Un HTTP 200 de Make
   solo confirma aceptación. Si falla, conservar INPUT/OUTPUT y el código del
   proveedor, sin secretos. Si hay timeout, revisar el historial antes de repetir.

El payload de prueba tiene UUID sintético, score 10 y estado Queued para pasar
los filtros de score normales. No corresponde a una fila de CRM; no conectar
callbacks de escritura de CRM a esa prueba.

## Límites y trabajo pendiente

- El flujo antiguo todavía guarda `Pitch Sent` al recibir 2xx de Make; el
  texto del panel ahora aclara esa limitación. No se migran estados en este parche.
- El control de autoenvío en la aplicación depende de `WHATSAPP_SENDER_PHONE`.
  No puede detectar si Make ignora `2.phone` y utiliza otro valor fijo.
- Sigue siendo obligatorio un solo despachador: main no tiene reserva atómica.
- No conectar todos los errores a `make-send-failed`: actualmente ese endpoint
  clasifica la fila como «No WhatsApp». Código 100 no demuestra eso.
- Los callbacks de entrega, respuesta y bajas deben validarse antes de activar
  campañas sin supervisión. La ruta directa de Meta todavía ignora botones y
  recibos. No confundirla con `make-reply`.
- Las mejoras de outbox/seguridad del PR #11 están separadas y requieren sus
  migraciones y configuración; no fusionarlas como reparación rápida.

Referencias: https://apps.make.com/whatsapp-business-cloud-modules y
https://help.make.com/webhooks .
