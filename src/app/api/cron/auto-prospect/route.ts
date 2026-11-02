import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { runAutoProspectSweep } from "@/lib/autoProspect";
import { jsonError } from "@/lib/http";
import { withJobLock } from "@/lib/jobLock";

// Barrido largo (búsqueda + calificación + borradores por prospecto nuevo).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Barrido manual desde el pipeline (botón «Auto-Pilot»). Solo operadores y
 * solo POST: un GET ya no dispara trabajo costoso. El acceso programado
 * (Vercel Cron) usa /api/cron/sweep con CRON_SECRET.
 */
export async function POST(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId, operator } = auth;

  try {
    const locked = await withJobLock("auto-prospect", `operator:${operator.email}`, 330, runAutoProspectSweep);
    if (locked.status === "busy") {
      return jsonError(409, "Ya hay un barrido en curso. Espere a que termine.", requestId);
    }
    return NextResponse.json(locked.result);
  } catch (err) {
    return jsonError(502, "No se pudo completar el barrido", requestId, err);
  }
}
