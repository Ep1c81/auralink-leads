import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from "@/lib/supabase";
import type {
  BantQualification,
  CampaignStatus,
  Lead,
  OutreachCampaign,
  OutreachCampaignWithCounts,
  OutreachMessage,
  OutreachMessageStatus,
  OutreachMessageWithLead,
} from "@/lib/types";

const GEMINI_MODEL = "gemini-3.6-flash";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const DEFAULT_OFFERING =
  "helping local Costa Rican businesses grow through WhatsApp-based customer engagement, better online visibility, and simple digital tools";

const coldEmailResponseSchema = {
  type: Type.OBJECT,
  properties: {
    subject: { type: Type.STRING, description: "Concise, specific, non-spammy subject line" },
    body: {
      type: Type.STRING,
      description:
        "Short, specific cold outreach email in Spanish (Costa Rican tone, using \"usted\"), referencing only the real business data provided — no invented personalization, no generic template filler",
    },
  },
  required: ["subject", "body"],
};

/**
 * Gemini's responseMimeType:"application/json" is supposed to return raw
 * JSON, but it sometimes still wraps the payload in a ```json ... ``` (or
 * bare ```) markdown fence. Strip that before JSON.parse.
 */
function stripMarkdownFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function buildFallbackEmail(lead: Lead): { subject: string; body: string } {
  const businessName = lead.name ?? lead.company ?? "su negocio";
  const offeringEs =
    "crecer con herramientas de contacto por WhatsApp y mayor visibilidad en línea";

  return {
    subject: `Una idea para hacer crecer ${businessName}`,
    body: `Estimado equipo de ${businessName},\n\nEspero que se encuentren muy bien. Me pongo en contacto porque nos dedicamos a ayudar a negocios locales a ${offeringEs}, y creemos que podríamos aportar valor a su negocio.\n\nNos encantaría coordinar una breve llamada para conocer más sobre ${businessName} y compartir algunas ideas concretas que podrían ayudarles a atraer más clientes.\n\n¿Tendría disponibilidad para conversar esta semana? Quedamos atentos.\n\nSaludos cordiales.`,
  };
}

function buildColdEmailPrompt(lead: Lead): string {
  const metadata = lead.metadata ?? {};
  const industry = typeof metadata.industry === "string" ? metadata.industry : "negocio local";
  const address = typeof metadata.address === "string" ? metadata.address : null;
  const website = typeof metadata.website === "string" ? metadata.website : null;
  const bant = metadata.bant as BantQualification | undefined;
  const offering = process.env.OUTREACH_OFFERING_DESCRIPTION || DEFAULT_OFFERING;

  const bantSummary = bant
    ? `BANT qualification summary: ${bant.summary} (overall score ${bant.overall_score}/100)`
    : "No BANT qualification data available yet.";

  return `You are a sales development rep writing a single cold outreach email for a company that offers: ${offering}.

You are reaching out to a local small/medium business (SMB) in Costa Rica. Use ONLY the real data below — never invent facts, statistics, or personal details you don't have:
- Business name: ${lead.name ?? lead.company ?? "el negocio"}
- Category/industry: ${industry}
- Address: ${address ?? "unknown"}
- Website: ${website ?? "none"}
- Phone: ${lead.phone ?? "unknown"}

${bantSummary}

Write in Spanish (Costa Rican tone, professional but warm, using "usted"). Produce a concise, specific, non-templated cold email — 3-4 short paragraphs — that references only the real data above, states one clear value proposition tailored to this business category, and ends with a clear call to action. Also produce a concise, specific, non-spammy subject line.`;
}

/**
 * Generates cold outreach email copy via Gemini for a single lead. Never
 * throws — a failed API call, rate limit, or malformed response falls back
 * to deterministic Spanish copy so draft generation always succeeds.
 */
async function generateColdEmail(lead: Lead): Promise<{ subject: string; body: string }> {
  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildColdEmailPrompt(lead),
      config: {
        responseMimeType: "application/json",
        responseSchema: coldEmailResponseSchema,
      },
    });

    const cleaned = stripMarkdownFence(response.text ?? "{}");
    const parsed = JSON.parse(cleaned) as Partial<{ subject: string; body: string }>;

    if (!parsed.subject || !parsed.body) {
      throw new Error("Gemini response missing required email fields");
    }

    return { subject: parsed.subject, body: parsed.body };
  } catch (err) {
    console.error(`[outreachCampaigns] Gemini generation failed for lead ${lead.id}, using fallback:`, err);
    return buildFallbackEmail(lead);
  }
}

/**
 * Generates a draft outreach email for a lead within a campaign and persists
 * it as an `outreach_messages` row with status "draft". Never auto-transitions
 * to "queued" — that only happens via queueMessage, after human review.
 */
export async function generateDraftMessage(
  leadId: string,
  campaignId: string
): Promise<OutreachMessage> {
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) {
    throw new Error("Lead not found");
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("outreach_campaigns")
    .select("id")
    .eq("id", campaignId)
    .single();

  if (campaignError || !campaign) {
    throw new Error("Campaign not found");
  }

  const { subject, body } = await generateColdEmail(lead as Lead);

  const { data: message, error: insertError } = await supabase
    .from("outreach_messages")
    .insert({
      campaign_id: campaignId,
      lead_id: leadId,
      subject,
      body,
      status: "draft",
    })
    .select()
    .single();

  if (insertError || !message) {
    throw new Error("Failed to save draft message");
  }

  return message as OutreachMessage;
}

export async function listCampaigns(): Promise<OutreachCampaignWithCounts[]> {
  const { data: campaigns, error } = await supabase
    .from("outreach_campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list campaigns: ${error.message}`);
  }
  if (!campaigns || campaigns.length === 0) {
    return [];
  }

  const { data: messages, error: messagesError } = await supabase
    .from("outreach_messages")
    .select("campaign_id, status")
    .in(
      "campaign_id",
      campaigns.map((c) => c.id)
    );

  if (messagesError) {
    throw new Error(`Failed to load campaign message counts: ${messagesError.message}`);
  }

  const { data: replies, error: repliesError } = await supabase
    .from("outreach_replies")
    .select("message_id, outreach_messages!inner(campaign_id)");

  if (repliesError) {
    throw new Error(`Failed to load campaign reply counts: ${repliesError.message}`);
  }

  const counts = new Map<string, { message_count: number; sent_count: number }>();
  for (const m of messages ?? []) {
    const entry = counts.get(m.campaign_id) ?? { message_count: 0, sent_count: 0 };
    entry.message_count += 1;
    if (m.status === "sent") entry.sent_count += 1;
    counts.set(m.campaign_id, entry);
  }

  const replyCounts = new Map<string, number>();
  for (const r of (replies ?? []) as unknown as Array<{
    outreach_messages: { campaign_id: string } | null;
  }>) {
    const campaignId = r.outreach_messages?.campaign_id;
    if (!campaignId) continue;
    replyCounts.set(campaignId, (replyCounts.get(campaignId) ?? 0) + 1);
  }

  return campaigns.map((c) => ({
    ...(c as OutreachCampaign),
    message_count: counts.get(c.id)?.message_count ?? 0,
    sent_count: counts.get(c.id)?.sent_count ?? 0,
    reply_count: replyCounts.get(c.id) ?? 0,
  }));
}

export async function createCampaign(name: string): Promise<OutreachCampaign> {
  const { data, error } = await supabase
    .from("outreach_campaigns")
    .insert({ name, status: "draft" satisfies CampaignStatus })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create campaign: ${error?.message}`);
  }

  return data as OutreachCampaign;
}

export async function getCampaign(campaignId: string): Promise<OutreachCampaign | null> {
  const { data, error } = await supabase
    .from("outreach_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (error || !data) return null;
  return data as OutreachCampaign;
}

export async function listMessagesForCampaign(
  campaignId: string
): Promise<OutreachMessageWithLead[]> {
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("*, lead:leads(id,name,company,email)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list messages: ${error.message}`);
  }

  return (data ?? []) as unknown as OutreachMessageWithLead[];
}

export async function getMessage(messageId: string): Promise<OutreachMessageWithLead | null> {
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("*, lead:leads(id,name,company,email)")
    .eq("id", messageId)
    .single();

  if (error || !data) return null;
  return data as unknown as OutreachMessageWithLead;
}

/**
 * Edits a draft message's subject/body. Only "draft" messages are editable —
 * once queued, the content that was actually approved must stay intact.
 */
export async function updateDraftMessage(
  messageId: string,
  fields: { subject?: string; body?: string }
): Promise<OutreachMessage> {
  const { data: existing, error: fetchError } = await supabase
    .from("outreach_messages")
    .select("status")
    .eq("id", messageId)
    .single();

  if (fetchError || !existing) {
    throw new Error("Message not found");
  }
  if ((existing.status as OutreachMessageStatus) !== "draft") {
    throw new Error("Only draft messages can be edited");
  }

  const { data, error } = await supabase
    .from("outreach_messages")
    .update(fields)
    .eq("id", messageId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update message: ${error?.message}`);
  }

  return data as OutreachMessage;
}

/**
 * The human-review gate: approves a draft and moves it to "queued", then
 * best-effort POSTs it to the n8n outbound webhook. A webhook failure never
 * blocks the status transition — n8n (or a retry) picks up queued messages
 * independently; this call site never builds the actual send logic.
 */
export async function queueMessage(messageId: string): Promise<OutreachMessage> {
  const { data: existing, error: fetchError } = await supabase
    .from("outreach_messages")
    .select("*, lead:leads(id,email)")
    .eq("id", messageId)
    .single();

  if (fetchError || !existing) {
    throw new Error("Message not found");
  }
  if ((existing.status as OutreachMessageStatus) !== "draft") {
    throw new Error("Only draft messages can be queued");
  }

  const { data: updated, error: updateError } = await supabase
    .from("outreach_messages")
    .update({ status: "queued" satisfies OutreachMessageStatus })
    .eq("id", messageId)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to queue message: ${updateError?.message}`);
  }

  const webhookUrl = process.env.N8N_OUTREACH_WEBHOOK;
  if (webhookUrl) {
    const lead = (existing as unknown as { lead: { email: string | null } | null }).lead;
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: updated.id,
          lead_id: updated.lead_id,
          subject: updated.subject,
          body: updated.body,
          to_email: lead?.email ?? null,
        }),
      });
      if (!response.ok) {
        console.error(
          `[outreachCampaigns] outbound webhook responded ${response.status} for message ${messageId}`
        );
      }
    } catch (err) {
      console.error(`[outreachCampaigns] outbound webhook failed for message ${messageId}:`, err);
    }
  } else {
    console.warn("[outreachCampaigns] N8N_OUTREACH_WEBHOOK not configured; message queued but not sent");
  }

  return updated as OutreachMessage;
}

/**
 * Applies an inbound status update from n8n after a send attempt.
 */
export async function applyInboundStatus(
  messageId: string,
  status: OutreachMessageStatus,
  providerMessageId?: string
): Promise<OutreachMessage> {
  const fields: Record<string, unknown> = { status };
  if (providerMessageId) fields.provider_message_id = providerMessageId;
  if (status === "sent") fields.sent_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("outreach_messages")
    .update(fields)
    .eq("id", messageId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update message status: ${error?.message}`);
  }

  return data as OutreachMessage;
}
