import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperatorApi } from "@/lib/auth";
import { deepEnrichLead } from "@/lib/deepEnrichment";
import { jsonError, parseJsonBody, RequestValidationError } from "@/lib/http";

const schema = z.object({
  lead_id: z.string().uuid(),
  website_url: z.string().trim().max(2048).optional().nullable(),
});

/**
 * Enriquecimiento de contacto desde el sitio web del prospecto. Solo
 * operadores. Las descargas pasan por safeFetch (protección SSRF).
 */
export async function POST(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;

  let body: z.infer<typeof schema>;
  try {
    body = await parseJsonBody(request, schema, 4096);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }

  const lead = await deepEnrichLead(body.lead_id, body.website_url ?? null);
  if (!lead) return jsonError(502, "No se pudo enriquecer el prospecto", requestId);
  return NextResponse.json({ lead });
}
