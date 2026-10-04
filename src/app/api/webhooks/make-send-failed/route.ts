import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { checkAutomationAuth, type BizmapOutreachStatus } from "@/lib/outreachAutomation";
import { formatWhatsAppNumber } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Statuses still in the automated sequence. Replied / Closed / other dead
// ends are left alone.
const IN_SEQUENCE: BizmapOutreachStatus[] = ["Queued", "Pitch Sent", "Followup Sent"];

// Costa Rican landlines start with 2 or 4 (see CR_MOBILE_NUMBER in outreachAutomation).
const CR_LANDLINE = /^506[24]/;
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Make.com calls this from the WhatsApp send module's error handler when the
 * number isn't on WhatsApp. Body:
 *   { lead_id?: string, phone?: string, error_message?: string }
 * At least one of lead_id / phone is required. A phone match updates every
 * row with that number, as in make-reply.
 *
 * Moves the lead out of the sequence to "No WhatsApp (mobile)" ("(landline)"
 * for a 2/4-prefixed number) with retry_method "Find alternate contact" and
 * retry_date tomorrow. alt_contact is never touched. Requires
 * `Authorization: Bearer <OUTREACH_AUTOMATION_SECRET>`.
 */
export async function POST(request: Request) {
  const unauthorized = checkAutomationAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const leadId = typeof body?.lead_id === "string" ? body.lead_id.trim() : "";
  const rawPhone = typeof body?.phone === "string" ? body.phone : "";
  const errorMessage = typeof body?.error_message === "string" ? body.error_message : "";

  const waPhone = formatWhatsAppNumber(rawPhone);
  if (!leadId && !waPhone) {
    return NextResponse.json(
      { error: "lead_id or a valid phone is required" },
      { status: 400 }
    );
  }

  if (leadId && !UUID.test(leadId)) {
    return NextResponse.json({ error: "lead_id must be a UUID" }, { status: 400 });
  }

  const supabase = getSupabase();

  try {
    let query = supabase
      .from("bizmap_leads")
      .select("id, business_name, wa_phone")
      .in("outreach_status", IN_SEQUENCE)
      .eq("has_replied", false);
    query = leadId ? query.eq("id", leadId) : query.eq("wa_phone", waPhone!);
    const { data: leads, error } = await query;

    if (error) throw new Error(error.message);
    if (!leads || leads.length === 0) {
      return NextResponse.json({ error: "No matching lead in the sequence" }, { status: 404 });
    }

    // A phone match only returns rows sharing that number, so one status fits all.
    const status: BizmapOutreachStatus = CR_LANDLINE.test(leads[0].wa_phone ?? "")
      ? "No WhatsApp (landline)"
      : "No WhatsApp (mobile)";

    // Status guard repeated so a reply that landed in between isn't overwritten.
    const { error: updateError } = await supabase
      .from("bizmap_leads")
      .update({
        outreach_status: status,
        retry_method: "Find alternate contact",
        retry_date: new Date(Date.now() + RETRY_AFTER_MS).toISOString(),
      })
      .in("id", leads.map((l) => l.id))
      .in("outreach_status", IN_SEQUENCE)
      .eq("has_replied", false);
    if (updateError) throw new Error(updateError.message);

    console.log(
      `[/api/webhooks/make-send-failed] ${status}: ${leads.map((l) => l.business_name).join(", ")}: ${errorMessage.slice(0, 200)}`
    );
    return NextResponse.json({ updated: leads.map((l) => l.id), outreach_status: status });
  } catch (err) {
    console.error("[/api/webhooks/make-send-failed] failed to record send failure:", err);
    return NextResponse.json({ error: "Failed to record send failure" }, { status: 502 });
  }
}
