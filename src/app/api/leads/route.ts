import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonError } from "@/lib/http";
import { LEAD_COLUMNS } from "@/lib/leadColumns";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/** Pipeline BANT (`leads`). Solo operadores. Paginado en servidor. */
export async function GET(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;

  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const from = (page - 1) * PAGE_SIZE;

  try {
    const { data, error, count } = await getSupabaseAdmin()
      .from("leads")
      .select(LEAD_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return jsonError(500, "No se pudieron cargar los prospectos", requestId, error);
    return NextResponse.json({ leads: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE });
  } catch (err) {
    return jsonError(503, "La base de datos no está disponible en este momento", requestId, err);
  }
}
