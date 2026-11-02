import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * Utilidades HTTP comunes: request_id, errores en español sin detalles
 * internos, validación de JSON con límite de tamaño, y verificación de
 * origen (CSRF) para mutaciones autenticadas por cookie.
 */

export function newRequestId(): string {
  return randomUUID();
}

/**
 * Respuesta de error para el operador o la integración. `message` es texto
 * en español apto para mostrar; `internal` va SOLO al log del servidor junto
 * con el request_id para poder correlacionar.
 */
export function jsonError(
  status: number,
  message: string,
  requestId: string,
  internal?: unknown,
  extra?: Record<string, unknown>
): NextResponse {
  if (internal !== undefined) {
    console.error(`[req ${requestId}] ${status} ${message}`, sanitizeForLog(internal));
  }
  return NextResponse.json({ error: message, request_id: requestId, ...extra }, { status });
}

/** Reduce un error a nombre/mensaje/código, sin objetos con posibles secretos. */
export function sanitizeForLog(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    const code = (value as NodeJS.ErrnoException).code;
    return { name: value.name, message: value.message.slice(0, 500), ...(code ? { code } : {}) };
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return {
      message: typeof v.message === "string" ? v.message.slice(0, 500) : undefined,
      code: v.code,
    };
  }
  return { message: String(value).slice(0, 500) };
}

export class RequestValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Lee el cuerpo como texto respetando un límite de bytes. */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new RequestValidationError("El contenido es demasiado grande", 413);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new RequestValidationError("El contenido es demasiado grande", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parsea y valida JSON con un esquema zod. Lanza RequestValidationError. */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes = 16_384
): Promise<z.infer<T>> {
  const raw = await readBodyLimited(request, maxBytes);
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new RequestValidationError("El cuerpo no es JSON válido");
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join(".") || "cuerpo";
    throw new RequestValidationError(`Dato inválido en «${path}»`);
  }
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Protección CSRF para rutas autenticadas por cookie: en mutaciones exige que
 * `Origin` (o, si falta, `Referer`) coincida con el host de la solicitud o con
 * APP_ORIGIN. También rechaza `Sec-Fetch-Site: cross-site`. Las cookies de
 * Supabase ya son SameSite=Lax; esto es una segunda barrera.
 */
export function isSameOriginMutation(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const allowed = allowedOrigins(request);
  const origin = request.headers.get("origin");
  if (origin) return allowed.has(origin.toLowerCase());
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin.toLowerCase());
    } catch {
      return false;
    }
  }
  // Sin Origin ni Referer en una mutación: no es un navegador moderno
  // haciendo fetch same-origin. Se rechaza.
  return false;
}

function allowedOrigins(request: Request): Set<string> {
  const set = new Set<string>();
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) {
    for (const o of configured.split(",")) {
      const t = o.trim().replace(/\/$/, "").toLowerCase();
      if (t) set.add(t);
    }
  }
  const url = new URL(request.url);
  set.add(url.origin.toLowerCase());
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    set.add(`${proto}://${host}`.toLowerCase());
  }
  return set;
}
