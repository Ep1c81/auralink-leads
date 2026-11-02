import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError } from "@/lib/http";
import { supabaseAdmin as supabase } from "@/lib/supabase/admin";
import { generateAndSaveOutreach } from "@/lib/outreach";
import type { Lead } from "@/lib/types";

/**
 * Generates a tailored Spanish WhatsApp pitch + email outreach template for
 * a qualified lead, based on its business category and BANT qualification.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);

  const { data: lead, error: fetchError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !lead) {
    return jsonError(404, "No se encontró el prospecto", requestId);
  }

  if ((lead as Lead).status !== "qualified") {
    return jsonError(400, "El prospecto debe estar calificado antes de preparar el mensaje", requestId);
  }

  try {
    const result = await generateAndSaveOutreach(lead as Lead);
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[outreach] request failed for lead ${id}:`, err);
    return jsonError(502, "No se pudo preparar el mensaje", requestId);
  }
}
