import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { createCampaign, listCampaigns } from "@/lib/outreachCampaigns";

export async function GET(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ campaigns });
  } catch (err) {
    console.error("[outreach] failed to list campaigns:", err);
    return jsonError(502, "No se pudieron cargar las campañas", requestId);
  }
}

export async function POST(request: Request) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return jsonError(400, "Escriba un nombre para la campaña", requestId);
  }

  try {
    const campaign = await createCampaign(name);
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    console.error("[outreach] failed to create campaign:", err);
    return jsonError(502, "No se pudo crear la campaña", requestId);
  }
}
