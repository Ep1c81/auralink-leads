import { NextResponse } from "next/server";
import { z } from "zod";
import { applyInboundStatus } from "@/lib/outreachCampaigns";
import { jsonError, newRequestId, parseJsonBody, RequestValidationError } from "@/lib/http";
import { requireMachine } from "@/lib/machineAuth";

const schema = z.object({
  message_id: z.string().uuid(),
  status: z.enum(["sent", "failed", "bounced"]),
  provider_message_id: z.string().trim().max(200).optional(),
});

/**
 * n8n informa el resultado de un correo (outreach_messages). Exige el
 * encabezado `x-outreach-secret` (OUTREACH_STATUS_SECRET). Los estados no
 * retroceden: ver applyInboundStatus.
 */
export async function POST(request: Request) {
  const denied = requireMachine(request, ["OUTREACH_STATUS_SECRET"], { header: "x-outreach-secret" });
  if (denied) return denied;
  const requestId = newRequestId();

  let body: z.infer<typeof schema>;
  try {
    body = await parseJsonBody(request, schema, 4096);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }

  try {
    const message = await applyInboundStatus(body.message_id, body.status, body.provider_message_id);
    return NextResponse.json({ message });
  } catch (err) {
    return jsonError(502, "No se pudo actualizar el mensaje", requestId, err);
  }
}
