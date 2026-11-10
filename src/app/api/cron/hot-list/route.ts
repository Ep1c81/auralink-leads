import { NextResponse } from "next/server";
import { getHotListView, runHotListSweep, sendHotListAlert } from "@/lib/hotList";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Same fail-closed CRON_SECRET check as /api/cron/sweep.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sweep = await runHotListSweep();

  let todayCount = 0;
  try {
    const view = await getHotListView();
    todayCount = view.today.length;
    const appUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null;
    await sendHotListAlert(view, appUrl);
  } catch (err) {
    sweep.errors.push(`View failed: ${err instanceof Error ? err.message : err}`);
  }

  return NextResponse.json({ ...sweep, todayCount });
}

export const GET = handle;
export const POST = handle;
