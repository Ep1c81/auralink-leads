import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isUuid, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Registra que el operador abrió WhatsApp manualmente con este prospecto
 * (envío hecho por una persona desde su teléfono, no automatizado). Solo
 * marca outreached_at la primera vez.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);

  try {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data, error } = await db
      .from("bizmap_leads")
      .update({ outreached_at: now, last_contacted_at: now })
      .eq("id", id)
      .is("outreached_at", null)
      .select("id, outreached_at")
      .maybeSingle();
    if (error) return jsonError(500, "No se pudo registrar el contacto", requestId, error);
    if (data) return NextResponse.json({ lead: data });

    const { data: existing, error: readError } = await db
      .from("bizmap_leads")
      .select("id, outreached_at")
      .eq("id", id)
      .maybeSingle();
    if (readError) return jsonError(500, "No se pudo registrar el contacto", requestId, readError);
    if (!existing) return jsonError(404, "No se encontró el prospecto", requestId);
    return NextResponse.json({ lead: existing });
  } catch (err) {
    return jsonError(503, "La base de datos no está disponible en este momento", requestId, err);
  }
}
