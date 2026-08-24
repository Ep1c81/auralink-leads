import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifyLeadProfile, qualifyLeadProfileHeuristic } from "@/lib/qualification";
import { withDeadline } from "@/lib/timeout";
import type { Lead } from "@/lib/types";

// Bounds the Gemini call. Left with ~1s of headroom under the 5s response
// guarantee for the instant heuristic fallback below, which does no
// Gemini/network calls and only a couple of fast Supabase round trips.
const PIPELINE_DEADLINE_MS = 4000;

interface QualifyPayload {
  lead_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  message: string;
}

export async function POST(request: Request) {
  let payload: QualifyPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.message || typeof payload.message !== "string") {
    return NextResponse.json(
      { error: "`message` is required to qualify a lead" },
      { status: 400 }
    );
  }

  let lead: Lead;

  if (payload.lead_id) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("id", payload.lead_id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    lead = data as Lead;
  } else {
    if (!payload.name && !payload.phone && !payload.company && !payload.email) {
      return NextResponse.json(
        {
          error:
            "`lead_id`, or at least one of `name`, `phone`, `company`, `email` is required",
        },
        { status: 400 }
      );
    }

    // Email is optional on the intake form; fall back to a generated
    // placeholder so leads without an email can still be identified/stored.
    const email = payload.email || `no-email+${randomUUID()}@placeholder.local`;

    const existing = payload.email
      ? (
          await supabase
            .from("leads")
            .select("*")
            .eq("email", payload.email)
            .maybeSingle()
        ).data
      : null;

    if (existing) {
      lead = existing as Lead;
    } else {
      const { data: created, error: createError } = await supabase
        .from("leads")
        .insert({
          name: payload.name,
          email,
          phone: payload.phone,
          company: payload.company,
          status: "new",
        })
        .select()
        .single();

      if (createError || !created) {
        return NextResponse.json(
          { error: "Failed to create lead" },
          { status: 500 }
        );
      }
      lead = created as Lead;
    }
  }

  // Uses profile-based qualification with retry + heuristic fallback, bounded
  // by a hard deadline, so a manual prospect submission never fails outright
  // or hangs on a slow/erroring Gemini call — this always answers well
  // within the 5s the frontend expects.
  let result: Awaited<ReturnType<typeof qualifyLeadProfile>>;
  try {
    result = await withDeadline(
      (signal) => qualifyLeadProfile(lead, undefined, signal),
      PIPELINE_DEADLINE_MS
    );
  } catch (err) {
    console.error(
      `[qualify] qualification failed or timed out for lead ${lead.id}, falling back to instant heuristic scoring:`,
      err
    );
    try {
      result = await qualifyLeadProfileHeuristic(lead);
    } catch (fallbackErr) {
      return NextResponse.json(
        { error: "Lead qualification failed", details: `${fallbackErr}` },
        { status: 502 }
      );
    }
  }

  return NextResponse.json(result);
}
