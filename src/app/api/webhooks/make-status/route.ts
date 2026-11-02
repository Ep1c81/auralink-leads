import { z } from "zod";
import { ingestMakeEvent } from "@/lib/makeWebhook";

export const dynamic = "force-dynamic";

/**
 * Estado de un envío informado por Make/ManyChat. Cuerpo:
 *   { event_id?, send_id, status: accepted|delivered|read|failed, provider_ref?, detail? }
 * Solo con este callback un envío pasa a "Entregado" o "Leído". Los estados
 * nunca retroceden (un callback tardío se ignora).
 */
const schema = z.object({
  event_id: z.string().trim().min(1).max(200).optional(),
  send_id: z.string().uuid(),
  status: z.enum(["accepted", "delivered", "read", "failed"]),
  provider_ref: z.string().trim().max(200).optional(),
  detail: z.string().max(300).optional(),
});

export async function POST(request: Request) {
  return ingestMakeEvent(request, "status", schema);
}
