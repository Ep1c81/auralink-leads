import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifyAndRecord } from "@/lib/qualification";
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
    if (!payload.email) {
      return NextResponse.json(
        { error: "`lead_id` or `email` is required" },
        { status: 400 }
      );
    }

    const { data: existing } = await supabase
      .from("leads")
      .select("*")
      .eq("email", payload.email)
      .maybeSingle();

    if (existing) {
      lead = existing as Lead;
    } else {
      const { data: created, error: createError } = await supabase
        .from("leads")
        .insert({
          name: payload.name,
          email: payload.email,
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

  try {
    const result = await qualifyAndRecord(lead, payload.message);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "Gemini qualification failed", details: `${err}` },
      { status: 502 }
    );
  }
}
