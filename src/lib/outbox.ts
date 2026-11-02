import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { provinceFromAddress } from "@/lib/costaRica";
import { buildOutreachMessage, cantonFromAddress } from "@/lib/whatsapp";
import { classifyMakeResponse, computeBackoffMs, type SendOutcome } from "@/lib/outboxPolicy";

/**
 * Outbox de WhatsApp vía Make, sobre las tablas/RPC de
 * 20261101110000_outbox_inbox_and_controls.sql.
 *
 * Flujo: prepareBatch (preview = lote real, pendiente de aprobación) ->
 * approveBatch (una acción del operador, ligada al hash del contenido) ->
 * processOutbox (worker con lease; un POST a Make por destinatario con
 * clave idempotente) -> callbacks del proveedor (make-status).
 */

export const CAMPAIGN = "whatsapp_bizmap_v1";
export type SequenceStage = "pitch_1" | "followup_2";

const STAGE_TEMPLATE = { pitch_1: "pitch", followup_2: "follow_up" } as const;
const MAX_BATCH = 50;
const CR_MOBILE = "^506[5-8][0-9]{7}$";
const CR_ANY = "^506[0-9]{8}$";

export interface BatchOptions {
  stage: SequenceStage;
  limit: number;
  minScore: number;
  mobileOnly: boolean;
  leadIds?: string[] | null;
}

export interface BatchSend {
  id: string;
  lead_id: string;
  wa_phone: string;
  business_name: string | null;
  canton: string | null;
  province: string | null;
  lead_score: number | null;
  message_text: string;
  status: string;
}

export interface PreparedBatch {
  batch_id: string;
  content_hash: string;
  item_count: number;
  expires_at: string;
  skipped: { lead_id: string; reason: string }[];
  sends: BatchSend[];
}

interface LeadRow {
  id: string;
  business_name: string | null;
  address: string | null;
  wa_phone: string | null;
  lead_score: number | null;
}

/** Candidatos elegibles (filtro amplio; la RPC revalida dentro de la transacción). */
async function loadCandidates(opts: BatchOptions): Promise<LeadRow[]> {
  const db = getSupabaseAdmin();
  const limit = Math.min(Math.max(opts.limit, 1), MAX_BATCH);
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  let query = db
    .from("bizmap_leads")
    .select("id, business_name, address, wa_phone, lead_score")
    .eq("has_replied", false)
    .not("automation_consent", "is", null)
    .filter("wa_phone", "match", opts.mobileOnly ? CR_MOBILE : CR_ANY);

  if (opts.stage === "pitch_1") {
    query = query.eq("outreach_status", "Queued");
    if (opts.minScore > 0) query = query.gte("lead_score", opts.minScore);
  } else {
    query = query.eq("outreach_status", "Pitch Sent").lt("last_contacted_at", cutoff);
  }
  if (opts.leadIds?.length) query = query.in("id", opts.leadIds);

  const { data, error } = await query
    .order(opts.stage === "pitch_1" ? "lead_score" : "last_contacted_at", {
      ascending: opts.stage !== "pitch_1",
      nullsFirst: false,
    })
    .order("id", { ascending: true })
    .limit(limit * 2);
  if (error) throw new Error(`No se pudieron cargar candidatos: ${error.message}`);

  // Un número por lote (sucursales que comparten teléfono no reciben dos mensajes).
  const seen = new Set<string>();
  const unique: LeadRow[] = [];
  for (const row of (data ?? []) as LeadRow[]) {
    if (!row.wa_phone || seen.has(row.wa_phone)) continue;
    seen.add(row.wa_phone);
    unique.push(row);
    if (unique.length >= limit) break;
  }
  return unique;
}

export async function prepareBatch(opts: BatchOptions, actor: string): Promise<PreparedBatch> {
  const candidates = await loadCandidates(opts);
  const items = candidates.map((lead) => {
    const businessName = lead.business_name?.trim() || "";
    const canton = cantonFromAddress(lead.address);
    return {
      lead_id: lead.id,
      wa_phone: lead.wa_phone,
      business_name: businessName,
      canton,
      province: provinceFromAddress(lead.address),
      lead_score: lead.lead_score ?? 0,
      message_text: buildOutreachMessage({ businessName, canton, stage: STAGE_TEMPLATE[opts.stage] }),
    };
  });

  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("create_outreach_batch", {
    p_campaign: CAMPAIGN,
    p_stage: opts.stage,
    p_items: items,
    p_actor: actor,
  });
  if (error) throw new Error(`No se pudo preparar el lote: ${error.message}`);
  const batch = data as Omit<PreparedBatch, "sends">;
  return { ...batch, sends: await loadBatchSends(batch.batch_id) };
}

export async function loadBatchSends(batchId: string): Promise<BatchSend[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("outreach_sends")
    .select("id, lead_id, wa_phone, business_name, canton, province, lead_score, message_text, status")
    .eq("batch_id", batchId)
    .order("id", { ascending: true });
  if (error) throw new Error(`No se pudo leer el lote: ${error.message}`);
  return (data ?? []) as BatchSend[];
}

export type ApproveResult =
  | { ok: true; queued: number; already_approved: boolean }
  | { ok: false; reason: string };

export async function approveBatch(batchId: string, contentHash: string, actor: string): Promise<ApproveResult> {
  const { data, error } = await getSupabaseAdmin().rpc("approve_outreach_batch", {
    p_batch_id: batchId,
    p_content_hash: contentHash,
    p_actor: actor,
  });
  if (error) throw new Error(`No se pudo aprobar el lote: ${error.message}`);
  return data as ApproveResult;
}

export async function cancelBatch(batchId: string, actor: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("cancel_outreach_batch", {
    p_batch_id: batchId,
    p_actor: actor,
  });
  if (error) throw new Error(`No se pudo cancelar el lote: ${error.message}`);
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Worker

interface ClaimedSend extends BatchSend {
  stage: SequenceStage;
  campaign: string;
  idempotency_key: string;
  attempts: number;
}

export interface WorkerReport {
  claimed: number;
  accepted: number;
  retried: number;
  uncertain: number;
  dead: number;
  skipped: number;
}

export type MakePoster = (url: string, body: unknown, idempotencyKey: string, signal: AbortSignal) => Promise<Response>;

const defaultPoster: MakePoster = (url, body, idempotencyKey, signal) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
    signal,
    redirect: "error",
  });

/**
 * Payload compatible con el escenario existente (sobre { sequence_stage,
 * count, leads: [...] } con un Iterator sobre `leads`) + campos nuevos para
 * deduplicar y reportar: idempotency_key, send_id y callback_url.
 */
export function buildMakePayload(send: ClaimedSend, callbackUrl: string | null) {
  const lead = {
    send_id: send.id,
    idempotency_key: send.idempotency_key,
    lead_id: send.lead_id,
    phone: `+${send.wa_phone}`,
    business_name: send.business_name ?? "",
    lead_score: send.lead_score ?? 0,
    outreach_status: send.stage === "pitch_1" ? "Queued" : "Pitch Sent",
    canton: send.canton ?? "",
    province: send.province ?? "",
    message_text: send.message_text,
    sequence_stage: send.stage,
  };
  return {
    sequence_stage: send.stage,
    count: 1,
    idempotency_key: send.idempotency_key,
    callback_url: callbackUrl,
    leads: [lead],
  };
}

export async function processOutbox(
  opts: { limit?: number; poster?: MakePoster; timeoutMs?: number } = {}
): Promise<WorkerReport> {
  const report: WorkerReport = { claimed: 0, accepted: 0, retried: 0, uncertain: 0, dead: 0, skipped: 0 };
  const webhookUrl = process.env.MAKE_DISPATCH_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.error("[outbox] MAKE_DISPATCH_WEBHOOK_URL no está configurado; no se reserva nada");
    return report;
  }
  const appOrigin = process.env.APP_ORIGIN?.split(",")[0]?.trim().replace(/\/$/, "") || null;
  const callbackUrl = appOrigin ? `${appOrigin}/api/webhooks/make-status` : null;
  const owner = `worker-${randomUUID()}`;
  const db = getSupabaseAdmin();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const poster = opts.poster ?? defaultPoster;

  const { data, error } = await db.rpc("claim_outreach_sends", {
    p_owner: owner,
    p_limit: Math.min(opts.limit ?? 10, 25),
    p_lease_seconds: Math.ceil(timeoutMs / 1000) + 30,
  });
  if (error) throw new Error(`No se pudieron reservar envíos: ${error.message}`);
  const claimed = (data ?? []) as ClaimedSend[];
  report.claimed = claimed.length;

  for (const send of claimed) {
    const { data: ok, error: markError } = await db.rpc("mark_send_transmitting", { p_id: send.id, p_owner: owner });
    if (markError || !ok) {
      report.skipped++;
      continue;
    }

    let outcome: SendOutcome;
    try {
      const response = await poster(webhookUrl, buildMakePayload(send, callbackUrl), send.idempotency_key, AbortSignal.timeout(timeoutMs));
      // Leer (y descartar) el body dentro del mismo plazo.
      await response.text().catch(() => "");
      outcome = classifyMakeResponse({ status: response.status, retryAfter: response.headers.get("retry-after") });
    } catch (err) {
      outcome = classifyMakeResponse({ error: err });
    }

    const retryAt =
      outcome.kind === "retry"
        ? new Date(Date.now() + (outcome.retryAfterMs ?? computeBackoffMs(send.attempts))).toISOString()
        : null;
    const { data: finalStatus, error: completeError } = await db.rpc("complete_outreach_send", {
      p_id: send.id,
      p_owner: owner,
      p_outcome: outcome.kind,
      p_http_status: outcome.httpStatus ?? null,
      p_error: outcome.error ?? null,
      p_retry_at: retryAt,
      p_provider_ref: null,
    });
    if (completeError) {
      // El lease vencerá y la recuperación lo marcará incierto (transmitido).
      console.error(`[outbox] no se pudo registrar el resultado de ${send.id}:`, completeError.message);
      report.uncertain++;
      continue;
    }
    if (finalStatus === "accepted") report.accepted++;
    else if (finalStatus === "queued") report.retried++;
    else if (finalStatus === "uncertain") report.uncertain++;
    else if (finalStatus === "dead") report.dead++;
  }
  return report;
}
