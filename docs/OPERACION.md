# Auralink Leads: configuración, operación y despliegue

Esta rama incorpora controles de acceso, una cola de WhatsApp y mejoras del CRM. No se ha desplegado ni conectado a la base real durante las pruebas. No autorizar envíos basándose solamente en un build.

Antes de desplegar, rotar y restringir la clave de Google previamente incrustada en `discovery_engine.py`; eliminarla del código no la elimina del historial. Las claves públicas de Supabase no son service-role, pero su uso directo en scripts fue reemplazado por configuración de servidor.

## Preparar un entorno de prueba

1. Crear un proyecto de Supabase de prueba y usuarios invitados en Auth. Deshabilitar el registro público en Supabase. Configurar `OPERATOR_EMAILS` con los correos invitados; la allowlist se verifica de nuevo en cada API. No existe multitenancy.
2. Completar las variables de `.env.example` en el servidor. `APP_ORIGIN` debe coincidir exactamente con el origen del CRM. La única clave con prefijo `NEXT_PUBLIC_` es la pública. La service-role nunca llega al navegador.
3. Dejar `AI_ENABLED=false`, `OPERATOR_ALERTS_ENABLED=false` y `MAKE_CONTRACT_VERIFIED=false`. La tabla `send_control` se crea pausada. No usar secretos de producción en previews de Vercel.
4. Aplicar las migraciones en orden únicamente en la base de prueba. Para una base nueva se incluye `000_bizmap_baseline.sql`. Para una existente, inspeccionar el esquema antes: la tabla original tenía cambios manuales no documentados. No ejecutar otra vez todas las migraciones históricas sobre producción.
5. Configurar en Supabase Auth el Site URL y los Redirect URLs. La plantilla de correo de enlace debe usar `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}`. Esta aplicación verifica ese hash mediante `verifyOtp` con tipo `email`. Usar el enlace de acceso desde login para recuperar acceso; no hay registro público. Para este flujo mantener los correos en `OPERATOR_EMAILS`, incluso si también se usan UUID en `OPERATOR_IDS`.
6. Ejecutar las verificaciones listadas abajo. Probar login, renovación de sesión, cierre y correo de recuperación en el Supabase de prueba; el entorno local solo utilizó Auth simulado.

## Uso comercial

Entrar → abrir **Prospectos** → filtrar por zona, categoría, estado o seguimiento pendiente → revisar **Ficha y próxima acción** → guardar respuesta, fecha y estado (nuevo, contactado, respondió, ganado o perdido).

La ficha conserva procedencia e identidad de fuente. Un teléfono público no habilita envíos automáticos. Para registrar permiso, ingresar evidencia concreta (fuente, fecha y alcance); para registrar una baja elegir exclusión. Esa exclusión aplica al teléfono, sin fusionar los registros de sucursales.

En **Campañas**, preparar una vista previa muestra el texto y destinatarios persistidos. Recargar recupera el mismo lote. Confirmar aprueba ese lote; no busca otros candidatos. Los contactos sin permiso quedan excluidos. Consultar **Estado de envíos** y usar el interruptor global para pausar.

Los borradores de campaña siguen editables y ahora pueden aprobarse para WhatsApp mediante la misma cola durable. La aprobación compara el texto y teléfono revisados; rechaza cambios concurrentes y contactos sin permiso. El transporte directo a n8n ya no se utiliza. Para vincular un prospecto de Bizmap con el CRM principal, usar la acción de cualificación desde su ficha: conserva `lead_links` y no fusiona sucursales.

La etapa **Seguimiento pendiente** prepara otro lote revisable, solo para contactos con entrega confirmada de la primera etapa hace más de tres días, sin respuesta y con permiso. No se genera un seguimiento a partir de una mera aceptación de Make.

Abrir WhatsApp no acredita un envío: el CRM pide confirmar que se realizó el contacto antes de registrarlo. Un `200` de Make se muestra como **Aceptado por el proveedor**. **Entregado** requiere receipt correlacionado. Los estados históricos `sent`, `Pitch Sent` y `Followup Sent` no deben interpretarse retroactivamente como entrega comprobada.

## Contrato requerido en Make y el proveedor

No se ha inspeccionado el escenario externo ni determinado cuál de ManyChat/Zernio/Meta está activo. `MAKE_CONTRACT_VERIFIED=true` es una condición operativa, no una comprobación automática. No activarlo antes de ejecutar estas pruebas en sandbox.

- Programar `POST /api/cron/worker` con `Authorization: Bearer CRON_SECRET`. El endpoint procesa hasta 25 eventos del inbox y, si está habilitado, reserva un envío por invocación. No llamar `GET` para despachar. El cron de discovery existente sigue separado.
- El worker envía un objeto por trabajo a `MAKE_DISPATCH_WEBHOOK_URL`: `idempotency_key`, `job_id`, `lead_id`, `phone`, `business_name`, `message_text`, `sequence_stage` (pitch_1, followup_2 o campaign). El header `Idempotency-Key` repite `job_id`. Es un contrato distinto al lote antiguo `{count,leads}`.
- Make debe persistir y reservar atómicamente `job_id` **antes** de transmitir al proveedor. Diez repeticiones deben producir un solo envío. Si el almacenamiento del escenario no garantiza unicidad concurrente, usar una reserva transaccional o la idempotencia verificable del proveedor; no basta con “buscar y después crear”.
- Verificar en el paso de transmisión las bajas, la evidencia de permiso, las plantillas aprobadas, la ventana de conversación y las cuotas reales de ese proveedor. Un texto libre preparado por el CRM no es una plantilla aprobada. No enviar fuera de ventana cuando el proveedor requiera plantilla.
- Informar `POST /api/webhooks/make-receipt`, `Authorization: Bearer MAKE_RECEIPT_SECRET`, JSON `{event_id,job_id,state,provider_message_id}`. `state`: `accepted`, `delivered` o `failed`. IDs estables, distintos por evento. Reportar `delivered` solo con evidencia del proveedor; `failed` solo cuando se sabe que no se realizó el envío.
- Meta envía `X-Hub-Signature-256`, HMAC-SHA256 de los bytes originales con `META_APP_SECRET`. `WHATSAPP_VERIFY_TOKEN` se usa exclusivamente en el handshake GET. El POST conserva todos los mensajes y estados en un inbox antes del ACK. El worker registra conversaciones y bajas sin IA en el camino del ACK.
- Las rutas legacy `make-reply`/`make-send-failed` conservan el secreto de automatización; no reemplazan el receipt de la cola nueva ni deben usarse para inferir entrega.
- Simular timeout después de aceptación: el trabajo debe quedar `uncertain`, sin reenvío automático. Consultar proveedor/escenario por `job_id`. Solo fallos confirmados admiten replay auditado vía API de jobs; un resultado incierto no permite replay.

## Shieldy / BizMapShield

El frontend estático debe llamar a **un backend de BizMapShield**. Ese backend llama a `POST /api/integrations/shieldy` con `Authorization: Bearer SHIELDY_INGEST_SECRET` y `Idempotency-Key` estable de 8–128 caracteres alfanuméricos, guion o guion bajo. El mismo formulario y sus reintentos deben usar el mismo ID. La ingesta admite los campos anteriores (`name`, `business`, `zone`, `business_type`, `phone`, `plan`, `consent`).

Nunca agregar el secreto a `index.html`, localStorage, JavaScript público ni un repositorio. El repositorio BizMapShield no fue modificado ni se probaron ambos extremos; coordinar el header nuevo antes del despliegue. Repetir diez veces un evento sintético y comprobar una sola fila. Consentimiento para responder una consulta no constituye automáticamente permiso para campañas: la elegibilidad se revisa aparte.

## Discovery y costos

Python ahora requiere zona explícita y pequeña (`--bbox SUR OESTE NORTE ESTE`) y `--category`. No existe promesa de cobertura nacional. `--checkpoints` conserva resultados por zona/categoría; volver a ejecutar retoma el resultado completo. Guarda todos los descubrimientos válidos antes del scoring, incluso sin teléfono. `push_to_supabase.py` rechaza archivos antiguos sin identidad y permite reintentar lotes sin duplicarlos.

TS conserva OSM tipo/ID y coordenadas; usa cache y reserva diaria por consulta. La deduplicación usa `source_key`, no nombre. Los duplicados históricos ambiguos no se fusionan: requieren reconciliación y relaciones explícitas en `lead_links`. La ausencia de rating o sitio web no significa mala reputación ni ausencia real de sitio.

Nominatim público: máximo de uso y prohibición de consultas sistemáticas/harvesting según https://operations.osmfoundation.org/policies/nominatim/ . Esta rama elimina el fallback de extracción de negocios por Nominatim. Overpass: respetar recursos y cuotas según https://dev.overpass-api.de/overpass-doc/en/preface/commons.html . No rotar espejos para evadir un 429. Para volumen superior evaluar extractos OSM/instancia propia/proveedor autorizado; no se contrató ningún servicio. Mostrar atribución © OpenStreetMap contributors, ODbL, al reutilizar datos.

La IA está apagada por defecto; al habilitarla hay un límite compartido diario de llamadas (`AI_DAILY_CALL_LIMIT`, máximo 100). Es un límite de llamadas, no una medición monetaria exacta ni garantía de costo. Establecer además presupuesto/límite en la cuenta del proveedor. Python guarda score 0 “sin estimar”; no genera gasto de IA durante discovery.

## Respaldo, migración y rollback

Un administrador debe trabajar primero sobre una copia de prueba. Usar conexión PostgreSQL del entorno correcto, sin pegarla en terminales compartidas ni chats. Las siguientes variables se configuran fuera del repositorio; no son valores reales:

```bash
pg_dump --format=custom --no-owner --file=crm-before.dump "$DB_URL"
pg_restore --list crm-before.dump
pg_restore --no-owner --dbname="$RESTORE_TEST_DB_URL" crm-before.dump
```

Comprobar conteos por tabla, conversaciones y campañas en la copia restaurada. Respaldar por separado la configuración Auth, Vercel, Make y Meta. El dump por sí solo no prueba que se pueda restaurar todo el servicio.

Las migraciones de seguridad revocan acceso directo anónimo/autenticado; el operador entra por API autorizada. El bootstrap histórico de purga fue convertido en no-op para no borrar datos de una instalación nueva. No revierte datos eliminados anteriormente. Antes de aplicar `202611010003_provenance.sql`, inspeccionar `unique_name_company`: si el esquema real lo implementa como constraint en vez de índice independiente, adaptar la migración en la copia de prueba. No adivinar ni aplicar `CASCADE`.

Rollback: pausar `send_control`, apagar el scheduler y conservar inbox, jobs y auditoría. Revertir solo la versión de aplicación a una versión con los mismos controles de acceso; **no volver al commit original públicamente expuesto**. Mantener RLS, grants restringidos y columnas/tablas nuevas. No borrar cola ni historial para revertir. Los resultados inciertos se concilian antes de cualquier reinicio. Restaurar el dump solo como procedimiento de recuperación aprobado y probado, porque sustituir una base activa puede perder datos posteriores.

## Monitoreo

Consultar `dispatch_jobs` para pendientes, incertidumbre y leases vencidos; `integration_inbox` para `failed` y eventos antiguos; `resource_limits` para llamadas de IA/discovery; `send_control` para reservas diarias. Un lease de transmisión vencido se recupera cuando se ejecuta el worker con el contrato habilitado; no hay demonio oculto. `job_audit` registra aprobación, reserva, resultados y replay. Los IDs de solicitud permiten correlacionar errores de API sin exponer datos del prospecto.

```sql
select state,count(*),min(created_at) from public.dispatch_jobs group by state;
select status,count(*),min(created_at) from public.integration_inbox group by status;
select count(*) from public.dispatch_jobs where state in ('processing','transmitting') and lease_until<now();
select resource,day,used,next_at from public.resource_limits;
```

Configurar alertas en la infraestructura existente para cola sin progreso, inbox fallido, leases vencidos y presupuesto agotado. La rama no configura paneles ni alertas externas automáticamente.

## Verificaciones reproducibles

```bash
npm ci
npm run lint -- --max-warnings=0
npm run typecheck
npm test
npm run build
node tests/run-http-smoke.mjs
node tests/auth-smoke.mjs
python -m pip install --require-hashes -r requirements.lock
python -m unittest discover -s tests -p 'test_*.py'
```

Los tests usan datos sintéticos, Auth/proveedor simulado y PostgreSQL embebido PGlite. No leen ni escriben producción. PGlite no reemplaza la verificación de dos procesos independientes en PostgreSQL/Supabase real, del esquema con extensiones/grants del proyecto ni de sus endpoints externos.

## Scripts auxiliares

`outreach_bridge.py` no selecciona destinatarios ni usa el contrato antiguo. Sin argumentos no hace solicitudes; `--run-approved` procesa un trabajo ya aprobado usando APP_ORIGIN y CRON_SECRET del servidor. `generate_outreach.py` guarda borradores en un archivo ignorado por Git y no imprime teléfonos ni mensajes en logs. `src/qualify_leads.py` procesa hasta 100 registros por ejecución con estimaciones determinísticas. `gmaps_review_prospects.py --location <zona>` conserva IDs OSM, direcciones originales y checkpoints, y exige una zona explícita.
