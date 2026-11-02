import 'server-only';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import ipaddr from 'ipaddr.js';
export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function safeFetch(url: string, redirects = 0, deadline = Date.now() + 12000): Promise<Response> {
  const target = new URL(url);
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || (target.port && target.port !== (target.protocol === 'https:' ? '443' : '80')) || redirects > 4) throw new Error('Destino no permitido');
  const host = target.hostname.replace(/^\[|\]$/g, '');
  // La resolución y conexión comparten una IP verificada; no hay una segunda resolución.
  const remaining = () => Math.max(1, deadline - Date.now());
  const records = await Promise.race([lookup(host, { all: true }), new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('Tiempo agotado')), remaining()); t.unref(); })]);
  if (!records.length || records.some(r => !publicAddress(r.address))) throw new Error('Dirección no pública');
  if (Date.now() >= deadline) throw new Error('Tiempo agotado');
  const pinned = records[0];
  const result = await new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = transport(target, { method: 'GET', headers: { 'User-Agent': 'AuralinkLeads/1.0', Accept: 'text/html,application/json', 'Accept-Encoding': 'identity' }, lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family) }, res => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1048576) { res.destroy(); req.destroy(new Error('Respuesta demasiado grande')); } else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => { const headers: Record<string, string> = {}; for (const [key, value] of Object.entries(res.headers)) if (typeof value === 'string') headers[key] = value; resolve({ status: res.statusCode ?? 502, headers, body: Buffer.concat(chunks) }); });
    });
    const timer = setTimeout(() => req.destroy(new Error('Tiempo agotado')), remaining());
    req.on('error', reject); req.on('close', () => clearTimeout(timer)); req.end();
  });
  if (result.status >= 300 && result.status < 400 && result.headers.location) return safeFetch(new URL(result.headers.location, target).href, redirects + 1, deadline);
  return new Response(result.status === 204 || result.status === 304 ? null : new Uint8Array(result.body), { status: result.status, headers: result.headers });
}
