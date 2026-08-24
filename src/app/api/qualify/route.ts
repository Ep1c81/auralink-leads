import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifyLeadProfile } from "@/lib/qualification";
import type { Lead } from "@/lib/types";

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

  // Uses profile-based qualification with retry + heuristic fallback so a
  // manual prospect submission never fails outright on a Gemini error.
  try {
    const result = await qualifyLeadProfile(lead);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "Lead qualification failed", details: `${err}` },
      { status: 502 }
    );
  }
}
