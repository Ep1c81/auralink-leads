import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { newRequestId } from "@/lib/http";

/**
 * Autenticación máquina-a-máquina (cron, Make, Shieldy, n8n) por secreto
 * compartido. Separada de la sesión de operador. Falla cerrada: sin secreto
 * configurado, nadie entra. Comparación en tiempo constante.
 */

export type MachineSecretName =
  | "CRON_SECRET"
  | "OUTREACH_AUTOMATION_SECRET"
  | "SHIELDY_INGEST_SECRET"
  | "OUTREACH_STATUS_SECRET";

export function safeEqual(a: string, b: string): boolean {
  // Hash a longitud fija para que timingSafeEqual no revele la longitud.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** true si la solicitud trae el secreto de alguno de los nombres indicados. */
export function hasMachineSecret(
  request: Request,
  names: MachineSecretName[],
  opts: { header?: string } = {}
): boolean {
  const provided = opts.header ? request.headers.get(opts.header)?.trim() ?? null : extractBearer(request);
  if (!provided) return false;
  return names.some((name) => {
    const expected = process.env[name]?.trim();
    return Boolean(expected) && safeEqual(provided, expected!);
  });
}

/**
 * Devuelve una respuesta de error o null si está autorizado. 503 si ningún
 * secreto aceptado está configurado (endpoint deshabilitado), 401 si no coincide.
 */
export function requireMachine(
  request: Request,
  names: MachineSecretName[],
  opts: { header?: string } = {}
): NextResponse | null {
  const requestId = newRequestId();
  const configured = names.some((n) => Boolean(process.env[n]?.trim()));
  if (!configured) {
    console.error(`[req ${requestId}] endpoint máquina sin secreto configurado (${names.join("|")})`);
    return NextResponse.json(
      { error: "Integración no configurada", request_id: requestId },
      { status: 503 }
    );
  }
  if (!hasMachineSecret(request, names, opts)) {
    return NextResponse.json({ error: "No autorizado", request_id: requestId }, { status: 401 });
  }
  return null;
}
