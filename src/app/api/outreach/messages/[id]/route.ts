import { NextResponse } from "next/server";
import { getMessage, updateDraftMessage } from "@/lib/outreachCampaigns";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const message = await getMessage(id);
  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  return NextResponse.json({ message });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const fields: { subject?: string; body?: string } = {};
  if (typeof body?.subject === "string") fields.subject = body.subject;
  if (typeof body?.body === "string") fields.body = body.body;

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "subject and/or body required" }, { status: 400 });
  }

  try {
    const message = await updateDraftMessage(id, fields);
    return NextResponse.json({ message });
  } catch (err) {
    console.error(`[outreach] failed to update message ${id}:`, err);
    const errMessage = err instanceof Error ? err.message : String(err);
    const status = errMessage === "Message not found" ? 404 : 400;
    return NextResponse.json({ error: errMessage }, { status });
  }
}
