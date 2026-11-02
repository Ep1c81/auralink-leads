import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError, parseJsonBody, RequestValidationError } from "@/lib/http";
import { approveBatch, processOutbox } from "@/lib/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ content_hash: z.string().regex(/^[0-9a-f]{32}$/) });

const REASONS: Record<string, [number, string]> = {
  no_existe: [404, "El lote no existe"],
  expired: [409, "El lote venció. Prepare uno nuevo para revisar los datos actuales."],
  changed: [409, "El lote cambió desde que lo revisó. Prepárelo de nuevo."],
  empty: [409, "El lote no tiene destinatarios"],
  cancelled: [409, "El lote fue cancelado"],
};

/**
 * Aprobación comercial: UNA acción del operador que pone en cola el lote
 * exacto que revisó (verificado por hash). Idempotente ante doble clic.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId, operator } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);

  let body: z.infer<typeof schema>;
  try {
    body = await parseJsonBody(request, schema, 1024);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }

  try {
    const result = await approveBatch(id, body.content_hash, operator.email);
    if (!result.ok) {
      const [status, message] = REASONS[result.reason] ?? [409, "No se pudo aprobar el lote"];
      return jsonError(status, message, requestId);
    }
    // Arranque inmediato del worker (el programado lo retoma si esto falla).
    after(async () => {
      try {
        await processOutbox({ limit: 10 });
      } catch (err) {
        console.error(`[req ${requestId}] worker inmediato falló; lo retomará el programado`, err);
      }
    });
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(502, "No se pudo aprobar el lote", requestId, err);
  }
}
