import "server-only";
import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import type { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonError, newRequestId, readBodyLimited, RequestValidationError } from "@/lib/http";
import { requireMachine } from "@/lib/machineAuth";
import { processInbox } from "@/lib/inbox";

/**
 * Entrada común para webhooks de Make: autentica (OUTREACH_AUTOMATION_SECRET),
 * valida, persiste en inbound_events con id único y responde 202. El efecto
 * se aplica después (after() + worker). Reintentos de Make con el mismo
 * `event_id` (o mismo cuerpo exacto) no repiten efectos.
 */
export async function ingestMakeEvent<T extends z.ZodType>(
  request: Request,
  eventType: string,
  schema: T
): Promise<NextResponse> {
  const denied = requireMachine(request, ["OUTREACH_AUTOMATION_SECRET"]);
  if (denied) return denied;
  const requestId = newRequestId();

  let raw: string;
  try {
    raw = await readBodyLimited(request, 16_384);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return jsonError(400, "El cuerpo no es JSON válido", requestId);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const path = result.error.issues[0]?.path?.join(".") || "cuerpo";
    return jsonError(400, `Dato inválido en «${path}»`, requestId);
  }
  const body = result.data as Record<string, unknown>;
  const eventId =
    (typeof body.event_id === "string" && body.event_id) ||
    `${eventType}:sha256:${createHash("sha256").update(raw).digest("hex")}`;

  const { data, error } = await getSupabaseAdmin().rpc("record_inbound_event", {
    p_provider: "make",
    p_event_id: eventId,
    p_event_type: eventType,
    p_payload: body,
  });
  if (error) return jsonError(500, "No se pudo guardar el evento", requestId, error);
  const inserted = Boolean((data as { inserted?: boolean } | null)?.inserted);

  if (inserted) {
    after(async () => {
      try {
        await processInbox({ limit: 20 });
      } catch (err) {
        console.error(`[req ${requestId}] procesamiento diferido falló; lo retomará el worker`, err);
      }
    });
  }
  return NextResponse.json({ accepted: true, duplicate: !inserted, request_id: requestId }, { status: 202 });
}
