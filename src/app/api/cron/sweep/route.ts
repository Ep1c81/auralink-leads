import { NextResponse } from "next/server";
import { runAutoProspectSweep } from "@/lib/autoProspect";

// Same rationale as src/app/api/cron/auto-prospect/route.ts: a multi-niche
// discovery + qualify + outreach sweep is a long-running background job,
// not a snappy request, so give it headroom on platforms that support
// extending the default function timeout (e.g. Vercel).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Verifies the request carries `Authorization: Bearer <CRON_SECRET>`. Once
 * a project's CRON_SECRET environment variable is set, Vercel Cron Jobs
 * automatically attach this header on every scheduled invocation, so this
 * check is what makes sure only Vercel's own scheduler (or someone who has
 * the secret) can trigger the sweep:
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: with no secret configured, nobody — not even a genuine
    // Vercel Cron invocation — can trigger this route. Set CRON_SECRET (see
    // .env.example) to enable it.
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Vercel-Cron entry point for the auto-prospect sweep — business discovery,
 * weak-review filtering (rating < 4.2 or < 15 reviews), BANT scoring, and
 * Spanish "Reputation Shield" WhatsApp pitch generation (see
 * src/lib/autoProspect.ts for the actual logic, shared with the dashboard's
 * unauthenticated /api/cron/auto-prospect toggle endpoint). Scheduled in
 * vercel.json to run daily; requires a valid CRON_SECRET bearer token, so
 * every unauthenticated caller gets a 401 instead of triggering a sweep.
 */
async function handleCronRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAutoProspectSweep();
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}
