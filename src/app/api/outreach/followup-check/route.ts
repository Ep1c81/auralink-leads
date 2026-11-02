import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * RETIRADO. Este endpoint enviaba directamente a Make sin aprobación
 * comercial, sin reserva atómica y marcaba "enviado" con un 200 de Make.
 *
 * Nuevo flujo:
 *  - El operador prepara y aprueba lotes en /outreach (POST /api/outreach/batches
 *    y /api/outreach/batches/{id}/approve).
 *  - Un escenario programado llama a /api/cron/worker, que envía lo aprobado.
 * Ver docs/MAKE_Y_META.md.
 */
function gone() {
  return NextResponse.json(
    {
      error:
        "Endpoint retirado. Los envíos ahora se aprueban en la pantalla Mensajes y envíos y los despacha /api/cron/worker.",
    },
    { status: 410 }
  );
}

export async function GET() {
  return gone();
}

export async function POST() {
  return gone();
}
