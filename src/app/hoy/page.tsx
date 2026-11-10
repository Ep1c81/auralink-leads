import { getHotListView, HOT_LIST_ZONES, PIPELINE_STAGES } from "@/lib/hotList";
import { HotLeadCard } from "@/components/hoy/HotLeadCard";
import { STAGE_LABELS, routeUrl } from "@/components/hoy/script";
import {
  body,
  eyebrow,
  focusRing,
  label,
  pageTitle,
  panel,
  panelTitle,
  primaryButton,
} from "@/components/outreach/theme";

export const dynamic = "force-dynamic";

const ZONE_NAMES: string[] = HOT_LIST_ZONES.map((z) => z.name);

export default async function HoyPage({
  searchParams,
}: {
  searchParams: Promise<{ zona?: string | string[] }>;
}) {
  const { zona } = await searchParams;
  const requested = typeof zona === "string" ? zona : null;
  const zone = requested && ZONE_NAMES.includes(requested) ? requested : null;
  const view = await getHotListView(zone);
  const totalPending = view.counts.por_visitar;
  const route = routeUrl(view.today);
  const dateLabel = new Intl.DateTimeFormat("es-CR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Costa_Rica",
  }).format(new Date());

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={eyebrow}>{dateLabel}</p>
          <h1 className={pageTitle}>Lista de hoy</h1>
          <p className={`${body} mt-1`}>
            Negocios con pocas reseñas o calificación baja, ordenados por oportunidad.
          </p>
        </div>
        {route && (
          <a href={route} target="_blank" rel="noopener noreferrer" className={primaryButton}>
            Abrir ruta en Maps
          </a>
        )}
      </header>

      <nav aria-label="Filtrar por zona" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2 pb-1 sm:flex-wrap">
          {[null, ...ZONE_NAMES].map((z) => {
            const active = z === zone;
            const n = z ? (view.zoneCounts[z] ?? 0) : totalPending;
            return (
              <li key={z ?? "todas"} className="shrink-0">
                <a
                  href={z ? `/hoy?zona=${encodeURIComponent(z)}` : "/hoy"}
                  aria-current={active ? "page" : undefined}
                  className={`${focusRing} inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-violet-400/60 bg-violet-600 font-semibold text-white"
                      : "border-white/15 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {z ?? "Todas"}
                  <span className={active ? "text-violet-100" : "text-slate-400"}>{n}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-label="Resumen del embudo" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {PIPELINE_STAGES.map((stage) => (
          <div key={stage} className={`${panel} px-3 py-2.5`}>
            <p className={label}>{STAGE_LABELS[stage]}</p>
            <p className="text-xl font-semibold text-white">{view.counts[stage]}</p>
          </div>
        ))}
      </section>

      {view.reminders.length > 0 && (
        <section aria-labelledby="reminders-title" className="flex flex-col gap-3">
          <h2 id="reminders-title" className={panelTitle}>
            ⏰ Pruebas que requieren acción
          </h2>
          <ul className="flex flex-col gap-2">
            {view.reminders.map(({ lead, action }) => (
              <li
                key={lead.id}
                className={`${panel} flex flex-col gap-1 border-cyan-400/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between`}
              >
                <span className="font-medium text-white">{lead.name}</span>
                <span className="text-sm text-cyan-200">
                  Día {lead.trialDay}:{" "}
                  {action === "cerrar_venta"
                    ? "llamar para cerrar la venta"
                    : "enviar reporte de resultados"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="today-title" className="flex flex-col gap-3">
        <h2 id="today-title" className={panelTitle}>
          🔥 Top {view.today.length} para visitar o llamar{zone ? ` en ${zone}` : ""}
        </h2>
        {view.today.length === 0 ? (
          <div className={`${panel} px-5 py-10 text-center`}>
            <p className="font-medium text-white">
              No hay prospectos pendientes{zone ? ` en ${zone}` : ""}.
            </p>
            <p className={`${body} mt-1`}>
              La búsqueda corre cada mañana a las 5:00 y recorre todas las zonas cada 2 días. Si
              sigue vacío, revisá que GOOGLE_PLACES_API_KEY esté configurada en Vercel.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {view.today.map((lead, i) => (
              <HotLeadCard key={lead.id} lead={lead} rank={i + 1} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
