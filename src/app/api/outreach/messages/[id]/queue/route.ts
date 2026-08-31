import { NextResponse } from "next/server";
import { queueMessage } from "@/lib/outreachCampaigns";

/**
 * The human-review gate: approves a draft message and moves it to "queued",
 * firing the outbound webhook n8n watches for the actual send. Never called
 * automatically — only from the reviewer's explicit "Approve & queue" action.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const message = await queueMessage(id);
    return NextResponse.json({ message });
  } catch (err) {
    console.error(`[outreach] failed to queue message ${id}:`, err);
    const errMessage = err instanceof Error ? err.message : String(err);
    const status = errMessage === "Message not found" ? 404 : 400;
    return NextResponse.json({ error: errMessage }, { status });
  }
}
