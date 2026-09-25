import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { checkAutomationAuth } from "@/lib/outreachAutomation";
import { formatWhatsAppNumber } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Make.com calls this when a prospect replies on WhatsApp. Body:
 *   { lead_id?: string, phone?: string, message_text?: string, external_chat_id?: string }
 * At least one of lead_id / phone is required. A phone match updates every
 * row with that number (duplicate listings of one business share it), so the
 * follow-up stage never bumps someone who already answered.
 *
 * Sets has_replied = true and outreach_status = "Replied" (a lead already
 * "Closed" keeps that status). Requires
 * `Authorization: Bearer <OUTREACH_AUTOMATION_SECRET>`.
 */
export async function POST(request: Request) {
  const unauthorized = checkAutomationAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const leadId = typeof body?.lead_id === "string" ? body.lead_id.trim() : "";
  const rawPhone = typeof body?.phone === "string" ? body.phone : "";
  const messageText = typeof body?.message_text === "string" ? body.message_text : "";
  const externalChatId =
    typeof body?.external_chat_id === "string" ? body.external_chat_id.trim() : "";

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
    let query = supabase.from("bizmap_leads").update({
      has_replied: true,
      ...(externalChatId ? { external_chat_id: externalChatId } : {}),
    });
    query = leadId ? query.eq("id", leadId) : query.eq("wa_phone", waPhone!);
    const { data: replied, error } = await query.select("id, business_name, outreach_status");

    if (error) throw new Error(error.message);
    if (!replied || replied.length === 0) {
      return NextResponse.json({ error: "No matching lead" }, { status: 404 });
    }

    const toReplied = replied.filter((r) => r.outreach_status !== "Closed").map((r) => r.id);
    if (toReplied.length > 0) {
      const { error: statusError } = await supabase
        .from("bizmap_leads")
        .update({ outreach_status: "Replied" })
        .in("id", toReplied);
      if (statusError) throw new Error(statusError.message);
    }

    console.log(
      `[/api/webhooks/make-reply] reply from ${replied.map((r) => r.business_name).join(", ")}: ${messageText.slice(0, 200)}`
    );
    return NextResponse.json({ updated: replied.map((r) => r.id) });
  } catch (err) {
    console.error("[/api/webhooks/make-reply] failed to record reply:", err);
    return NextResponse.json({ error: "Failed to record reply" }, { status: 502 });
  }
}
