import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { listBizmapLeads, listQuerySchema } from "@/lib/bizmapLeads";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Oportunidades (bizmap_leads) paginadas y filtradas EN SERVIDOR, con
 * columnas explícitas y conteos agregados (sin descargar toda la tabla).
 * `include=summary` agrega totales y opciones de filtro.
 */
export async function GET(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;

  const params = new URL(request.url).searchParams;
  const parsed = listQuerySchema.safeParse(
    Object.fromEntries([...params.entries()].filter(([k, v]) => k !== "include" && v !== ""))
  );
  if (!parsed.success) return jsonError(400, "Filtros inválidos", requestId);

  try {
    const db = getSupabaseAdmin();
    const wantSummary = params.get("include") === "summary";
    const [list, summary, facets] = await Promise.all([
      listBizmapLeads(parsed.data),
      wantSummary ? db.rpc("bizmap_summary") : Promise.resolve(null),
      wantSummary ? db.rpc("bizmap_facets") : Promise.resolve(null),
    ]);
    if (summary?.error) throw summary.error;
    if (facets?.error) throw facets.error;
    return NextResponse.json({
      ...list,
      ...(summary ? { summary: summary.data } : {}),
      ...(facets ? { facets: facets.data } : {}),
    });
  } catch (err) {
    return jsonError(500, "No se pudieron cargar las oportunidades", requestId, err);
  }
}
