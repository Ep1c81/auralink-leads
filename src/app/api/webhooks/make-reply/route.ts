import { z } from "zod";
import { ingestMakeEvent } from "@/lib/makeWebhook";

export const dynamic = "force-dynamic";

/**
 * Make avisa que un prospecto respondió por WhatsApp. Cuerpo:
 *   { event_id?, lead_id?, phone?, message_text?, external_chat_id? }
 * Se requiere lead_id o phone. Si el texto pide la baja, se registra la
 * exclusión. Autenticación: `Authorization: Bearer <OUTREACH_AUTOMATION_SECRET>`.
 */
const schema = z
  .object({
    event_id: z.string().trim().min(1).max(200).optional(),
    lead_id: z.string().uuid().optional(),
    phone: z.string().trim().max(40).optional(),
    message_text: z.string().max(4000).optional(),
    external_chat_id: z.string().trim().max(200).optional(),
  })
  .refine((v) => Boolean(v.lead_id || v.phone), { path: ["lead_id"] });

export async function POST(request: Request) {
  return ingestMakeEvent(request, "reply", schema);
}
