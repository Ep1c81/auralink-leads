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
  let payload: WhatsAppWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const value = payload.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  // Non-text events (delivery/read receipts, media, etc.) - ack and skip.
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
      { error: "Gemini qualification failed", details: `${err}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ status: "ok" });
}
