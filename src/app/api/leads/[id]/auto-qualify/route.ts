import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifyLeadProfile } from "@/lib/qualification";
import { enrichAndSaveLead } from "@/lib/enrichment";
import { generateAndSaveOutreach } from "@/lib/outreach";
import type { Lead, OutreachContent } from "@/lib/types";

const DEFAULT_CITY = "Santa Ana, CR";
const DEFAULT_CONTEXT_PROMPT =
  "Local business target for Google review acceleration, physical NFC tap standees, and automated WhatsApp patient/customer booking.";

/**
 * One-click "Auto-Qualify & Enrich" action for a needs-more-info lead: packages
 * the business's name, category, and target city with a default high-value
 * context prompt, re-runs BANT qualification (retry + heuristic fallback via
 * qualifyLeadProfile/runBantQualificationFromProfileWithFallback), then —
 * when the result comes back qualified — best-effort enriches from the
 * lead's website and generates outreach copy, all in a single request.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: leadRow, error: fetchError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !leadRow) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const lead = leadRow as Lead;
  const category =
    typeof lead.metadata?.industry === "string" && lead.metadata.industry.trim()
      ? lead.metadata.industry
      : "local business";

  const contextNote = `Business name: ${lead.name ?? lead.company ?? "unknown"}. Category: ${category}. City: ${DEFAULT_CITY}. ${DEFAULT_CONTEXT_PROMPT}`;

  let qualifyResult: Awaited<ReturnType<typeof qualifyLeadProfile>>;
  try {
    qualifyResult = await qualifyLeadProfile(lead, contextNote);
  } catch (err) {
    return NextResponse.json(
      { error: "Lead qualification failed", details: `${err}` },
      { status: 502 }
    );
  }

  let finalLead = qualifyResult.lead;
  let outreach: OutreachContent | null = null;

  if (qualifyResult.qualification.status === "qualified") {
    try {
      const enriched = await enrichAndSaveLead(finalLead);
      if (enriched) {
        finalLead = enriched;
      }
    } catch (err) {
      console.error(`[auto-qualify] enrichment threw for lead ${id}:`, err);
    }

    try {
      const outreachResult = await generateAndSaveOutreach(finalLead);
      finalLead = outreachResult.lead;
      outreach = outreachResult.outreach;
    } catch (err) {
      console.error(`[auto-qualify] outreach generation threw for lead ${id}:`, err);
    }
  }

  return NextResponse.json({
    lead: finalLead,
    qualification: qualifyResult.qualification,
    outreach,
  });
}
