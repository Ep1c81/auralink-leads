import { NextResponse } from "next/server";
import { createCampaign, listCampaigns } from "@/lib/outreachCampaigns";

export async function GET() {
  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ campaigns });
  } catch (err) {
    console.error("[outreach] failed to list campaigns:", err);
    return NextResponse.json({ error: "Failed to load campaigns" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const campaign = await createCampaign(name);
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    console.error("[outreach] failed to create campaign:", err);
    return NextResponse.json({ error: "Failed to create campaign" }, { status: 502 });
  }
}
