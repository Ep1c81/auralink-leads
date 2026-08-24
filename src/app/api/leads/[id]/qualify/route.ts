import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifyLeadProfile, qualifyLeadProfileHeuristic } from "@/lib/qualification";
import { enrichAndSaveLead } from "@/lib/enrichment";
import { withDeadline } from "@/lib/timeout";
import type { BantQualification, Lead } from "@/lib/types";

// Bounds the Gemini call + any enrichment together. Left with ~1s of
// headroom under the 5s response guarantee for the instant heuristic
// fallback below, which does no Gemini/network calls and only a couple of
// fast Supabase round trips.
const PIPELINE_DEADLINE_MS = 4000;

interface PipelineResult {
  lead: Lead;
  qualification: BantQualification;
}

/**
 * Runs Gemini-backed BANT qualification against the lead's basic profile
 * metadata (name, phone, category/industry, city) — this never depends on
 * or waits for website enrichment. Only for a "qualified" result does it
 * then best-effort enrich from the lead's website; enrichment has its own
 * strict scrape timeout (see lib/enrichment) and never throws, so it can
 * never itself be the reason this pipeline blows its deadline.
 */
async function runQualifyPipeline(lead: Lead, signal: AbortSignal): Promise<PipelineResult> {
  const qualifyResult = await qualifyLeadProfile(lead, undefined, signal);
  let finalLead = qualifyResult.lead;

  if (qualifyResult.qualification.status === "qualified") {
    try {
      const enriched = await enrichAndSaveLead(finalLead);
      if (enriched) {
        finalLead = enriched;
      }
    } catch (err) {
      console.error(`[qualify] enrichment threw for lead ${lead.id}:`, err);
    }
  }

  return { lead: finalLead, qualification: qualifyResult.qualification };
}

/**
 * Qualifies a single pipeline lead using only its prospected business
 * profile (name, industry, address, website, etc. — no inbound message
 * required), then best-effort enriches a "qualified" result from its
 * website.
 *
 * The whole pipeline is bounded by a deadline: if the Gemini call or the
 * website scrape fails or doesn't resolve in time, we log it and complete
 * the request using the heuristic fallback engine instead of surfacing a
 * 500/504 network error to the client — guaranteeing a JSON response well
 * within 5 seconds.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: lead, error: fetchError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  let result: PipelineResult;
  try {
    result = await withDeadline(
      (signal) => runQualifyPipeline(lead as Lead, signal),
      PIPELINE_DEADLINE_MS
    );
  } catch (err) {
    console.error(
      `[qualify] qualification pipeline failed or timed out for lead ${id}, falling back to instant heuristic scoring:`,
      err
    );
    try {
      result = await qualifyLeadProfileHeuristic(lead as Lead);
    } catch (fallbackErr) {
      return NextResponse.json(
        { error: "Lead qualification failed", details: `${fallbackErr}` },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({
    lead: result.lead,
    qualification: result.qualification,
  });
}
