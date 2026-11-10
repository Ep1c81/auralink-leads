import { getHotListView, PIPELINE_STAGES } from "@/lib/hotList";
import { HotLeadCard } from "@/components/hoy/HotLeadCard";
import { STAGE_LABELS, routeUrl } from "@/components/hoy/script";
import {
  body,
  eyebrow,
  label,
  pageTitle,
  panel,
  panelTitle,
  primaryButton,
} from "@/components/outreach/theme";

export const dynamic = "force-dynamic";

export default async function HoyPage() {
  const view = await getHotListView();
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
          🔥 Top {view.today.length} para visitar o llamar
        </h2>
        {view.today.length === 0 ? (
          <div className={`${panel} px-5 py-10 text-center`}>
            <p className="font-medium text-white">No hay prospectos pendientes.</p>
            <p className={`${body} mt-1`}>
              La búsqueda automática corre cada mañana a las 5:00. Si sigue vacío, revisá que
              GOOGLE_PLACES_API_KEY esté configurada en Vercel.
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
