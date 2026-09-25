import { dispatchPitches, handleDispatchRequest } from "@/lib/outreachAutomation";

export const dynamic = "force-dynamic";

/**
 * Stage 1 of the automated WhatsApp sequence: posts the soft-CTA pitch for a
 * batch of Queued bizmap_leads to MAKE_DISPATCH_WEBHOOK_URL, then marks them
 * "Pitch Sent". Requires `Authorization: Bearer <OUTREACH_AUTOMATION_SECRET>`.
 *
 * Query params: limit (default 25, max 100), dry_run=1 (return the payload
 * without sending or updating anything), mobile_only=1 (skip landlines).
 */
function handle(request: Request) {
  return handleDispatchRequest(request, dispatchPitches, "/api/outreach/dispatch");
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
