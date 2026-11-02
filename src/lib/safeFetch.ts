import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Fetch saliente endurecido contra SSRF, para URLs que vienen de usuarios o
 * de fuentes externas (sitios web de prospectos, etc.).
 *
 * - Solo http/https, sin credenciales en la URL, puertos 80/443.
 * - La validación de IP ocurre en el `lookup` que usa el socket al conectar:
 *   la dirección que se valida es la misma a la que se conecta (cubre DNS
 *   rebinding). Si un nombre resuelve a CUALQUIER IP bloqueada, se rechaza.
 * - IP literales se validan directamente (Node no llama `lookup` para ellas).
 * - Redirecciones manuales, cada salto revalidado, con máximo configurable.
 * - Un único plazo cubre conexión, cabeceras y lectura completa del body.
 * - Límite de bytes aplicado mientras se transmite.
 * - Ignora variables HTTP(S)_PROXY (http.request no las usa).
 *
 * Limitación: esto no reemplaza una restricción de salida a nivel de red
 * (firewall/egress). Vercel no ofrece una en el plan actual; ver docs/SEGURIDAD.md.
 */

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_url"
      | "blocked_destination"
      | "too_many_redirects"
      | "timeout"
      | "too_large"
      | "network"
  ) {
    super(message);
  }
}

const blockList = new net.BlockList();
const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
const V6_BLOCKS: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];
for (const [a, p] of V4_BLOCKS) blockList.addSubnet(a, p, "ipv4");
for (const [a, p] of V6_BLOCKS) blockList.addSubnet(a, p, "ipv6");

/** IPv4 embebida en ::ffff:a.b.c.d (mapeada) o 64:ff9b::/96 (NAT64). */
function embeddedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blockList.check(ip, "ipv4");
  if (family === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return isBlockedAddress(v4);
    if (/^::ffff:/i.test(ip) || /^64:ff9b::/i.test(ip)) return true; // forma rara: bloquear
    return blockList.check(ip, "ipv6");
  }
  return true; // no es IP: no debería llegar aquí
}

const ALLOWED_PORTS = new Set([80, 443]);

export function validateOutboundUrl(raw: string | URL, allowedPorts: Set<number> = ALLOWED_PORTS): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("URL inválida", "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("Solo se permiten URLs http o https", "invalid_url");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("La URL no puede incluir credenciales", "invalid_url");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!allowedPorts.has(port)) {
    throw new SafeFetchError("Puerto no permitido", "blocked_destination");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host.endsWith(".localhost") || host === "localhost") {
    throw new SafeFetchError("Destino no permitido", "blocked_destination");
  }
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new SafeFetchError("Destino no permitido", "blocked_destination");
  }
  return url;
}

type LookupAll = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultLookupAll: LookupAll = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** Solo para pruebas: resolver DNS alternativo. */
  lookupAll?: LookupAll;
  /** Solo para pruebas: política de direcciones alternativa. */
  isBlocked?: (ip: string) => boolean;
  /** Solo para pruebas: puertos permitidos (por defecto 80 y 443). */
  allowedPorts?: number[];
}

export interface SafeFetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  finalUrl: string;
  truncated: boolean;
}

function buildLookup(lookupAll: LookupAll, isBlocked: (ip: string) => boolean) {
  // Firma compatible con net.LookupFunction.
  return (
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
  ) => {
    lookupAll(hostname)
      .then((addresses) => {
        if (addresses.length === 0) throw new SafeFetchError("El dominio no resuelve", "network");
        if (addresses.some((a) => isBlocked(a.address))) {
          throw new SafeFetchError("Destino no permitido", "blocked_destination");
        }
        if (options && (options as { all?: boolean }).all) {
          callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      })
      .catch((err) => callback(err as NodeJS.ErrnoException, "", 0));
  };
}

function requestOnce(
  url: URL,
  opts: Required<Pick<SafeFetchOptions, "maxBytes" | "headers">> & {
    signal: AbortSignal;
    lookup: ReturnType<typeof buildLookup>;
    isBlocked: (ip: string) => boolean;
  }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        headers: { "accept-encoding": "identity", ...opts.headers },
        lookup: opts.lookup as unknown as net.LookupFunction,
        signal: opts.signal,
        agent: false,
      },
      (res) => {
        // Defensa adicional: verificar la IP remota real del socket.
        const remote = res.socket?.remoteAddress;
        if (remote && opts.isBlocked(remote)) {
          res.destroy();
          reject(new SafeFetchError("Destino no permitido", "blocked_destination"));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          total += chunk.length;
          if (total > opts.maxBytes) {
            truncated = true;
            const keep = chunk.length - (total - opts.maxBytes);
            if (keep > 0) chunks.push(chunk.subarray(0, keep));
            res.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (!truncated) {
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated });
          }
        });
        res.on("error", (err) => {
          if (!truncated) reject(err);
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * GET seguro. Lanza SafeFetchError en destinos bloqueados, timeout, etc.
 * Si la respuesta excede maxBytes, devuelve el contenido truncado con
 * `truncated: true` (útil para HTML) en lugar de fallar.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxBytes = options.maxBytes ?? 500_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const isBlocked = options.isBlocked ?? isBlockedAddress;
  const lookup = buildLookup(options.lookupAll ?? defaultLookupAll, isBlocked);
  const signal = AbortSignal.timeout(timeoutMs);

  const ports = options.allowedPorts ? new Set(options.allowedPorts) : ALLOWED_PORTS;
  let url = validateOutboundUrl(rawUrl, ports);
  if (options.isBlocked) {
    // Con política de pruebas, revalidar IP literal con esa política.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isBlocked(host)) throw new SafeFetchError("Destino no permitido", "blocked_destination");
  }

  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await requestOnce(url, { maxBytes, headers: options.headers ?? {}, signal, lookup, isBlocked });
    } catch (err) {
      if (err instanceof SafeFetchError) throw err;
      if (signal.aborted) throw new SafeFetchError("Tiempo de espera agotado", "timeout");
      throw new SafeFetchError(err instanceof Error ? err.message : "Error de red", "network");
    }

    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) throw new SafeFetchError("Demasiadas redirecciones", "too_many_redirects");
      url = validateOutboundUrl(new URL(location, url), ports);
      continue;
    }
    return {
      status: res.status,
      headers: res.headers,
      body: res.body.toString("utf8"),
      finalUrl: url.toString(),
      truncated: res.truncated,
    };
  }
}
