import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError } from "@/lib/http";
import { getCampaign, listMessagesForCampaign } from "@/lib/outreachCampaigns";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);

  const campaign = await getCampaign(id);
  if (!campaign) {
    return jsonError(404, "No se encontró la campaña", requestId);
  }

  try {
    const messages = await listMessagesForCampaign(id);
    return NextResponse.json({ campaign, messages });
  } catch (err) {
    console.error(`[outreach] failed to load campaign ${id}:`, err);
    return jsonError(502, "No se pudo cargar la campaña", requestId);
  }
}
