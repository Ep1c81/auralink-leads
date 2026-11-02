import { reserveAI } from "@/lib/resourceBudget";
import 'server-only';
import { requireOperator } from '@/lib/security/auth';
import Anthropic from "@anthropic-ai/sdk";
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

const DEFAULT_OFFERING =
  "helping local Costa Rican businesses grow through WhatsApp-based customer engagement, better online visibility, and simple digital tools";

/**
 * Structured output via tool use, same as outreach.ts: forced tool_choice is
 * rejected with a 400 on claude-sonnet-5-5, so the model is steered to this
 * tool with tool_choice "auto" + a prompt instruction, and `strict` keeps the
 * input schema-valid.
 */
const submitColdEmailTool: Anthropic.Tool = {
  name: "submit_cold_email",
  description: "Submit the generated Spanish cold outreach email for this lead.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Concise, specific, non-spammy subject line" },
      body: {
        type: "string",
        description:
          "Short, specific cold outreach email in Spanish (Costa Rican tone, using \"usted\"), referencing only the real business data provided — no invented personalization, no generic template filler",
      },
    },
    required: ["subject", "body"],
    additionalProperties: false,
  },
};

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

Write in Spanish (Costa Rican tone, professional but warm, using "usted"). Produce a concise, specific, non-templated cold email — 3-4 short paragraphs — that references only the real data above, states one clear value proposition tailored to this business category, and ends with a clear call to action. Also produce a concise, specific, non-spammy subject line.

Submit the result by calling the submit_cold_email tool.`;
}

/**
 * Generates cold outreach email copy via Claude for a single lead. Never
 * throws — a failed API call, rate limit, or malformed response falls back
 * to deterministic Spanish copy so draft generation always succeeds.
 */
async function generateColdEmail(lead: Lead): Promise<{ subject: string; body: string }> {
  const apiKey = process.env.AI_ENABLED === "true" ? process.env.ANTHROPIC_API_KEY : undefined;
  if (!apiKey || !await reserveAI()) {
    console.error("outreachCampaigns.ts: operación registrada");
    return buildFallbackEmail(lead);
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_OUTREACH_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 1024,
      // Keep thinking short so it can't eat the 1024-token budget before the tool call.
      output_config: { effort: "low" },
      tools: [submitColdEmailTool],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages: [{ role: "user", content: buildColdEmailPrompt(lead) }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === submitColdEmailTool.name
    );
    if (!toolUse) {
      throw new Error(
        `Claude response has no submit_cold_email call (stop_reason: ${response.stop_reason})`
      );
    }

    const input = toolUse.input as { subject?: unknown; body?: unknown };
    const isFilled = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
    if (!isFilled(input.subject) || !isFilled(input.body)) {
      throw new Error("Claude response missing required email fields");
    }

    return { subject: input.subject, body: input.body };
  } catch {
    console.error("outreachCampaigns.ts: operación registrada");
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

export async function listCampaigns(page = 0): Promise<OutreachCampaignWithCounts[]> {
  await requireOperator();
  const { data: campaigns, error } = await supabase
    .from("outreach_campaigns")
    .select("id,name,status,created_at")
    .order("created_at", { ascending: false }).order("id").range(page*50,page*50+49);

  if (error) {
    throw new Error(`Failed to list campaigns: ${error.message}`);
  }
  if (!campaigns || campaigns.length === 0) {
    return [];
  }

  // Exact per-campaign counts rather than fetching every row: PostgREST caps
  // unpaginated selects at 1,000 rows, which silently undercounted once the
  // campaigns together held more drafts than that.
  const countsList = await Promise.all(
    campaigns.map(async (c) => {
      const [total, sent, replies] = await Promise.all([
        supabase
          .from("outreach_messages")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", c.id),
        supabase
          .from("outreach_messages")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", c.id)
          .eq("status", "sent"),
        supabase
          .from("outreach_replies")
          .select("message_id, outreach_messages!inner(campaign_id)", { count: "exact", head: true })
          .eq("outreach_messages.campaign_id", c.id),
      ]);
      if (total.error || sent.error) {
        throw new Error(
          `Failed to load campaign message counts: ${(total.error ?? sent.error)!.message}`
        );
      }
      if (replies.error) {
        throw new Error(`Failed to load campaign reply counts: ${replies.error.message}`);
      }
      return [
        c.id,
        { message_count: total.count ?? 0, sent_count: sent.count ?? 0, reply_count: replies.count ?? 0 },
      ] as const;
    })
  );
  const counts = new Map(countsList);

  return campaigns.map((c) => ({
    ...(c as OutreachCampaign),
    message_count: counts.get(c.id)?.message_count ?? 0,
    sent_count: counts.get(c.id)?.sent_count ?? 0,
    reply_count: counts.get(c.id)?.reply_count ?? 0,
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
  await requireOperator();
  const { data, error } = await supabase
    .from("outreach_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (error || !data) return null;
  return data as OutreachCampaign;
}

export async function listMessagesForCampaign(
  campaignId: string, page = 0
): Promise<OutreachMessageWithLead[]> {
  await requireOperator();
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("*, lead:leads(id,name,company,email,phone)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false }).order("id").range(page*50,page*50+49);

  if (error) {
    throw new Error(`Failed to list messages: ${error.message}`);
  }

  return (data ?? []) as unknown as OutreachMessageWithLead[];
}

export async function getMessage(messageId: string): Promise<OutreachMessageWithLead | null> {
  await requireOperator();
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("*, lead:leads(id,name,company,email,phone)")
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
    .eq("status", "draft")
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update message: ${error?.message}`);
  }

  return data as OutreachMessage;
}

/** Aprueba exactamente el texto y destinatario revisados en una transacción SQL. */
export async function queueMessage(messageId: string, expected: {subject: string; body: string; phone: string}): Promise<OutreachMessage> {
  const user=await requireOperator();
  const {data,error}=await supabase.rpc('approve_campaign_message',{p_message:messageId,p_operator:user.id,p_subject:expected.subject,p_body:expected.body,p_phone:expected.phone});
  if(error || !data)throw new Error('No se pudo aprobar: revisá si cambió el borrador, si el contacto tiene permiso o si ya existe un envío en esta campaña.');
  return (Array.isArray(data)?data[0]:data) as OutreachMessage;
}

/**
 * Applies an inbound status update from n8n after a send attempt.
 */
export async function applyInboundStatus(
  messageId: string,
  status: OutreachMessageStatus,
  providerMessageId?: string
): Promise<OutreachMessage> {
  const {data:linked,error:linkedError}=await supabase.from('dispatch_jobs').select('id').eq('outreach_message_id',messageId).maybeSingle();
  if(linkedError || linked)throw new Error('Este mensaje utiliza el contrato de receipts de la cola durable.');
  const fields: Record<string, unknown> = { status };
  if (providerMessageId) fields.provider_message_id = providerMessageId;
  if (status === "sent") fields.sent_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("outreach_messages")
    .update(fields)
    .eq("id", messageId)
    .eq("status", "queued")
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update message status: ${error?.message}`);
  }

  return data as OutreachMessage;
}
