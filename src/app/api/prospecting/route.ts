import { NextResponse } from "next/server";
import {
  importDiscoveredBusinesses,
  isLowRatingTarget,
  searchBusinesses,
} from "@/lib/discovery";

interface ProspectingPayload {
  industry: string;
  location: string;
  limit?: number;
  /** Keep only businesses rated under 4.2, or with fewer than 15 reviews —
   *  prime targets for review management / tap standee outreach. */
  lowRatingOnly?: boolean;
}

export async function POST(request: Request) {
  let payload: ProspectingPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.industry || !payload.location) {
    return NextResponse.json(
      { error: "`industry` and `location` are required" },
      { status: 400 }
    );
  }

  let businesses;
  try {
    businesses = await searchBusinesses(
      payload.industry,
      payload.location,
      payload.limit
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Business discovery failed", details: `${err}` },
      { status: 502 }
    );
  }

  if (payload.lowRatingOnly) {
    businesses = businesses.filter(isLowRatingTarget);
  }

  if (businesses.length === 0) {
    return NextResponse.json({ found: 0, imported: [], skipped: 0 });
  }

  let imported;
  try {
    imported = await importDiscoveredBusinesses(
      businesses,
      payload.industry,
      payload.location
    );
  } catch (err) {
    console.error("[prospecting] import failed:", err);
    return NextResponse.json(
      { error: "Failed to import leads" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    found: businesses.length,
    imported,
    skipped: businesses.length - imported.length,
  });
}
