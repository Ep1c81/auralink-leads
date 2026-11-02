import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const FILTERS = ["review", "recent"] as const;

/**
 * Envíos para el panel: "review" = inciertos/fallidos que requieren
 * revisión; "recent" = últimos 50. Incluye la salud de la cola.
 */
export async function GET(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const raw = new URL(request.url).searchParams.get("filter");
  const filter = (FILTERS as readonly string[]).includes(raw ?? "") ? raw : "recent";

  const db = getSupabaseAdmin();
  let query = db
    .from("outreach_sends")
    .select(
      "id, lead_id, stage, wa_phone, business_name, status, status_detail, attempts, needs_review, accepted_at, delivered_at, read_at, last_http_status, created_at, updated_at"
    )
    .order("updated_at", { ascending: false })
    .limit(50);
  if (filter === "review") query = query.eq("needs_review", true);

  const [sends, health] = await Promise.all([query, db.rpc("outreach_health")]);
  if (sends.error) return jsonError(500, "No se pudieron cargar los envíos", requestId, sends.error);
  if (health.error) return jsonError(500, "No se pudo cargar el estado de la cola", requestId, health.error);
  return NextResponse.json({ sends: sends.data ?? [], health: health.data });
}
