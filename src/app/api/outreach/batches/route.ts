import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperatorApi } from "@/lib/auth";
import { jsonError, parseJsonBody, RequestValidationError } from "@/lib/http";
import { prepareBatch } from "@/lib/outbox";

export const dynamic = "force-dynamic";

const schema = z.object({
  stage: z.enum(["pitch_1", "followup_2"]),
  limit: z.number().int().min(1).max(50).default(10),
  minScore: z.number().int().min(0).max(10).default(8),
  mobileOnly: z.boolean().default(true),
  leadIds: z.array(z.string().uuid()).max(50).optional(),
});

/**
 * Prepara un lote PENDIENTE DE APROBACIÓN. Lo que devuelve es exactamente
 * lo que se enviará si el operador lo aprueba (mismos destinatarios y
 * textos), con un hash del contenido que la aprobación debe presentar.
 */
export async function POST(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId, operator } = auth;

  let body: z.infer<typeof schema>;
  try {
    body = await parseJsonBody(request, schema, 8192);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }
  try {
    const batch = await prepareBatch(body, operator.email);
    return NextResponse.json(batch);
  } catch (err) {
    return jsonError(502, "No se pudo preparar el lote", requestId, err);
  }
}
