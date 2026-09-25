import { dispatchFollowUps, handleDispatchRequest } from "@/lib/outreachAutomation";

export const dynamic = "force-dynamic";

/**
 * Stage 2 of the automated WhatsApp sequence: finds leads still at "Pitch
 * Sent" with no reply 3+ days after contact, posts the follow-up bump to
 * MAKE_DISPATCH_WEBHOOK_URL tagged `sequence_stage: "followup_2"`, then marks
 * them "Followup Sent". Meant to be called on a schedule (e.g. a daily Make
 * scenario). Same auth and query params as /api/outreach/dispatch.
 */
function handle(request: Request) {
  return handleDispatchRequest(request, dispatchFollowUps, "/api/outreach/followup-check");
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
