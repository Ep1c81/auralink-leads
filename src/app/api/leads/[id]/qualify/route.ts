import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifyLeadProfile } from "@/lib/qualification";
import { enrichAndSaveLead } from "@/lib/enrichment";
import type { Lead } from "@/lib/types";

/**
 * Qualifies a single pipeline lead using only its prospected business
 * profile (name, industry, address, website, etc. — no inbound message
 * required). On a "qualified" result, best-effort enriches the lead from
 * its website; enrichment failures never fail this request.
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
    qualifyResult = await qualifyLeadProfile(lead as Lead);
  } catch (err) {
    return NextResponse.json(
      { error: "Gemini qualification failed", details: `${err}` },
      { status: 502 }
    );
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
