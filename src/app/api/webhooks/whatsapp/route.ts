import { createHash } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
import { readBody, sameSecret, validMetaSignature } from '@/lib/security/policy';
import { failure } from '@/lib/security/auth';
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  if (p.get('hub.mode') === 'subscribe' && sameSecret(p.get('hub.verify_token'), process.env.WHATSAPP_VERIFY_TOKEN)) return new Response(p.get('hub.challenge') ?? '');
  return failure(403, 'Verificación inválida.');
}
export async function POST(request: Request) {
  try {
    const raw = await readBody(request, 1048576);
    if (!validMetaSignature(raw, request.headers.get('x-hub-signature-256'), process.env.META_APP_SECRET)) return failure(401, 'Firma inválida.');
    const payload = JSON.parse(Buffer.from(raw).toString());
    if (payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return failure(400, 'Evento inválido.');
    const events = [];
    for (const entry of payload.entry) {
      if (!Array.isArray(entry.changes)) return failure(400, 'Evento inválido.');
      for (const change of entry.changes) {
        for (const kind of ['messages', 'statuses'] as const) {
          if (change.value?.[kind] !== undefined && !Array.isArray(change.value[kind])) return failure(400, 'Evento inválido.');
          for (const event of change.value?.[kind] ?? []) {
            if (typeof event.id !== 'string' || !event.id.length || event.id.length > 512) return failure(400, 'Identificador inválido.');
            if(kind==='messages' && (typeof event.from!=='string' || !/^[0-9]{7,15}$/.test(event.from) || typeof event.type!=='string'))return failure(400,'Remitente inválido.');
            if(kind==='statuses' && (typeof event.status!=='string'||typeof event.timestamp!=='string'))return failure(400,'Estado inválido.');
            const eventId = kind === 'messages' ? event.id : `${event.id}:${event.status}:${event.timestamp}`;
            events.push({ provider: 'meta', event_id: eventId, kind, payload: event });
          }
        }
        // Conserva otros eventos sin efectos automáticos.
        if (!change.value?.messages && !change.value?.statuses) events.push({ provider: 'meta', event_id: createHash('sha256').update(JSON.stringify(change)).digest('hex'), kind: 'other', payload: change });
      }
    }
    if (events.length > 1000) return failure(413, 'Demasiados eventos.');
    if (events.length) {
      const { error } = await getSupabase().from('integration_inbox').upsert(events, { onConflict: 'provider,event_id', ignoreDuplicates: true });
      if (error) return failure(503, 'No se pudo guardar el evento.');
    }
    return Response.json({ ok: true });
  } catch { return failure(400, 'No se pudo procesar el evento.'); }
}
