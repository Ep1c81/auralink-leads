import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatWhatsAppNumber } from "@/lib/whatsapp";
import { computeBackoffMs } from "@/lib/outboxPolicy";
import { qualifyAndRecord } from "@/lib/qualification";
import { LEAD_COLUMNS } from "@/lib/leadColumns";
import type { Lead } from "@/lib/types";

/**
 * Procesa eventos persistidos en inbound_events (Meta, Make). Los webhooks
 * solo verifican, guardan y responden; el trabajo (y la IA) ocurre aquí, en
 * el worker o en `after()`, con reintentos y lease.
 */

export interface InboundEvent {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Palabras que indican que la persona no quiere más mensajes. */
const OPT_OUT_RE =
  /(^|\s|[¡!¿?.,])(baja|stop|alto|unsubscribe|desuscribir(me)?|no me (escriban|contacten|interesa|vuelvan a escribir)|no (quiero|deseo) (más )?mensajes|eliminen? mi n[uú]mero)($|\s|[!?.,])/i;

export function isOptOutMessage(text: string | null | undefined): boolean {
  return Boolean(text && OPT_OUT_RE.test(text.normalize("NFC")));
}

const TEXT = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");

async function suppress(waPhone: string, reason: string, source: string) {
  const { error } = await getSupabaseAdmin().rpc("add_contact_suppression", {
    p_wa_phone: waPhone,
    p_reason: reason,
    p_source: source,
    p_actor: `inbox:${source}`,
    p_note: null,
  });
  if (error) throw new Error(`No se pudo registrar la baja: ${error.message}`);
}

/** Marca respuesta en bizmap_leads (todas las filas con ese número o el id). */
async function markBizmapReplied(target: { leadId?: string; waPhone?: string | null }, externalChatId?: string) {
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  let query = db.from("bizmap_leads").update({
    has_replied: true,
    last_reply_at: now,
    ...(externalChatId ? { external_chat_id: externalChatId } : {}),
  });
  if (target.leadId) query = query.eq("id", target.leadId);
  else if (target.waPhone) query = query.eq("wa_phone", target.waPhone);
  else return [];
  const { data, error } = await query.select("id, outreach_status");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const toReplied = rows.filter((r) => r.outreach_status !== "Closed").map((r) => r.id);
  if (toReplied.length) {
    const { error: e2 } = await db
      .from("bizmap_leads")
      .update({ outreach_status: "Replied", pipeline_stage: "respondio" })
      .in("id", toReplied);
    if (e2) throw new Error(e2.message);
  }
  return rows.map((r) => r.id as string);
}

async function handleMetaMessage(event: InboundEvent): Promise<void> {
  const db = getSupabaseAdmin();
  const from = TEXT(event.payload.from, 32);
  const text = TEXT(event.payload.text);
  const contactName = TEXT(event.payload.contact_name, 120) || null;
  const waPhone = formatWhatsAppNumber(from);

  if (waPhone) {
    await markBizmapReplied({ waPhone });
    if (isOptOutMessage(text)) await suppress(waPhone, "Pidió no recibir mensajes", "whatsapp");
  }
  if (!text) return; // medios u otros tipos: solo se registra la respuesta

  // Lead del pipeline BANT (tabla leads) para la conversación.
  let lead: Lead | null = null;
  const { data: existing } = await db
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("phone", from)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    lead = existing as unknown as Lead;
  } else {
    const { data: created, error } = await db
      .from("leads")
      .insert({ name: contactName, phone: from, status: "new", metadata: { source: "whatsapp_inbound" } })
      .select(LEAD_COLUMNS)
      .single();
    if (error && error.code !== "23505") throw new Error(error.message);
    if (created) lead = created as unknown as Lead;
    else {
      const { data: recovered } = await db.from("leads").select(LEAD_COLUMNS).eq("phone", from).limit(1).maybeSingle();
      lead = (recovered as unknown as Lead) ?? null;
    }
  }
  if (!lead) throw new Error("No se pudo asociar el mensaje a un prospecto");

  // Idempotente por id del mensaje de WhatsApp (índice único parcial).
  const { error: convError } = await db.from("lead_conversations").insert({
    lead_id: lead.id,
    sender: `whatsapp:${from}`,
    message: text,
    metadata: { whatsapp_message_id: event.event_id, timestamp: event.payload.timestamp ?? null },
  });
  if (convError && convError.code !== "23505") throw new Error(convError.message);

  // IA fuera del camino del ACK. Si falla, el evento se reintenta.
  await qualifyAndRecord(lead, text);
}

const META_STATUS_MAP: Record<string, string> = {
  sent: "accepted",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

async function handleMetaStatus(event: InboundEvent): Promise<void> {
  const mapped = META_STATUS_MAP[TEXT(event.payload.status, 20)];
  const ref = TEXT(event.payload.message_id, 200);
  if (!mapped || !ref) return;
  const db = getSupabaseAdmin();
  const { data } = await db.from("outreach_sends").select("id").eq("provider_ref", ref).limit(1).maybeSingle();
  if (!data) return; // mensaje no enviado por nuestro outbox
  const { error } = await db.rpc("apply_send_callback", {
    p_send_id: data.id,
    p_status: mapped,
    p_provider_ref: ref,
    p_detail: `WhatsApp: ${mapped}`,
  });
  if (error) throw new Error(error.message);
}

async function handleMakeReply(event: InboundEvent): Promise<void> {
  const leadId = TEXT(event.payload.lead_id, 64) || undefined;
  const waPhone = formatWhatsAppNumber(TEXT(event.payload.phone, 40));
  const text = TEXT(event.payload.message_text);
  const externalChatId = TEXT(event.payload.external_chat_id, 200) || undefined;
  const ids = await markBizmapReplied({ leadId, waPhone }, externalChatId);
  if (ids.length === 0) throw new PermanentInboxError("Sin prospecto que coincida");
  if (isOptOutMessage(text)) {
    const phone =
      waPhone ??
      (
        await getSupabaseAdmin().from("bizmap_leads").select("wa_phone").eq("id", ids[0]).maybeSingle()
      ).data?.wa_phone;
    if (phone) await suppress(phone, "Pidió no recibir mensajes", "make_reply");
  }
}

const IN_SEQUENCE = ["Queued", "Pitch Sent", "Followup Sent"];

async function handleMakeSendFailed(event: InboundEvent): Promise<void> {
  const db = getSupabaseAdmin();
  const sendId = TEXT(event.payload.send_id, 64);
  if (sendId) {
    const { error } = await db.rpc("apply_send_callback", {
      p_send_id: sendId,
      p_status: "failed",
      p_provider_ref: null,
      p_detail: `Make: ${TEXT(event.payload.error_message, 300) || "error de envío"}`,
    });
    if (error) throw new Error(error.message);
  }
  const leadId = TEXT(event.payload.lead_id, 64);
  const waPhone = formatWhatsAppNumber(TEXT(event.payload.phone, 40));
  if (!leadId && !waPhone) return;
  let query = db
    .from("bizmap_leads")
    .select("id, wa_phone")
    .in("outreach_status", IN_SEQUENCE)
    .eq("has_replied", false);
  query = leadId ? query.eq("id", leadId) : query.eq("wa_phone", waPhone!);
  const { data: leads, error } = await query;
  if (error) throw new Error(error.message);
  if (!leads?.length) return;
  const status = /^506[24]/.test(leads[0].wa_phone ?? "") ? "No WhatsApp (landline)" : "No WhatsApp (mobile)";
  const { error: updateError } = await db
    .from("bizmap_leads")
    .update({
      outreach_status: status,
      retry_method: "Find alternate contact",
      retry_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .in("id", leads.map((l) => l.id))
    .in("outreach_status", IN_SEQUENCE)
    .eq("has_replied", false);
  if (updateError) throw new Error(updateError.message);
}

async function handleMakeStatus(event: InboundEvent): Promise<void> {
  const sendId = TEXT(event.payload.send_id, 64);
  const status = TEXT(event.payload.status, 20);
  if (!sendId || !["accepted", "delivered", "read", "failed"].includes(status)) {
    throw new PermanentInboxError("Callback de estado inválido");
  }
  const { data, error } = await getSupabaseAdmin().rpc("apply_send_callback", {
    p_send_id: sendId,
    p_status: status,
    p_provider_ref: TEXT(event.payload.provider_ref, 200) || null,
    p_detail: TEXT(event.payload.detail, 300) || null,
  });
  if (error) throw new Error(error.message);
  if ((data as { reason?: string } | null)?.reason === "no_existe") {
    throw new PermanentInboxError("send_id desconocido");
  }
}

/** Error que no tiene sentido reintentar (va directo a dead para revisión). */
export class PermanentInboxError extends Error {}

export async function handleInboundEvent(event: InboundEvent): Promise<void> {
  const key = `${event.provider}/${event.event_type}`;
  switch (key) {
    case "meta_whatsapp/message":
      return handleMetaMessage(event);
    case "meta_whatsapp/status":
      return handleMetaStatus(event);
    case "make/reply":
      return handleMakeReply(event);
    case "make/send_failed":
      return handleMakeSendFailed(event);
    case "make/status":
      return handleMakeStatus(event);
    default:
      return; // tipos solo informativos (p. ej. shieldy/lead_form ya procesado)
  }
}

/** Reserva y procesa eventos pendientes (lease + reintento con backoff). */
export async function processInbox(opts: { limit?: number; onlyIds?: string[] } = {}) {
  const db = getSupabaseAdmin();
  const owner = `inbox-${randomUUID()}`;
  const { data, error } = await db.rpc("claim_inbound_events", {
    p_owner: owner,
    p_limit: Math.min(opts.limit ?? 20, 50),
    p_lease_seconds: 120,
  });
  if (error) throw new Error(`No se pudieron reservar eventos: ${error.message}`);
  const events = (data ?? []) as InboundEvent[];
  const report = { claimed: events.length, done: 0, retried: 0, dead: 0 };

  for (const event of events) {
    let outcome: "done" | "retry" | "dead" = "done";
    let message: string | null = null;
    try {
      await handleInboundEvent(event);
    } catch (err) {
      outcome = err instanceof PermanentInboxError ? "dead" : "retry";
      message = err instanceof Error ? err.message : String(err);
    }
    const { data: status } = await db.rpc("complete_inbound_event", {
      p_id: event.id,
      p_owner: owner,
      p_outcome: outcome,
      p_error: message,
      p_retry_at: outcome === "retry" ? new Date(Date.now() + computeBackoffMs(event.attempts)).toISOString() : null,
    });
    if (status === "done") report.done++;
    else if (status === "pending") report.retried++;
    else if (status === "dead") report.dead++;
  }
  return report;
}
