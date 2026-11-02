import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperatorApi } from "@/lib/auth";
import { jsonError, parseJsonBody, RequestValidationError } from "@/lib/http";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function readSettings() {
  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("key, value, updated_at, updated_by")
    .in("key", ["sends_enabled", "daily_send_cap"]);
  if (error) throw error;
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r]));
  return {
    sends_enabled: map.sends_enabled?.value === true,
    daily_send_cap: Number(map.daily_send_cap?.value ?? 0),
    updated_at: map.sends_enabled?.updated_at ?? null,
    updated_by: map.sends_enabled?.updated_by ?? null,
  };
}

export async function GET(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await readSettings());
  } catch (err) {
    return jsonError(500, "No se pudo leer la configuración", auth.requestId, err);
  }
}

const schema = z
  .object({
    sends_enabled: z.boolean().optional(),
    daily_send_cap: z.number().int().min(0).max(250).optional(),
  })
  .refine((v) => v.sends_enabled !== undefined || v.daily_send_cap !== undefined);

/**
 * Interruptor global de envíos y límite diario. Cualquier operador puede
 * PAUSAR; activar envíos o subir el límite requiere rol admin.
 */
export async function PATCH(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId, operator } = auth;
  let body: z.infer<typeof schema>;
  try {
    body = await parseJsonBody(request, schema, 1024);
  } catch (err) {
    if (err instanceof RequestValidationError) return jsonError(err.status, err.message, requestId);
    throw err;
  }
  const escalates = body.sends_enabled === true || body.daily_send_cap !== undefined;
  if (escalates && operator.role !== "admin") {
    return jsonError(403, "Solo un administrador puede activar envíos o cambiar el límite", requestId);
  }
  const now = new Date().toISOString();
  const rows = [
    ...(body.sends_enabled !== undefined ? [{ key: "sends_enabled", value: body.sends_enabled }] : []),
    ...(body.daily_send_cap !== undefined ? [{ key: "daily_send_cap", value: body.daily_send_cap }] : []),
  ].map((r) => ({ ...r, updated_at: now, updated_by: operator.email }));
  const { error } = await getSupabaseAdmin().from("app_settings").upsert(rows);
  if (error) return jsonError(500, "No se pudo guardar la configuración", requestId, error);
  return NextResponse.json(await readSettings());
}
