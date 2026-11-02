# Registro de cambios y evidencia

Base inspeccionada: `930ce896b228a76e4e3c822dc00041b6ea00b4dd`. Rama: `security/auralink-hardening`. Se leyó AGENTS.md y la documentación local de Next.js 16.3.2 sobre cookies, autenticación y proxy antes de modificar esas APIs. El árbol estaba limpio. No se desplegó, no se ejecutó scraping ni se enviaron mensajes reales.

## Hallazgos de la auditoría anterior

| Hallazgo | Estado al inspeccionar | Resultado de esta rama |
|---|---|---|
| APIs leads/bizmap sin identidad | Confirmado en código | Guard de operador; HTTP local 401 anónimo |
| Prospecting, qualification, enrichment y auto-prospect sin identidad | Confirmado | Guard por endpoint; GET auto-prospect ya no trabaja |
| Cron sweep exige CRON_SECRET | Ya corregido en la base | Conservado; worker usa acceso máquina separado |
| Supabase service-role con fallback anon | Confirmado | Módulo server-only, sin fallback de privilegios |
| SELECT anónimo bizmap | Confirmado en migración | Revocación de grants y eliminación de política preparadas; base real pendiente |
| Fetch arbitrario en enrichment | Confirmado | IP pública validada y fijada en conexión; redirecciones revalidadas; tiempo total y bytes limitados |
| POST Meta sin firma | Confirmado | Firma antes de procesamiento, inbox único por evento; ACK sin IA |
| Dispatch sin reserva atómica | Confirmado | Cola SQL con locks, lease y token de reserva |
| 200 Make mostrado como enviado | Confirmado | Estado accepted separado de delivered; datos históricos no se reetiquetan como comprobados |
| Preview distinto al envío | Confirmado | Lote persistido e inmutable; aprobación por ID y operador |
| Secreto en DispatchPanel/sessionStorage | Confirmado | Eliminado; usa sesión del operador |
| Python sin identidad/coordenadas y caja GAM fija | Confirmado | Identidad OSM, coordenadas, zona explícita y checkpoint |
| Dedupe por nombre/campos mutables | Confirmado | source_key nuevo; no se fusionan históricos ambiguos |
| Falta creación inicial bizmap | Confirmado | Baseline de instalación nueva; esquema real pendiente de comparación |
| Descarga de 20.000 filas | Confirmado | Endpoint bizmap paginado de 50, filtros servidor y total |
| eslint-config-next no declarado | Confirmado | Dependencia y lockfile actualizados |
| Suite/CI ausentes | Confirmado | Tests TS, SQL, HTTP, Python y workflow versionados |

“Confirmado” describe el código de la base inspeccionada, no una prueba nueva contra producción. No se declara mitigado un acceso real hasta desplegar y verificar. No se usó “no aplicable” para ocultar un hallazgo sin inspección.

## Archivos principales

- Acceso: `src/lib/security/auth.ts`, `policy.ts`, `src/proxy.ts`, `src/app/api/auth`, `src/app/login`, grupo `(crm)`, guards en APIs y DAL de campañas.
- Red: `src/lib/security/safeFetch.ts`, enrichment y deepEnrichment.
- Mensajería: `durableDispatch.ts`, APIs dispatch/jobs/worker/receipts, webhook Meta y migraciones `202611010002`, `004`, `006`.
- Datos/discovery: `discovery.ts`, `discovery_engine_osm.py`, `push_to_supabase.py`, migración `003`, presupuestos `005`.
- Operación: `CommercialDetails.tsx`, `QueueStatus.tsx`, dashboard paginado y DispatchPanel sin secreto.
- Evidencia: `tests/`, `.github/workflows/verify.yml`, `requirements.lock`, `docs/OPERACION.md`.

## Pruebas realizadas

- 6 tests Node: permisos, inbox repetido diez veces, migraciones y conservación de un registro histórico, reservas competidoras dentro del motor embebido, recuperación de lease, resultado incierto sin reenvío, baja previa al despacho, callback tardío, identidad de sucursales, contenido y destinatario aprobados, campañas en cola durable, promoción explícita de prospectos, seguimiento solo tras entrega, allowlist/origen, HMAC, direcciones internas/IPv6, límite de body y worker con proveedor simulado.
- 17 verificaciones HTTP sin credenciales: APIs administrativas/integraciones rechazan, páginas privadas redirigen a login.
- Smoke Auth con servidor simulado: login, cookie HttpOnly, consulta getUser al servidor, rechazo por origen y por usuario fuera de allowlist, acceso máquina de Shieldy y firma Meta válida/inválida.
- 4 tests Python: ausencia de credenciales incrustadas, sucursales/coordenadas, respuesta malformada y checkpoint ante 429/Retry-After.
- Lint sin warnings, tipos y build de Next.js. Los resultados finales de ejecución quedan registrados en la entrega y los commits; CI está configurado pero su ejecución remota depende del push.

## Hallazgo adicional

Se encontraron credenciales/configuración fija en scripts auxiliares: una clave de Google como fallback y claves públicas de Supabase incrustadas. Se retiraron del árbol de trabajo y se sustituyeron por variables de entorno; no se muestran sus valores. **Rotar/restringir la clave de Google en su cuenta y revisar el historial**. No se verificó si sigue activa y no se reescribió el historial del repositorio.

## Pendientes y límites que impiden aprobar producción

**Acceso externo:** inspeccionar schema/grants/vistas/RPC reales de Supabase; probar invitación, correo, renovación y logout con Auth real; probar backup/restore; adaptar y probar ambos extremos de Shieldy (nuevo Idempotency-Key); inspeccionar Make/proveedor, ventanas/plantillas y deduplicación real; activar scheduler/alertas y validar aislamiento de previews en Vercel. No se pidieron ni registraron secretos.

**Verificación adicional:** concurrencia entre procesos PostgreSQL independientes, restauración de copia real, prueba de redirecciones/rebinding con DNS y servidor controlados, límites de salida en el despliegue, prueba visual móvil/teclado y smoke comercial completo con Supabase sandbox. La validación de IP y conexión fijada no configura un firewall de salida externo.

**Límites operativos:** la paginación no proporciona una transacción de snapshot entre páginas si ingresan prospectos concurrentemente; campañas nuevas por teléfono requieren revisión y permiso propios. El presupuesto IA limita llamadas, no mide facturación monetaria exacta. El inbox usa reintentos acotados; las transmisiones inciertas deliberadamente no se reintentan. Falta validar la integración de extremo a extremo y la configuración externa antes de considerar el flujo completamente operativo.

El repositorio conserva datasets previamente versionados (`leads.json` y archivos de prospectos). No se borraron ni se publicaron datos adicionales. Revisar por separado si corresponde retirar datos reales del repositorio y de su historial, sin hacerlo como parte de una prueba.

La implementación es revisable y comprobada localmente en los aspectos indicados; no es una declaración de “cumple todo”, “seguro” o “production ready”.
