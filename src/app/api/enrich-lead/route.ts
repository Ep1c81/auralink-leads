import { NextResponse } from "next/server";
import { deepEnrichLead } from "@/lib/deepEnrichment";

/**
 * Deep contact-info enrichment: crawls a lead's website (homepage + common
 * contact paths) for email, phone, WhatsApp, Instagram, and Facebook, and
 * writes any newly-found data onto the lead's dedicated columns.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const leadId = body?.lead_id;
  const websiteUrl = typeof body?.website_url === "string" ? body.website_url : null;

  if (typeof leadId !== "string") {
    return NextResponse.json({ error: "lead_id is required" }, { status: 400 });
  }

  const lead = await deepEnrichLead(leadId, websiteUrl);
  if (!lead) {
    return NextResponse.json({ error: "Enrichment failed" }, { status: 502 });
  }

  return NextResponse.json({ lead });
}
