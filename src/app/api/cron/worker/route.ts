import { NextResponse } from "next/server";
import { jsonError, newRequestId } from "@/lib/http";
import { processInbox } from "@/lib/inbox";
import { withJobLock } from "@/lib/jobLock";
import { requireMachine } from "@/lib/machineAuth";
import { processOutbox } from "@/lib/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Worker de colas: procesa eventos entrantes pendientes y luego envíos
 * aprobados (respetando interruptor, límite diario, reintentos y bajas).
 * Llamarlo cada 5-15 minutos desde un escenario programado de Make (o
 * Vercel Cron). Autenticación: Bearer CRON_SECRET u OUTREACH_AUTOMATION_SECRET.
 * GET permitido porque los programadores suelen usarlo; está autenticado.
 */
async function handle(request: Request) {
  const denied = requireMachine(request, ["CRON_SECRET", "OUTREACH_AUTOMATION_SECRET"]);
  if (denied) return denied;
  const requestId = newRequestId();
  try {
    const locked = await withJobLock("queue-worker", "worker", 150, async () => {
      const inbox = await processInbox({ limit: 30 });
      const outbox = await processOutbox({ limit: 10 });
      return { inbox, outbox };
    });
    if (locked.status === "busy") return NextResponse.json({ skipped: "Otro worker está activo" });
    return NextResponse.json(locked.result);
  } catch (err) {
    return jsonError(502, "El worker no pudo completar la ejecución", requestId, err);
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
