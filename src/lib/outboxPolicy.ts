/**
 * Política pura (sin I/O) de reintentos para envíos a Make. Separada para
 * poder probarla sin red ni base de datos.
 */

export type SendOutcome =
  | { kind: "accepted"; httpStatus: number; error?: undefined; retryAfterMs?: undefined }
  | { kind: "retry"; httpStatus?: number; error: string; retryAfterMs?: number }
  | { kind: "failed"; httpStatus?: number; error: string; retryAfterMs?: undefined }
  | { kind: "uncertain"; httpStatus?: number; error: string; retryAfterMs?: undefined };

const BASE_MS = 30_000;
const CAP_MS = 60 * 60 * 1000;

/** Backoff exponencial con "full jitter": aleatorio en [base*2^n / 2, base*2^n]. */
export function computeBackoffMs(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(CAP_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

/** Retry-After en segundos o fecha HTTP; acotado a 1 hora. null si no aplica. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed) * 1000, CAP_MS);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - now, 0), CAP_MS);
}

/** Errores de red en los que es seguro afirmar que NADA llegó a Make. */
const PRE_CONNECT_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ERR_INVALID_URL"]);

function errorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let i = 0; i < 4 && current; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function classifyMakeResponse(
  input: { status: number; retryAfter?: string | null } | { error: unknown }
): SendOutcome {
  if ("error" in input) {
    const code = errorCode(input.error);
    const name = (input.error as { name?: string })?.name;
    if (code && PRE_CONNECT_CODES.has(code)) {
      return { kind: "retry", error: `Sin conexión con Make (${code})` };
    }
    // Timeout o corte después de enviar: Make pudo haberlo recibido.
    const label = name === "TimeoutError" || name === "AbortError" ? "Tiempo de espera agotado" : "Conexión interrumpida";
    return { kind: "uncertain", error: `${label}${code ? ` (${code})` : ""}` };
  }

  const { status } = input;
  if (status >= 200 && status < 300) return { kind: "accepted", httpStatus: status };
  if (status === 429 || status === 408 || (status >= 500 && status <= 599)) {
    return {
      kind: "retry",
      httpStatus: status,
      error: `Make respondió ${status}`,
      retryAfterMs: parseRetryAfter(input.retryAfter) ?? undefined,
    };
  }
  return { kind: "failed", httpStatus: status, error: `Make rechazó el envío (${status})` };
}
