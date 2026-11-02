import { NextResponse } from "next/server";
import { runAutoProspectSweep } from "@/lib/autoProspect";
import { jsonError, newRequestId } from "@/lib/http";
import { withJobLock } from "@/lib/jobLock";
import { requireMachine } from "@/lib/machineAuth";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Entrada de Vercel Cron para el barrido de prospección. Exige
 * `Authorization: Bearer <CRON_SECRET>` (Vercel lo envía solo). GET se
 * mantiene porque Vercel Cron invoca con GET; está autenticado.
 */
async function handle(request: Request) {
  const denied = requireMachine(request, ["CRON_SECRET"]);
  if (denied) return denied;
  const requestId = newRequestId();
  try {
    const locked = await withJobLock("auto-prospect", "cron", 330, runAutoProspectSweep);
    if (locked.status === "busy") return NextResponse.json({ skipped: "Ya hay un barrido en curso" });
    return NextResponse.json(locked.result);
  } catch (err) {
    return jsonError(502, "No se pudo completar el barrido", requestId, err);
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
