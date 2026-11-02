import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError, parseJsonBody, RequestValidationError } from "@/lib/http";
import { automationEligibility, DETAIL_COLUMNS, updateSchema, type LeadUpdate } from "@/lib/bizmapLeads";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function loadDetail(id: string) {
  const db = getSupabaseAdmin();
  const { data: lead, error } = await db.from("bizmap_leads").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!lead) return null;
  const row = lead as unknown as Record<string, unknown> & {
    wa_phone: string | null;
    automation_consent: string | null;
    has_replied: boolean;
    outreach_status: string | null;
  };
  const [suppression, sends] = await Promise.all([
    row.wa_phone
      ? db.from("contact_suppressions").select("reason, created_at").eq("wa_phone", row.wa_phone).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from("outreach_sends")
      .select("id, stage, status, status_detail, accepted_at, delivered_at, read_at, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (suppression.error) throw suppression.error;
  if (sends.error) throw sends.error;
  return {
    lead: row,
    suppression: suppression.data,
    sends: sends.data ?? [],
    eligibility: automationEligibility({ ...row, suppressed: Boolean(suppression.data) }),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);
  try {
    const detail = await loadDetail(id);
    if (!detail) return jsonError(404, "No se encontró el prospecto", requestId);
    return NextResponse.json(detail);
  } catch (err) {
    return jsonError(500, "No se pudo cargar la ficha", requestId, err);
  }
}

/**
 * Seguimiento comercial: etapa, próxima acción, notas, respuesta,
 * ganado/perdido, permiso para automatización (con evidencia) y bajas.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId, operator } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);

  let body: LeadUpdate;
  try {
    body = await parseJsonBody(request, updateSchema, 8192);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }

  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {};
  if (body.pipeline_stage !== undefined) {
    update.pipeline_stage = body.pipeline_stage;
    if (body.pipeline_stage === "ganado") update.won_at = now;
    if (body.pipeline_stage === "perdido") update.lost_at = now;
  }
  if (body.next_action !== undefined) update.next_action = body.next_action;
  if (body.next_action_at !== undefined) update.next_action_at = body.next_action_at;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.lost_reason !== undefined) update.lost_reason = body.lost_reason;
  if (body.reply_text !== undefined) {
    // Respuesta registrada a mano: sale de la secuencia automática.
    update.has_replied = true;
    update.last_reply_at = now;
    update.pipeline_stage = body.pipeline_stage ?? "respondio";
  }
  if (body.consent) {
    update.automation_consent = body.consent.basis;
    update.consent_evidence = body.consent.evidence;
    update.consent_recorded_at = now;
    update.consent_recorded_by = operator.email;
  }
  if (body.revoke_consent) {
    update.automation_consent = null;
    update.consent_evidence = null;
    update.consent_recorded_at = now;
    update.consent_recorded_by = operator.email;
  }

  try {
    const { data: current, error: readError } = await db
      .from("bizmap_leads")
      .select("id, wa_phone, outreach_status, notes")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return jsonError(404, "No se encontró el prospecto", requestId);

    if (body.reply_text) {
      const stamp = new Date().toLocaleString("es-CR", { timeZone: "America/Costa_Rica" });
      const prev = (update.notes as string | undefined) ?? current.notes ?? "";
      update.notes = `${prev ? `${prev}\n` : ""}[${stamp}] Respuesta: ${body.reply_text}`.slice(-4000);
      if (current.outreach_status !== "Closed") update.outreach_status = "Replied";
    }

    if (Object.keys(update).length > 0) {
      const { error } = await db.from("bizmap_leads").update(update).eq("id", id);
      if (error) throw error;
    }
    if (body.opt_out) {
      if (!current.wa_phone) return jsonError(409, "Este prospecto no tiene un número válido", requestId);
      const { error } = await db.rpc("add_contact_suppression", {
        p_wa_phone: current.wa_phone,
        p_reason: "Pidió no recibir mensajes (registrado por operador)",
        p_source: "operador",
        p_actor: operator.email,
        p_note: null,
      });
      if (error) throw error;
    }
    return NextResponse.json(await loadDetail(id));
  } catch (err) {
    return jsonError(500, "No se pudieron guardar los cambios", requestId, err);
  }
}
