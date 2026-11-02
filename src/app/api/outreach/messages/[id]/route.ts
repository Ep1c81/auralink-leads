import { withOperator } from '@/lib/security/auth';
import { NextResponse } from "next/server";
import { getMessage, updateDraftMessage } from "@/lib/outreachCampaigns";

async function handleGET(
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

async function handlePATCH(
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
    console.error("route.ts: operación registrada");
    const errMessage = err instanceof Error ? err.message : String(err);
    const status = errMessage === "Message not found" ? 404 : 400;
    return NextResponse.json({ error: errMessage }, { status });
  }
}

export const GET = withOperator(handleGET);
export const PATCH = withOperator(handlePATCH);
