import { z } from "zod";
import { ingestMakeEvent } from "@/lib/makeWebhook";

export const dynamic = "force-dynamic";

/**
 * Make avisa que un envío falló (p. ej. número sin WhatsApp). Cuerpo:
 *   { event_id?, send_id?, lead_id?, phone?, error_message? }
 * Con send_id se marca ese envío como fallido; con lead_id/phone el
 * prospecto sale de la secuencia ("No WhatsApp").
 */
const schema = z
  .object({
    event_id: z.string().trim().min(1).max(200).optional(),
    send_id: z.string().uuid().optional(),
    lead_id: z.string().uuid().optional(),
    phone: z.string().trim().max(40).optional(),
    error_message: z.string().max(1000).optional(),
  })
  .refine((v) => Boolean(v.send_id || v.lead_id || v.phone), { path: ["send_id"] });

export async function POST(request: Request) {
  return ingestMakeEvent(request, "send_failed", schema);
}
