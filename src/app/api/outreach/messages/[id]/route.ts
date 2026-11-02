import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError } from "@/lib/http";
import { getMessage, updateDraftMessage } from "@/lib/outreachCampaigns";

const KNOWN_ERRORS: Record<string, [number, string]> = {
  "Message not found": [404, "No se encontró el mensaje"],
  "Lead not found": [404, "No se encontró el prospecto"],
  "Campaign not found": [404, "No se encontró la campaña"],
  "Only draft messages can be edited": [409, "Solo se pueden editar borradores"],
  "Only draft messages can be queued": [409, "Este mensaje ya fue aprobado o cambió de estado"],
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);

  const message = await getMessage(id);
  if (!message) {
    return jsonError(404, "No se encontró el mensaje", requestId);
  }

  return NextResponse.json({ message });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);
  const body = await request.json().catch(() => null);

  const fields: { subject?: string; body?: string } = {};
  if (typeof body?.subject === "string") fields.subject = body.subject;
  if (typeof body?.body === "string") fields.body = body.body;
  if ((fields.subject?.length ?? 0) > 300 || (fields.body?.length ?? 0) > 5000) {
    return jsonError(400, "El mensaje es demasiado largo (máximo 5000 caracteres)", requestId);
  }

  if (Object.keys(fields).length === 0) {
    return jsonError(400, "Escriba el asunto o el texto del mensaje", requestId);
  }

  try {
    const message = await updateDraftMessage(id, fields);
    return NextResponse.json({ message });
  } catch (err) {
    console.error(`[outreach] failed to update message ${id}:`, err);
    const known = KNOWN_ERRORS[err instanceof Error ? err.message : ""];
    if (known) return jsonError(known[0], known[1], requestId);
    return jsonError(502, "No se pudo completar la operación", requestId, err);
  }
}
