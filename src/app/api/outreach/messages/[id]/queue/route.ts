import { withOperator } from '@/lib/security/auth';
import { NextResponse } from "next/server";
import { queueMessage } from "@/lib/outreachCampaigns";

/**
 * The human-review gate: approves a draft message and moves it to "queued",
 * firing the outbound webhook n8n watches for the actual send. Never called
 * automatically — only from the reviewer's explicit "Approve & queue" action.
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const input = await request.json();
    if(typeof input.subject!=="string" || typeof input.body!=="string" || typeof input.phone!=="string") return NextResponse.json({error:"Revisá el borrador."},{status:400});
    const message = await queueMessage(id,input);
    return NextResponse.json({ message });
  } catch (err) {
    console.error("route.ts: operación registrada");
    const errMessage = err instanceof Error ? err.message : String(err);
    const status = errMessage === "Message not found" ? 404 : 400;
    return NextResponse.json({ error: errMessage }, { status });
  }
}

export const POST = withOperator(handlePOST);
