"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HotLead, PipelineStage } from "@/lib/hotList";
import {
  body,
  cardTitle,
  focusRing,
  ghostButton,
  meta,
  panel,
  primaryButton,
  secondaryButton,
  successButton,
} from "@/components/outreach/theme";
import { STAGE_LABELS, callScript, digitsForWhatsApp, whatsappIntro } from "./script";

const NEXT_STAGES: Record<PipelineStage, PipelineStage[]> = {
  por_visitar: ["visitado", "interesado", "no_interesado"],
  visitado: ["interesado", "no_interesado"],
  interesado: ["prueba_instalada", "no_interesado"],
  prueba_instalada: ["cliente", "no_interesado"],
  cliente: [],
  no_interesado: ["por_visitar"],
};

function heatTone(score: number): string {
  if (score >= 70) return "bg-rose-500/15 text-rose-200 ring-rose-400/30";
  if (score >= 50) return "bg-amber-500/15 text-amber-200 ring-amber-400/30";
  return "bg-slate-500/15 text-slate-200 ring-slate-400/30";
}

export function HotLeadCard({ lead, rank }: { lead: HotLead; rank?: number }) {
  const router = useRouter();
  const [showScript, setShowScript] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [savingStage, setSavingStage] = useState<PipelineStage | null>(null);

  const wa = digitsForWhatsApp(lead.phone);
  const scriptId = `script-${lead.id}`;

  async function moveTo(stage: PipelineStage) {
    setError(null);
    setSavingStage(stage);
    try {
      const res = await fetch(`/api/hot-list/${lead.id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error();
      startTransition(() => router.refresh());
    } catch {
      setError("No se guardó. Intentá de nuevo.");
    } finally {
      setSavingStage(null);
    }
  }

  return (
    <article className={`${panel} flex flex-col gap-4 p-4 sm:p-5`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={`${cardTitle} text-base`}>
            {rank !== undefined && <span className="mr-1.5 text-slate-400">{rank}.</span>}
            {lead.name}
          </h3>
          <p className={meta}>
            <span className="capitalize">{lead.niche}</span>
            {lead.zone && ` · ${lead.zone}`}
            {" · "}
            {lead.rating !== null ? `★ ${lead.rating.toFixed(1)}` : "Sin calificación"}
            {` (${lead.reviewCount ?? 0} reseñas)`}
          </p>
          {lead.trialDay !== null && lead.stage === "prueba_instalada" && (
            <p className="mt-1 text-xs font-medium text-cyan-300">Día {lead.trialDay} de 14</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${heatTone(lead.heatScore)}`}
          aria-label={`Puntaje de interés ${lead.heatScore} de 100`}
        >
          🔥 {lead.heatScore}
        </span>
      </header>

      {lead.reasons.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Por qué es prospecto">
          {lead.reasons.map((r) => (
            <li key={r} className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-slate-300">
              {r}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-3 gap-2">
        {lead.phone ? (
          <a href={`tel:${lead.phone.replace(/\s/g, "")}`} className={primaryButton}>
            Llamar
          </a>
        ) : (
          <span className={`${secondaryButton} opacity-50`} aria-disabled>
            Sin tel.
          </span>
        )}
        {wa ? (
          <a
            href={`https://wa.me/${wa}?text=${encodeURIComponent(whatsappIntro(lead))}`}
            target="_blank"
            rel="noopener noreferrer"
            className={successButton}
          >
            WhatsApp
          </a>
        ) : (
          <span className={`${secondaryButton} opacity-50`} aria-disabled>
            Sin WA
          </span>
        )}
        {lead.mapsUrl ? (
          <a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer" className={secondaryButton}>
            Mapa
          </a>
        ) : (
          <span className={`${secondaryButton} opacity-50`} aria-disabled>
            Sin mapa
          </span>
        )}
      </div>

      <div>
        <button
          type="button"
          className={`${ghostButton} -ml-2 text-sm`}
          aria-expanded={showScript}
          aria-controls={scriptId}
          onClick={() => setShowScript((v) => !v)}
        >
          {showScript ? "▾ Ocultar guion" : "▸ Ver guion de llamada / visita"}
        </button>
        {showScript && (
          <ol id={scriptId} className={`${body} mt-2 list-decimal space-y-2 pl-5`}>
            {callScript(lead).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        )}
      </div>

      {NEXT_STAGES[lead.stage].length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <span className={meta}>Marcar como:</span>
          {NEXT_STAGES[lead.stage].map((stage) => (
            <button
              key={stage}
              type="button"
              disabled={pending || savingStage !== null}
              onClick={() => moveTo(stage)}
              className={`${focusRing} rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 active:bg-white/15 disabled:opacity-50`}
            >
              {savingStage === stage ? "Guardando…" : STAGE_LABELS[stage]}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </article>
  );
}
