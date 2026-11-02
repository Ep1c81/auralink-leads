import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError, parseJsonBody, RequestValidationError } from "@/lib/http";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const schema = z.object({ note: z.string().trim().max(300).optional() });

/**
 * Reenvío auditado desde la cola de revisión (DLQ o incierto). Usa la misma
 * clave idempotente, para que Make pueda descartar un duplicado.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId, operator } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);
  let body: z.infer<typeof schema>;
  try {
    body = await parseJsonBody(request, schema, 2048);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }
  const { data, error } = await getSupabaseAdmin().rpc("replay_outreach_send", {
    p_id: id,
    p_actor: operator.email,
    p_note: body.note ?? null,
  });
  if (error) return jsonError(502, "No se pudo reenviar", requestId, error);
  if (!data) return jsonError(409, "Solo se pueden reenviar envíos inciertos o fallidos", requestId);
  return NextResponse.json({ ok: true });
}
