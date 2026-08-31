import { NextResponse } from "next/server";
import { applyInboundStatus } from "@/lib/outreachCampaigns";
import type { OutreachMessageStatus } from "@/lib/types";

const VALID_STATUSES: OutreachMessageStatus[] = ["sent", "failed", "bounced"];

/**
 * n8n calls this after a send attempt to update outreach_messages.status and
 * provider_message_id. Requires a shared-secret header (OUTREACH_STATUS_SECRET)
 * — requests without a matching header are rejected before touching the DB.
 */
export async function POST(request: Request) {
  const expectedSecret = process.env.OUTREACH_STATUS_SECRET;
  if (!expectedSecret) {
    console.error("[outreach-status] OUTREACH_STATUS_SECRET not configured; rejecting request");
    return NextResponse.json({ error: "Endpoint not configured" }, { status: 503 });
  }

  const providedSecret = request.headers.get("x-outreach-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const messageId = body?.message_id;
  const status = body?.status;
  const providerMessageId =
    typeof body?.provider_message_id === "string" ? body.provider_message_id : undefined;

  if (typeof messageId !== "string" || !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `message_id (string) and status (${VALID_STATUSES.join("|")}) are required` },
      { status: 400 }
    );
  }

  try {
    const message = await applyInboundStatus(messageId, status, providerMessageId);
    return NextResponse.json({ message });
  } catch (err) {
    console.error(`[outreach-status] failed to update message ${messageId}:`, err);
    return NextResponse.json({ error: "Failed to update message" }, { status: 502 });
  }
}
