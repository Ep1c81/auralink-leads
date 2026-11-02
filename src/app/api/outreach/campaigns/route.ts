import { pageNumber } from "@/lib/pagination";
import { withOperator } from '@/lib/security/auth';
import { NextResponse } from "next/server";
import { createCampaign, listCampaigns } from "@/lib/outreachCampaigns";

async function handleGET(request: Request) {
  try {
    const campaigns = await listCampaigns(pageNumber(new URL(request.url).searchParams.get("page")));
    return NextResponse.json({ campaigns });
  } catch {
    console.error("route.ts: operación registrada");
    return NextResponse.json({ error: "Failed to load campaigns" }, { status: 502 });
  }
}

async function handlePOST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const campaign = await createCampaign(name);
    return NextResponse.json({ campaign }, { status: 201 });
  } catch {
    console.error("route.ts: operación registrada");
    return NextResponse.json({ error: "Failed to create campaign" }, { status: 502 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
