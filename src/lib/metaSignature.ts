import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifica `X-Hub-Signature-256` de Meta: HMAC-SHA256 de los BYTES ORIGINALES
 * del cuerpo con el App Secret de la app de Meta (no el verify token del
 * handshake GET). Comparación en tiempo constante.
 */
export function verifyMetaSignature(rawBody: string | Buffer, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const provided = Buffer.from(match[1], "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export interface MetaInboundItem {
  provider: "meta_whatsapp";
  event_id: string;
  event_type: "message" | "status";
  payload: Record<string, unknown>;
}

interface MetaPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<{ from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } }>;
        statuses?: Array<{ id?: string; status?: string; timestamp?: string; recipient_id?: string }>;
      };
    }>;
  }>;
}

/** Extrae TODOS los mensajes y estados del payload (no solo el primero). */
export function extractMetaEvents(payload: unknown): MetaInboundItem[] {
  const items: MetaInboundItem[] = [];
  const entries = (payload as MetaPayload)?.entry;
  if (!Array.isArray(entries)) return items;
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;
      for (const m of value.messages ?? []) {
        if (!m?.id || !m.from) continue;
        const contactName = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        items.push({
          provider: "meta_whatsapp",
          event_id: m.id,
          event_type: "message",
          payload: {
            from: m.from,
            type: m.type ?? null,
            text: m.type === "text" ? (m.text?.body ?? "").slice(0, 4000) : "",
            timestamp: m.timestamp ?? null,
            contact_name: contactName,
          },
        });
      }
      for (const s of value.statuses ?? []) {
        if (!s?.id || !s.status) continue;
        items.push({
          provider: "meta_whatsapp",
          event_id: `${s.id}:${s.status}`,
          event_type: "status",
          payload: { message_id: s.id, status: s.status, timestamp: s.timestamp ?? null },
        });
      }
    }
  }
  return items;
}
