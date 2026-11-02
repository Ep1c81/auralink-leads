import { after, NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonError, newRequestId, readBodyLimited, RequestValidationError } from "@/lib/http";
import { safeEqual } from "@/lib/machineAuth";
import { extractMetaEvents, verifyMetaSignature } from "@/lib/metaSignature";
import { processInbox } from "@/lib/inbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Handshake de verificación de Meta (usa el VERIFY TOKEN, no el App Secret).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  const token = params.get("hub.verify_token") ?? "";
  if (expected && params.get("hub.mode") === "subscribe" && safeEqual(token, expected)) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Eventos de WhatsApp Cloud API. Orden estricto:
 *  1. Leer bytes originales (con límite).
 *  2. Verificar X-Hub-Signature-256 con WHATSAPP_APP_SECRET. Firma inválida
 *     -> 401 sin escribir nada.
 *  3. Persistir cada mensaje/estado en inbound_events (único por id).
 *  4. Responder 200. La calificación con IA y demás trabajo corre después
 *     (after() + worker programado), con reintentos.
 */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) {
    return jsonError(503, "Webhook no configurado", requestId, new Error("Falta WHATSAPP_APP_SECRET"));
  }

  let raw: string;
  try {
    raw = await readBodyLimited(request, 512 * 1024);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    return jsonError(401, "Firma inválida", requestId);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonError(400, "El cuerpo no es JSON válido", requestId);
  }

  const events = extractMetaEvents(payload);
  const db = getSupabaseAdmin();
  let inserted = 0;
  for (const event of events) {
    const { data, error } = await db.rpc("record_inbound_event", {
      p_provider: event.provider,
      p_event_id: event.event_id,
      p_event_type: event.event_type,
      p_payload: event.payload,
    });
    if (error) {
      // 500: Meta reintentará; lo ya guardado se deduplica por id.
      return jsonError(500, "No se pudo guardar el evento", requestId, error);
    }
    if ((data as { inserted?: boolean } | null)?.inserted) inserted++;
  }

  if (inserted > 0) {
    after(async () => {
      try {
        await processInbox({ limit: 20 });
      } catch (err) {
        console.error(`[req ${requestId}] procesamiento diferido falló; lo retomará el worker`, err);
      }
    });
  }
  return NextResponse.json({ received: events.length, new: inserted });
}
