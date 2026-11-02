import "server-only";
import { NextResponse } from "next/server";
export type BizmapOutreachStatus =
  | "Queued"
  | "Pitch Sent"
  | "Followup Sent"
  | "Replied"
  | "Closed"
  | "No WhatsApp (landline)"
  | "No WhatsApp (mobile)"
  | "Invalid Number"
  | "Wrong Business";

export function checkAutomationAuth(request: Request): NextResponse | null {
  const secret = process.env.OUTREACH_AUTOMATION_SECRET;
  if (!secret) {
    console.error("outreachAutomation.ts: operación registrada");
    return NextResponse.json({ error: "Endpoint not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
