import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifyLeadProfile, qualifyLeadProfileHeuristic } from "@/lib/qualification";
import { enrichAndSaveLead } from "@/lib/enrichment";
import type { Lead } from "@/lib/types";

const QUALIFY_TIMEOUT_MS = 15000;

class QualificationTimeoutError extends Error {}

/**
 * Runs `run` against a fresh AbortController, aborting it (and thereby
 * signaling any Gemini call threaded the signal) once `ms` elapses. Rejects
 * with QualificationTimeoutError on timeout so the request never hangs or
 * drops the connection abruptly waiting on a slow/stuck upstream call.
 */
function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  return new Promise<T>((resolve, reject) => {
    run(controller.signal).then(resolve, reject);
    controller.signal.addEventListener(
      "abort",
      () => reject(new QualificationTimeoutError(`Qualification timed out after ${ms}ms`)),
      { once: true }
    );
  }).finally(() => clearTimeout(timer));
}

/**
 * Qualifies a single pipeline lead using only its prospected business
 * profile (name, industry, address, website, etc. — no inbound message
 * required). On a "qualified" result, best-effort enriches the lead from
 * its website; enrichment failures never fail this request.
 *
 * The Gemini-backed qualification call is bounded by a 15s deadline: if it
 * fails or doesn't resolve in time, we log the error and complete the
 * request using the heuristic fallback engine instead of surfacing a
 * 500/504 network error to the client.
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

  let qualifyResult: Awaited<ReturnType<typeof qualifyLeadProfile>>;
  try {
    qualifyResult = await withDeadline(
      (signal) => qualifyLeadProfile(lead as Lead, undefined, signal),
      QUALIFY_TIMEOUT_MS
    );
  } catch (err) {
    console.error(
      `[qualify] qualification failed or timed out for lead ${id}, falling back to heuristic scoring:`,
      err
    );
    try {
      qualifyResult = await qualifyLeadProfileHeuristic(lead as Lead);
    } catch (fallbackErr) {
      return NextResponse.json(
        { error: "Lead qualification failed", details: `${fallbackErr}` },
        { status: 502 }
      );
    }
  }

  let finalLead = qualifyResult.lead;

  if (qualifyResult.qualification.status === "qualified") {
    try {
      const enriched = await enrichAndSaveLead(finalLead);
      if (enriched) {
        finalLead = enriched;
      }
    } catch (err) {
      console.error(`[qualify] enrichment threw for lead ${id}:`, err);
    }
  }

  return NextResponse.json({
    lead: finalLead,
    qualification: qualifyResult.qualification,
  });
}
