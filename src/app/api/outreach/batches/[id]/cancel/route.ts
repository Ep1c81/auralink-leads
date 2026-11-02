import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError } from "@/lib/http";
import { cancelBatch } from "@/lib/outbox";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId, operator } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);
  try {
    return NextResponse.json({ cancelled: await cancelBatch(id, operator.email) });
  } catch (err) {
    return jsonError(502, "No se pudo cancelar el lote", requestId, err);
  }
}
