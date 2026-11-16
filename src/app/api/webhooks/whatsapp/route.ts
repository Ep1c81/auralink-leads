import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifyAndRecord } from "@/lib/qualification";
import type { Lead } from "@/lib/types";

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: WhatsAppMessage[];
        statuses?: Array<{ id: string; status: string; timestamp?: string; recipient_id?: string }>;
      };
    }>;
  }>;
}

// Meta webhook verification handshake:
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const signature = request.headers.get("x-hub-signature-256");
  if (!appSecret || !signature?.startsWith("sha256=")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rawBody = await request.text();
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const supplied = signature.slice(7);
  const a = Buffer.from(expected, "hex");
  const b = /^[0-9a-f]{64}$/i.test(supplied) ? Buffer.from(supplied, "hex") : Buffer.alloc(0);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }
  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const value = payload.entry?.[0]?.changes?.[0]?.value;
  // Update only records linked to a real Meta provider message ID.
  for (const receipt of value?.statuses ?? []) {
    if (!["sent", "delivered", "read", "failed"].includes(receipt.status)) continue;
    const { error: receiptError } = await supabase.from("outreach_messages")
      .update({ status: receipt.status })
      .eq("provider_message_id", receipt.id);
    if (receiptError) {
      console.error("[whatsapp-webhook] receipt update failed", receiptError.code);
      return NextResponse.json({ error: "Receipt persistence failed" }, { status: 500 });
    }
  }
  const message = value?.messages?.[0];

  // Receipts are handled above. Other non-text events are acknowledged.
  if (!message || message.type !== "text" || !message.text?.body) {
    return NextResponse.json({ status: "ignored" });
  }

  const from = message.from;
  const text = message.text.body;
  const contactName = value?.contacts?.find((c) => c.wa_id === from)?.profile
    ?.name;

  let lead: Lead;
  const { data: existing } = await supabase
    .from("leads")
    .select("*")
    .eq("phone", from)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    lead = existing as Lead;
  } else {
    const { data: created, error: createError } = await supabase
      .from("leads")
      .insert({ name: contactName, phone: from, status: "new" })
      .select()
      .single();

    if (createError || !created) {
      // 23505 = Postgres unique_violation. `leads` has a composite UNIQUE
      // (name, company) constraint; a redelivered/concurrent webhook for the
      // same contact can race past the `existing`-by-phone lookup above and
      // collide here. Meta retries webhook deliveries, so recover by
      // looking the lead back up instead of dropping the inbound message.
      if (createError?.code === "23505") {
        const { data: recovered } = await supabase
          .from("leads")
          .select("*")
          .eq("phone", from)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!recovered) {
          return NextResponse.json(
            { error: "Failed to create lead" },
            { status: 500 }
          );
        }
        lead = recovered as Lead;
      } else {
        return NextResponse.json(
          { error: "Failed to create lead" },
          { status: 500 }
        );
      }
    } else {
      lead = created as Lead;
    }
  }

  const { error: inboundError } = await supabase
    .from("lead_conversations")
    .insert({
      lead_id: lead.id,
      sender: `whatsapp:${from}`,
      message: text,
      metadata: { whatsapp_message_id: message.id, timestamp: message.timestamp },
    });

  if (inboundError) {
    return NextResponse.json(
      { error: "Failed to store inbound message" },
      { status: 500 }
    );
  }

  try {
    await qualifyAndRecord(lead, text);
  } catch (err) {
    return NextResponse.json(
      { error: "Claude qualification failed", details: `${err}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ status: "ok" });
}
