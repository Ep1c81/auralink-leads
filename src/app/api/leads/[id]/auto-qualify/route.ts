import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth";
import { isUuid, jsonError } from "@/lib/http";
import { supabaseAdmin as supabase } from "@/lib/supabase/admin";
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
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOperatorApi(request);
  if (auth instanceof NextResponse) return auth;
  const { requestId } = auth;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Identificador inválido", requestId);

  const { data: leadRow, error: fetchError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !leadRow) {
    return jsonError(404, "No se encontró el prospecto", requestId);
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
    return jsonError(502, "No se pudo calificar el prospecto", requestId, err);
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
