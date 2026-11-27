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

## Envío en vivo con reservas (desactivado por defecto)

La migración `supabase/migrations/20261127120000_acquisition.sql` (copia de
`supabase/review/acquisition.sql` más `acq_mark_failed`) **no está aplicada**.
Sin ella y sin `ACQUISITION_LIVE_ENABLED=true`, toda ruta en vivo responde 503.

Rutas:

- `POST /api/outreach/dispatch` (`pitch_1`) y `/api/outreach/followup-check`
  (`followup_2`), con `Authorization: Bearer OUTREACH_AUTOMATION_SECRET`.
  `?dry_run=1` sigue siendo solo vista previa (`acq_preview`, sin reservas ni red).
- `GET /api/cron/acquisition`: cron diario de Vercel a las 15:15 UTC
  (09:15 Costa Rica), `Authorization: Bearer CRON_SECRET`. Ejecuta `pitch_1`
  y luego `followup_2`; si una etapa falla, no ejecuta la siguiente. Los cron
  solo corren en el despliegue de producción.

Flujo por etapa: se valida la configuración → `acq_reserve(stage)` (máximo 5
por día y etapa, hora de Costa Rica, una vez por teléfono y etapa) → se lee
`lead_id`, `business_name` y `suppressed` de `acq_contacts` → un único POST a
Make, sin reintentos. Lista vacía: `{dispatched: 0}` sin llamar a Make.

Payload enviado al webhook (el Iterator sigue usando `1.leads[]`):

```json
{
  "sequence_stage": "pitch_1",
  "count": 1,
  "leads": [{
    "reservation_id": "uuid de acq_reservations",
    "preview_lead_id": "uuid de bizmap_leads",
    "phone": "506XXXXXXXX",
    "business_name": "Nombre",
    "consent_verified": true,
    "suppressed": false,
    "sequence_stage": "pitch_1"
  }]
}
```

Make debe devolver `reservation_id` en los callbacks para enlazar el
`provider_id` (Message ID) con la reserva.

Resultados de Make:

- 2xx: aceptado por Make, **no** entregado. La entrega solo se registra con el
  callback `delivered`/`read`.
- HTTP no-2xx (rechazo): las reservas pasan a `failed` mediante
  `acq_mark_failed`. Siguen ocupando el cupo del día y bloquean ese teléfono
  para esa etapa; no se reenvían automáticamente.
- Timeout/red (resultado desconocido): las reservas quedan `reserved`, porque
  Make puede tenerlas en cola. Revisar el historial del escenario antes de actuar.
- Filas inelegibles (sin contacto, suprimidas, bloqueadas o igual al emisor)
  se marcan `failed` y no se envían.

Variables de entorno:

| Variable | Uso |
| --- | --- |
| `ACQUISITION_LIVE_ENABLED` | Solo `true` habilita el envío en vivo. Cualquier otro valor: 503. |
| `MAKE_DISPATCH_WEBHOOK_URL` | Webhook HTTPS `hook.*.make.com` del escenario. |
| `MAKE_DISPATCH_API_KEY` | Se envía como cabecera `x-make-apikey`; configurar la misma clave en el webhook de Make (API key authentication). Obligatoria en vivo. |
| `CRON_SECRET` | Lo genera/usa Vercel para el cron; mínimo 32 caracteres. |
| `OUTREACH_AUTOMATION_SECRET` | Bearer de las rutas manuales de despacho; mínimo 32 caracteres. |
| `ACQUISITION_CALLBACK_SECRET` | Bearer que Make usa al llamar `POST /api/webhooks/acquisition`; mínimo 32 caracteres. |
| `ACQUISITION_CALLBACKS_ENABLED` | Solo `true` registra eventos (`acq_event`); si no, 503 tras validar. |
| `WHATSAPP_SENDER_PHONE` | Opcional: excluye reservas cuyo teléfono coincide con el emisor. |
| `SUPABASE_SERVICE_ROLE_KEY` | Obligatoria: las funciones `acq_*` solo se otorgan a `service_role`. |

Orden de activación sugerido: aplicar la migración en un entorno revisado,
habilitar primero callbacks, probar con un único contacto propio con
consentimiento y luego activar `ACQUISITION_LIVE_ENABLED`.

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

## Self-service 14-day trial funnel (Shieldy → WhatsApp)

1. Shieldy (bizmapshield.vercel.app) sends `consent_whatsapp: true` with the registration. `/api/integrations/shieldy` calls `acq_register()` (dedupe by phone; customers, blocked numbers and New Life excluded) and the visitor is sent to WhatsApp with a prepared message, so the merchant writes first (free 24h window).
2. Make "Integration WhatsApp Business Cloud" forwards each inbound message (`text`, `button`) to `/api/webhooks/acquisition`. The CRM records it once (`acq_event` returns false for retries) and runs the deterministic engine in `src/lib/funnel.mjs`.
3. The response `{to, reply, notify}` tells Make what to send back inside the 24h window and what to email to Alex.
4. Merchants who registered but never opened WhatsApp stay eligible for the 5/day `pitch_1` template run.

| Env var | Effect |
| --- | --- |
| `ACQUISITION_BOT_ENABLED` | `true` = the CRM returns bot replies. Off = no replies, but every inbound message still produces an alert for Alex. |
