import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonError, newRequestId, parseJsonBody, RequestValidationError } from "@/lib/http";
import { requireMachine } from "@/lib/machineAuth";

export const runtime = "nodejs";

/**
 * Ingesta de leads del formulario de Shieldy/BizMapShield.
 *
 * Contrato servidor-a-servidor: el BACKEND de Shieldy (nunca el navegador ni
 * un sitio estático) envía `Authorization: Bearer <SHIELDY_INGEST_SECRET>`.
 * Opcional: `submission_id` (UUID generado por Shieldy) para idempotencia;
 * sin él, se deriva de los datos + fecha.
 *
 * Cada envío queda registrado en inbound_events (único por proveedor+id), así
 * un reintento no duplica el lead. El consentimiento (casilla del
 * formulario) se guarda como evidencia con fecha.
 */

const text = (max: number) => z.string().trim().max(max);
const schema = z.object({
  submission_id: z.string().uuid().optional(),
  name: text(80).min(1),
  business: text(100).min(1),
  zone: text(80).min(1),
  business_type: text(80).min(1),
  plan: text(40).optional(),
  phone: text(30)
    .regex(/^\+?[\d\s()-]{7,30}$/)
    .optional()
    .or(z.literal("")),
  consent: z.boolean().optional(),
  website_url: z.string().max(100).optional(), // honeypot
});

export async function POST(request: Request) {
  const denied = requireMachine(request, ["SHIELDY_INGEST_SECRET"]);
  if (denied) return denied;
  const requestId = newRequestId();

  let input: z.infer<typeof schema>;
  try {
    input = await parseJsonBody(request, schema, 4096);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }

  // Honeypot: un humano deja este campo vacío.
  if (input.website_url?.trim()) return NextResponse.json({ ok: true });

  const receivedAt = new Date().toISOString();
  const eventId =
    input.submission_id ??
    createHash("sha256")
      .update(
        [input.name, input.business, input.zone, input.business_type, input.phone ?? "", receivedAt.slice(0, 10)]
          .join("|")
          .toLowerCase()
      )
      .digest("hex");

  try {
    const db = getSupabaseAdmin();
    const { data: event, error: eventError } = await db.rpc("record_inbound_event", {
      p_provider: "shieldy",
      p_event_id: eventId,
      p_event_type: "lead_form",
      p_payload: { ...input, website_url: undefined },
    });
    if (eventError) return jsonError(500, "No se pudo guardar el lead", requestId, eventError);
    // Un reintento de un envío ya procesado no repite efectos; uno que quedó
    // a medias (status distinto de done) se vuelve a procesar.
    if ((event as { status?: string } | null)?.status === "done") {
      return NextResponse.json({ ok: true, created: false, duplicate: true });
    }

    const consent = input.consent === true;
    const metadata = {
      source: "shieldy",
      product: "BizMapShield",
      zone: input.zone,
      business_type: input.business_type,
      interested_plan: input.plan || "No estoy seguro",
      consent_to_contact: consent,
      ...(consent
        ? { consent_evidence: { channel: "formulario Shieldy", recorded_at: receivedAt, submission_id: eventId } }
        : {}),
    };
    const { data, error } = await db
      .from("leads")
      .upsert(
        { name: input.name, company: input.business, phone: input.phone || null, status: "new", metadata },
        { onConflict: "name,company", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle();
    if (error) return jsonError(500, "No se pudo guardar el lead", requestId, error);

    await db
      .from("inbound_events")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .eq("provider", "shieldy")
      .eq("event_id", eventId);

    return NextResponse.json({ ok: true, created: Boolean(data) });
  } catch (err) {
    return jsonError(500, "No se pudo guardar el lead", requestId, err);
  }
}
