import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError } from "@/lib/http";
import { generateDraftMessage } from "@/lib/outreachCampaigns";

const KNOWN_ERRORS: Record<string, [number, string]> = {
  "Message not found": [404, "No se encontró el mensaje"],
  "Lead not found": [404, "No se encontró el prospecto"],
  "Campaign not found": [404, "No se encontró la campaña"],
  "Only draft messages can be edited": [409, "Solo se pueden editar borradores"],
  "Only draft messages can be queued": [409, "Este mensaje ya fue aprobado o cambió de estado"],
};


/**
 * Generates a draft outreach email for a lead within a campaign via Claude
 * and persists it with status "draft". Returns the draft for the review UI —
 * never auto-transitions to "queued".
 */
export async function POST(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const body = await request.json().catch(() => null);
  const leadId = body?.lead_id;
  const campaignId = body?.campaign_id;

  if (!isUuid(leadId) || !isUuid(campaignId)) {
    return jsonError(400, "Faltan el prospecto o la campaña", requestId);
  }

  try {
    const message = await generateDraftMessage(leadId, campaignId);
    return NextResponse.json({ message });
  } catch (err) {
    console.error(`[outreach] draft generation failed for lead ${leadId}:`, err);
    const known = KNOWN_ERRORS[err instanceof Error ? err.message : ""];
    if (known) return jsonError(known[0], known[1], requestId);
    return jsonError(502, "No se pudo completar la operación", requestId, err);
  }
}
