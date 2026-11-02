import { timingSafeEqual, createHmac } from 'node:crypto';
export function sameSecret(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function allowedOperator(id: string, email: string | undefined, ids = process.env.OPERATOR_IDS, emails = process.env.OPERATOR_EMAILS): boolean {
  return (ids ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(id) ||
    Boolean(email && (emails ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean).includes(email.toLowerCase()));
}
export function validOrigin(request: Request): boolean {
  const configured = process.env.APP_ORIGIN;
  return Boolean(configured && request.headers.get('origin') === new URL(configured).origin);
}
export function validMetaSignature(raw: Uint8Array, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return sameSecret(signature, 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function readBody(request: Request, maxBytes = 65536): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  const timer = setTimeout(() => { void reader.cancel(); }, 10000);
  const deadline = Date.now() + 10000;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (Date.now() >= deadline) throw new Error('Tiempo de lectura agotado');
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Solicitud demasiado grande'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
