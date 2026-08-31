import { NextResponse } from "next/server";
import { getCampaign, listMessagesForCampaign } from "@/lib/outreachCampaigns";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  try {
    const messages = await listMessagesForCampaign(id);
    return NextResponse.json({ campaign, messages });
  } catch (err) {
    console.error(`[outreach] failed to load campaign ${id}:`, err);
    return NextResponse.json({ error: "Failed to load campaign" }, { status: 502 });
  }
}
