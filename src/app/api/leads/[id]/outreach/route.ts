import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateAndSaveOutreach } from "@/lib/outreach";
import type { Lead } from "@/lib/types";

/**
 * Generates a tailored Spanish WhatsApp pitch + email outreach template for
 * a qualified lead, based on its business category and BANT qualification.
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

  if ((lead as Lead).status !== "qualified") {
    return NextResponse.json(
      { error: "Lead must be qualified before generating outreach" },
      { status: 400 }
    );
  }

  try {
    const result = await generateAndSaveOutreach(lead as Lead);
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[outreach] request failed for lead ${id}:`, err);
    return NextResponse.json(
      { error: "Outreach generation failed", details: `${err}` },
      { status: 502 }
    );
  }
}
