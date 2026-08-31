import { NextResponse } from "next/server";
import { generateDraftMessage } from "@/lib/outreachCampaigns";

/**
 * Generates a draft outreach email for a lead within a campaign via Gemini
 * and persists it with status "draft". Returns the draft for the review UI —
 * never auto-transitions to "queued".
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const leadId = body?.lead_id;
  const campaignId = body?.campaign_id;

  if (typeof leadId !== "string" || typeof campaignId !== "string") {
    return NextResponse.json(
      { error: "lead_id and campaign_id are required" },
      { status: 400 }
    );
  }

  try {
    const message = await generateDraftMessage(leadId, campaignId);
    return NextResponse.json({ message });
  } catch (err) {
    console.error(`[outreach] draft generation failed for lead ${leadId}:`, err);
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "Lead not found" || message === "Campaign not found" ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
