import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { searchBusinesses } from "@/lib/discovery";
import type { Lead } from "@/lib/types";

interface ProspectingPayload {
  industry: string;
  location: string;
  limit?: number;
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

  if (businesses.length === 0) {
    return NextResponse.json({ found: 0, imported: [], skipped: 0 });
  }

  const placeIds = businesses.map((b) => b.placeId);
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("metadata")
    .in("metadata->>place_id", placeIds);

  const existingPlaceIds = new Set(
    (existingLeads ?? [])
      .map((l) => (l.metadata as Record<string, unknown> | null)?.place_id)
      .filter((id): id is string => typeof id === "string")
  );

  const newBusinesses = businesses.filter(
    (b) => !existingPlaceIds.has(b.placeId)
  );

  if (newBusinesses.length === 0) {
    return NextResponse.json({
      found: businesses.length,
      imported: [],
      skipped: businesses.length,
    });
  }

  const { data: imported, error: insertError } = await supabase
    .from("leads")
    .insert(
      newBusinesses.map((b) => ({
        name: b.name,
        company: b.name,
        phone: b.phone,
        status: "new",
        metadata: {
          source: b.source,
          place_id: b.placeId,
          address: b.address,
          website: b.website,
          rating: b.rating,
          industry: payload.industry,
          location: payload.location,
        },
      }))
    )
    .select();

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to import leads" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    found: businesses.length,
    imported: imported as Lead[],
    skipped: businesses.length - newBusinesses.length,
  });
}
