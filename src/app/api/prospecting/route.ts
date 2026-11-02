import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { z } from "zod";
import { jsonError, parseJsonBody, RequestValidationError } from "@/lib/http";
import { withJobLock } from "@/lib/jobLock";
import {
  importDiscoveredBusinesses,
  isLowRatingTarget,
  searchBusinesses,
} from "@/lib/discovery";

const schema = z.object({
  industry: z.string().trim().min(2).max(80),
  location: z.string().trim().min(2).max(120),
  limit: z.number().int().min(1).max(20).optional(),
  /** Solo negocios con calificación < 4.2 o < 15 reseñas en el proveedor. */
  lowRatingOnly: z.boolean().optional(),
});
type ProspectingPayload = z.infer<typeof schema>;

export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  let payload: ProspectingPayload;
  try {
    payload = await parseJsonBody(request, schema, 2048);
  } catch (err) {
    if (err instanceof RequestValidationError) {
      return jsonError(err.status, "Indique una categoría y una zona válidas", requestId);
    }
    throw err;
  }

  // Evita que dos pestañas o un cron simultáneo dupliquen la búsqueda.
  const locked = await withJobLock("discovery", `operator:${auth.operator.email}`, 120, () =>
    runProspecting(payload, requestId)
  );
  if (locked.status === "busy") {
    return jsonError(409, "Ya hay una búsqueda en curso. Espere a que termine.", requestId);
  }
  return locked.result;
}

async function runProspecting(payload: ProspectingPayload, requestId: string): Promise<NextResponse> {
  let businesses;
  try {
    businesses = await searchBusinesses(
      payload.industry,
      payload.location,
      payload.limit
    );
  } catch (err) {
    return jsonError(502, "No se pudo buscar negocios en este momento", requestId, err);
  }

  if (payload.lowRatingOnly) {
    businesses = businesses.filter(isLowRatingTarget);
  }

  if (businesses.length === 0) {
    return NextResponse.json({ found: 0, imported: [], skipped: 0 });
  }

  let imported;
  try {
    imported = await importDiscoveredBusinesses(
      businesses,
      payload.industry,
      payload.location
    );
  } catch (err) {
    return jsonError(500, "No se pudieron guardar los prospectos encontrados", requestId, err);
  }

  return NextResponse.json({
    found: businesses.length,
    imported,
    skipped: businesses.length - imported.length,
  });
}
