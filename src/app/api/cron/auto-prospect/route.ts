import { withOperator } from '@/lib/security/auth';
import { NextResponse } from "next/server";
import { runAutoProspectSweep } from "@/lib/autoProspect";

// This is a long-running background sweep (multi-niche discovery + one
// Claude qualification call + one Claude outreach call per new lead, each
// with its own retry/backoff) rather than a snappy user-facing request, so
// give it plenty of headroom on platforms that support extending the
// default function timeout (e.g. Vercel).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Dashboard-triggered entry point for the auto-prospect sweep (see
 * src/lib/autoProspect.ts for the actual discover -> import -> qualify ->
 * outreach logic) — this is what the "Run Background Auto-Pilot" toggle in
 * src/app/page.tsx calls. Deliberately unauthenticated, like the rest of
 * this app's dashboard-facing API surface, since it's only ever called
 * same-origin from the browser. For the secret-protected entry point meant
 * for an external scheduler (e.g. Vercel Cron), see
 * src/app/api/cron/sweep/route.ts instead.
 */
async function handleSweepRequest() {
  const result = await runAutoProspectSweep();
  return NextResponse.json(result);
}

async function handlePOST() {
  return handleSweepRequest();
}

async function handleGET() {
  return NextResponse.json({ error: "Usá POST para iniciar una búsqueda." }, { status: 405 });
}

export const POST = withOperator(handlePOST);
export const GET = withOperator(handleGET);
