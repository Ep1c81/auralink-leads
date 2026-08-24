import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifyLeadProfile, qualifyLeadProfileHeuristic } from "@/lib/qualification";
import { enrichAndSaveLead } from "@/lib/enrichment";
import { generateAndSaveOutreach } from "@/lib/outreach";
import { withDeadline } from "@/lib/timeout";
import type { Lead, OutreachContent } from "@/lib/types";

// Bounds the Gemini call. Left with ~1s of headroom under the 5s response
// guarantee for the instant heuristic fallback below, which does no
// Gemini/network calls and only a couple of fast Supabase round trips.
const PIPELINE_DEADLINE_MS = 4000;

const DEFAULT_CITY = "Santa Ana, CR";
const DEFAULT_CONTEXT_PROMPT =
  "Local business target for Google review acceleration, physical NFC tap standees, and automated WhatsApp patient/customer booking.";

interface QualifyPayload {
  lead_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  message?: string;
  // When true, applies the default high-value targeting context to the BANT
  // prompt and, on a "qualified" result, also generates outreach copy —
  // this is the single shared engine behind both the pipeline's "Qualify
  // lead" and "Auto-Qualify & Enrich" actions.
  auto_qualify?: boolean;
}

function buildAutoQualifyContextNote(lead: Lead): string {
  const category =
    typeof lead.metadata?.industry === "string" && lead.metadata.industry.trim()
      ? lead.metadata.industry
      : "local business";

  return `Business name: ${lead.name ?? lead.company ?? "unknown"}. Category: ${category}. City: ${DEFAULT_CITY}. ${DEFAULT_CONTEXT_PROMPT}`;
}

export async function POST(request: Request) {
  let payload: QualifyPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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

    // Email is optional on the intake form (and never sent by the pipeline's
    // qualify/auto-qualify actions); fall back to a placeholder so leads
    // without one can still be created without tripping Supabase's `email`
    // NOT NULL / schema validation.
    const email = payload.email || "no-email@placeholder.local";

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

  const contextNote = payload.auto_qualify ? buildAutoQualifyContextNote(lead) : undefined;

  // Uses profile-based qualification with retry + heuristic fallback, bounded
  // by a hard deadline, so a qualify request never fails outright or hangs
  // on a slow/erroring Gemini call — this always answers well within the 5s
  // the frontend expects.
  let result: Awaited<ReturnType<typeof qualifyLeadProfile>>;
  try {
    result = await withDeadline(
      (signal) => qualifyLeadProfile(lead, contextNote, signal),
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

  let finalLead = result.lead;
  let outreach: OutreachContent | null = null;

  if (result.qualification.status === "qualified") {
    try {
      const enriched = await enrichAndSaveLead(finalLead);
      if (enriched) {
        finalLead = enriched;
      }
    } catch (err) {
      console.error(`[qualify] enrichment threw for lead ${lead.id}:`, err);
    }

    if (payload.auto_qualify) {
      try {
        const outreachResult = await generateAndSaveOutreach(finalLead);
        finalLead = outreachResult.lead;
        outreach = outreachResult.outreach;
      } catch (err) {
        console.error(`[qualify] outreach generation threw for lead ${lead.id}:`, err);
      }
    }
  }

  return NextResponse.json({
    lead: finalLead,
    qualification: result.qualification,
    outreach,
  });
}
