import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runAutoProspectSweep } from "@/lib/autoProspect";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Discovery is a billable operation: never trust Origin or a browser toggle
// as authorization. Use a server-side bearer token, never expose it as NEXT_PUBLIC.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !provided) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(provided);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  console.info("[prospecting-run] started", JSON.stringify({ runId, source: "manual-api" }));
  try {
    const result = await runAutoProspectSweep();
    const summary = result.results.map(({ niche, found, imported, qualified, outreachGenerated, errors }) => ({
      niche, found, imported, qualified, outreachGenerated, errorCount: errors.length,
    }));
    console.info("[prospecting-run] completed", JSON.stringify({ runId, durationMs: Date.now() - startedAt, summary }));
    return NextResponse.json({ ...result, runId });
  } catch (error) {
    console.error("[prospecting-run] failed", JSON.stringify({ runId, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "Unknown error" }));
    return NextResponse.json({ error: "Prospecting failed", runId }, { status: 500 });
  }
}

export async function POST(request: Request) { return handle(request); }
export async function GET() { return NextResponse.json({ error: "Method not allowed" }, { status: 405 }); }
