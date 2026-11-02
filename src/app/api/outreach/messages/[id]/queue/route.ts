import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError } from "@/lib/http";
import { queueMessage } from "@/lib/outreachCampaigns";

const KNOWN_ERRORS: Record<string, [number, string]> = {
  "Message not found": [404, "No se encontró el mensaje"],
  "Lead not found": [404, "No se encontró el prospecto"],
  "Campaign not found": [404, "No se encontró la campaña"],
  "Only draft messages can be edited": [409, "Solo se pueden editar borradores"],
  "Only draft messages can be queued": [409, "Este mensaje ya fue aprobado o cambió de estado"],
};


/**
 * The human-review gate: approves a draft message and moves it to "queued",
 * firing the outbound webhook n8n watches for the actual send. Never called
 * automatically — only from the reviewer's explicit "Approve & queue" action.
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

  try {
    const message = await queueMessage(id);
    return NextResponse.json({ message });
  } catch (err) {
    console.error(`[outreach] failed to queue message ${id}:`, err);
    const known = KNOWN_ERRORS[err instanceof Error ? err.message : ""];
    if (known) return jsonError(known[0], known[1], requestId);
    return jsonError(502, "No se pudo completar la operación", requestId, err);
  }
}
