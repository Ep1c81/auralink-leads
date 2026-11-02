"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  body,
  input,
  label,
  meta,
  panel,
  panelTitle,
  primaryButton,
  secondaryButton,
  successButton,
} from "./theme";

/**
 * Envíos automáticos por WhatsApp (vía Make), con aprobación comercial.
 *
 * 1. «Preparar lote» crea en el servidor el lote REAL pendiente de aprobación
 *    (los mismos destinatarios y textos que se enviarán).
 * 2. «Aprobar y poner en cola» es una sola acción; el servidor verifica que
 *    el contenido no cambió (hash) y es idempotente ante doble clic.
 * 3. El worker envía respetando el interruptor global, el límite diario,
 *    bajas y respuestas. "Aceptado por Make" NO significa "entregado".
 *
 * No pide secretos: usa la sesión del operador.
 */

type Stage = "pitch_1" | "followup_2";

interface BatchSend {
  id: string;
  wa_phone: string;
  business_name: string | null;
  canton: string | null;
  province: string | null;
  message_text: string;
}

interface PreparedBatch {
  batch_id: string;
  content_hash: string;
  item_count: number;
  expires_at: string;
  skipped: { lead_id: string; reason: string }[];
  sends: BatchSend[];
}

interface Health {
  sends_enabled: boolean;
  daily_send_cap: number;
  sent_today: number;
  by_status: Record<string, number>;
  oldest_queued_minutes: number | null;
  stuck_processing: number;
  needs_review: number;
  inbox_dead: number;
}

interface SendRow {
  id: string;
  business_name: string | null;
  wa_phone: string;
  stage: Stage;
  status: string;
  status_detail: string | null;
  needs_review: boolean;
  updated_at: string;
}

const STAGE_LABEL: Record<Stage, string> = {
  pitch_1: "Mensaje 1: presentación",
  followup_2: "Mensaje 2: seguimiento (3+ días sin respuesta)",
};

const SEND_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Pendiente de aprobación",
  queued: "En cola",
  processing: "Procesando",
  accepted: "Aceptado por Make (sin confirmar entrega)",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló según el proveedor",
  uncertain: "Resultado incierto: revisar",
  suppressed: "No enviado (baja, respuesta o sin permiso)",
  cancelled: "Cancelado",
  dead: "Falló: requiere revisión",
};

const SKIP_LABEL: Record<string, string> = {
  sin_permiso: "sin permiso registrado",
  baja: "pidió la baja",
  ya_respondio: "ya respondió",
  estado_cambio: "cambió de estado",
  telefono_cambio: "cambió el teléfono",
  ya_programado: "ya está en otro lote",
  muy_pronto: "aún no cumple 3 días",
  no_existe: "ya no existe",
  mensaje_vacio: "mensaje vacío",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error ?? `La solicitud falló (${res.status})`;
    throw new Error(data?.request_id ? `${msg} · ref. ${String(data.request_id).slice(0, 8)}` : msg);
  }
  return data as T;
}

export function DispatchPanel() {
  const [stage, setStage] = useState<Stage>("pitch_1");
  const [limit, setLimit] = useState(10);
  const [minScore, setMinScore] = useState(8);
  const [batch, setBatch] = useState<PreparedBatch | null>(null);
  const [busy, setBusy] = useState<null | "prepare" | "approve" | "cancel" | "toggle">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [review, setReview] = useState<SendRow[]>([]);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const data = await api<{ sends: SendRow[]; health: Health }>("/api/outreach/sends?filter=review");
      if (seq !== requestSeq.current) return; // descarta respuestas viejas
      setHealth(data.health);
      setReview(data.sends);
      setLoadedAt(Date.now());
    } catch (err) {
      if (seq === requestSeq.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    // Sondeo controlado solo con la pestaña visible.
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  async function prepare() {
    setBusy("prepare");
    setError(null);
    setNotice(null);
    setBatch(null);
    try {
      const data = await api<PreparedBatch>("/api/outreach/batches", {
        method: "POST",
        body: JSON.stringify({ stage, limit, minScore, mobileOnly: true }),
      });
      setBatch(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!batch || busy) return;
    setBusy("approve");
    setError(null);
    try {
      const result = await api<{ queued: number; already_approved: boolean }>(
        `/api/outreach/batches/${batch.batch_id}/approve`,
        { method: "POST", body: JSON.stringify({ content_hash: batch.content_hash }) }
      );
      setNotice(
        health?.sends_enabled
          ? `${result.queued} mensaje(s) en cola. Se enviarán en los próximos minutos respetando el límite diario.`
          : `${result.queued} mensaje(s) en cola. Los envíos están PAUSADOS: no saldrá nada hasta que un administrador los active.`
      );
      setBatch(null);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!batch) return;
    setBusy("cancel");
    try {
      await api(`/api/outreach/batches/${batch.batch_id}/cancel`, { method: "POST", body: "{}" });
      setBatch(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleSends(enabled: boolean) {
    setBusy("toggle");
    setError(null);
    try {
      await api("/api/outreach/settings", { method: "PATCH", body: JSON.stringify({ sends_enabled: enabled }) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function resolveSend(id: string, action: "replay" | "dismiss") {
    setError(null);
    try {
      await api(`/api/outreach/sends/${id}/${action}`, { method: "POST", body: "{}" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const stale = loadedAt !== null && now - loadedAt > 90_000;

  return (
    <section className={`${panel} flex flex-col gap-5 p-5`} aria-labelledby="dispatch-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="dispatch-title" className={panelTitle}>
            Envíos automáticos por WhatsApp
          </h2>
          <p className={`mt-1 ${body}`}>
            Solo incluye prospectos con permiso registrado para mensajes automáticos. Revise el lote y apruébelo
            con un clic.
          </p>
        </div>
        {health && (
          <div className="flex flex-col items-end gap-1 text-right">
            <span
              role="status"
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                health.sends_enabled ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-200"
              }`}
            >
              {health.sends_enabled ? "Envíos activos" : "Envíos pausados"}
            </span>
            <span className={meta}>
              Hoy: {health.sent_today} de {health.daily_send_cap} · En cola: {health.by_status.queued ?? 0}
            </span>
            <button
              type="button"
              className={`${secondaryButton} mt-1`}
              disabled={busy !== null}
              onClick={() => toggleSends(!health.sends_enabled)}
            >
              {health.sends_enabled ? "Pausar envíos" : "Activar envíos (admin)"}
            </button>
          </div>
        )}
      </div>

      {stale && (
        <p className={`${meta} text-amber-300`} role="status">
          Estos datos pueden estar desactualizados.{" "}
          <button type="button" className="underline" onClick={() => void refresh()}>
            Actualizar
          </button>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem]">
        <label className="flex flex-col gap-1.5">
          <span className={label}>Mensaje</span>
          <select
            className={input}
            value={stage}
            onChange={(e) => {
              setStage(e.target.value as Stage);
              setBatch(null);
            }}
            disabled={busy !== null}
          >
            {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Cantidad</span>
          <input
            type="number"
            min={1}
            max={50}
            value={limit}
            onChange={(e) => {
              setLimit(Math.min(Math.max(Number.parseInt(e.target.value, 10) || 1, 1), 50));
              setBatch(null);
            }}
            className={input}
            disabled={busy !== null}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Puntaje mín.</span>
          <input
            type="number"
            min={0}
            max={10}
            value={minScore}
            onChange={(e) => {
              setMinScore(Math.min(Math.max(Number.parseInt(e.target.value, 10) || 0, 0), 10));
              setBatch(null);
            }}
            className={input}
            disabled={busy !== null || stage === "followup_2"}
            aria-describedby="score-help"
          />
        </label>
      </div>
      <p id="score-help" className={meta}>
        El puntaje es una estimación (IA o reglas), no una garantía de interés.
      </p>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      )}

      {batch && (
        <div className="flex flex-col gap-3">
          <p className={label}>
            Lote para revisar · {batch.item_count} destinatario(s) · vence{" "}
            {new Date(batch.expires_at).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}
          </p>
          {batch.sends.length === 0 ? (
            <p className={body}>
              No hay prospectos elegibles con estos filtros. Recuerde que solo entran prospectos con permiso
              registrado.
            </p>
          ) : (
            <>
              <details className="rounded-lg border border-white/10 p-3">
                <summary className="cursor-pointer text-sm text-slate-200">Ver texto del primer mensaje</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{batch.sends[0].message_text}</pre>
              </details>
              <ul className="flex max-h-72 flex-col divide-y divide-white/5 overflow-y-auto rounded-lg border border-white/10">
                {batch.sends.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
                    <span className="text-sm text-slate-100">{s.business_name || "(sin nombre)"}</span>
                    <span className={`${meta} font-mono`}>
                      +{s.wa_phone}
                      {(s.canton || s.province) && ` · ${[s.canton, s.province].filter(Boolean).join(", ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {batch.skipped.length > 0 && (
            <p className={meta}>
              {batch.skipped.length} omitido(s):{" "}
              {Object.entries(
                batch.skipped.reduce<Record<string, number>>((acc, s) => {
                  acc[s.reason] = (acc[s.reason] ?? 0) + 1;
                  return acc;
                }, {})
              )
                .map(([reason, n]) => `${n} ${SKIP_LABEL[reason] ?? reason}`)
                .join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {batch ? (
          <>
            <button type="button" onClick={cancel} className={secondaryButton} disabled={busy !== null}>
              Cancelar lote
            </button>
            <button
              type="button"
              onClick={approve}
              className={successButton}
              disabled={busy !== null || batch.item_count === 0}
              aria-busy={busy === "approve"}
            >
              {busy === "approve" ? "Aprobando…" : `Aprobar y poner en cola (${batch.item_count})`}
            </button>
          </>
        ) : (
          <button type="button" onClick={prepare} className={primaryButton} disabled={busy !== null}>
            {busy === "prepare" ? "Preparando…" : "Preparar lote"}
          </button>
        )}
      </div>

      {review.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
          <h3 className={label}>Requieren revisión · {review.length}</h3>
          <p className={meta}>
            «Resultado incierto» significa que Make pudo haber recibido el mensaje. Reenviar solo si confirma en
            Make/WhatsApp que no salió.
          </p>
          <ul className="flex flex-col divide-y divide-white/5 rounded-lg border border-white/10">
            {review.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p className="text-sm text-slate-100">{s.business_name || `+${s.wa_phone}`}</p>
                  <p className={meta}>
                    {SEND_STATUS_LABEL[s.status] ?? s.status}
                    {s.status_detail ? ` · ${s.status_detail}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {(s.status === "dead" || s.status === "uncertain") && (
                    <button type="button" className={secondaryButton} onClick={() => resolveSend(s.id, "replay")}>
                      Reenviar
                    </button>
                  )}
                  <button type="button" className={secondaryButton} onClick={() => resolveSend(s.id, "dismiss")}>
                    Marcar revisado
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
