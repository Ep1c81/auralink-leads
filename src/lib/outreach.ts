import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import type { BantQualification, Lead, OutreachContent, WebEnrichment } from "@/lib/types";

const DEFAULT_OFFERING =
  "helping local Costa Rican businesses grow through WhatsApp-based customer engagement, better online visibility, and simple digital tools";

/**
 * Structured output via tool use. Forced tool_choice ({type:"tool"}) is
 * rejected with a 400 on claude-sonnet-5-5, so the model is steered to this
 * tool with tool_choice "auto" + a prompt instruction, and `strict` keeps the
 * input schema-valid.
 */
const submitOutreachTool: Anthropic.Tool = {
  name: "submit_outreach",
  description: "Submit the generated Spanish outreach copy for this lead.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      whatsapp_pitch: {
        type: "string",
        description:
          "Short, friendly WhatsApp message in Spanish, mobile-first, with a clear call to action",
      },
      email_subject: { type: "string" },
      email_body: {
        type: "string",
        description: "Professional but warm outreach email in Spanish",
      },
    },
    required: ["whatsapp_pitch", "email_subject", "email_body"],
    additionalProperties: false,
  },
};

/**
 * Deterministic Spanish outreach copy used whenever Claude generation
 * fails (rate limit, malformed response, network error, etc.) so the
 * outreach modal always has clean, presentable content to show. Kept
 * fully in Spanish — OUTREACH_OFFERING_DESCRIPTION is written in English
 * for the Claude prompt, so it is deliberately not spliced in here.
 * `offeringEsOverride` lets a caller (e.g. the auto-prospect sweep) swap in
 * campaign-specific Spanish copy instead of the generic default.
 */
function buildFallbackOutreach(lead: Lead, offeringEsOverride?: string): OutreachContent {
  const businessName = lead.name ?? lead.company ?? "su negocio";
  const offeringEs =
    offeringEsOverride ??
    "crecer con herramientas de contacto por WhatsApp y mayor visibilidad en línea";

  return {
    whatsapp_pitch: `¡Hola! Somos un equipo que ayuda a negocios como ${businessName} a ${offeringEs}. Nos encantaría conversar unos minutos para mostrarle cómo podemos ayudarle. ¿Tendría disponibilidad esta semana?`,
    email_subject: `Una idea para hacer crecer ${businessName}`,
    email_body: `Estimado equipo de ${businessName},\n\nEspero que se encuentren muy bien. Me pongo en contacto porque nos dedicamos a ayudar a negocios locales a ${offeringEs}, y creemos que podríamos aportar valor a su negocio.\n\nNos encantaría coordinar una breve llamada para conocer más sobre ${businessName} y compartir algunas ideas concretas que podrían ayudarles a atraer más clientes.\n\n¿Tendría disponibilidad para conversar esta semana? Quedamos atentos.\n\nSaludos cordiales.`,
  };
}

function buildOutreachPrompt(lead: Lead, offeringOverride?: string): string {
  const metadata = lead.metadata ?? {};
  const industry = typeof metadata.industry === "string" ? metadata.industry : "negocio local";
  const bant = metadata.bant as BantQualification | undefined;
  const enrichment = metadata.enrichment as WebEnrichment | undefined;
  const offering =
    offeringOverride || process.env.OUTREACH_OFFERING_DESCRIPTION || DEFAULT_OFFERING;

  const bantSummary = bant
    ? `BANT qualification summary: ${bant.summary} (overall score ${bant.overall_score}/100 — budget ${bant.budget.score}/10, authority ${bant.authority.score}/10, need ${bant.need.score}/10, timeline ${bant.timeline.score}/10)`
    : "No BANT qualification data available yet.";

  const websiteContext = enrichment?.description
    ? `Website context: ${enrichment.description}`
    : "No additional website context available.";

  return `You are a sales development rep writing outreach for a company that offers: ${offering}.

You are reaching out to a local small/medium business (SMB) in Costa Rica:
- Business name: ${lead.name ?? lead.company ?? "el negocio"}
- Category/industry: ${industry}
- Phone: ${lead.phone ?? "unknown"}

${bantSummary}
${websiteContext}

Write in Spanish (Costa Rican tone — friendly but professional, using "usted"), tailored to this specific business category. Produce:
1. A short WhatsApp pitch (2-4 sentences, mobile-friendly, warm opener referencing their business type, one clear value proposition, one clear call to action, no more than ~60 words).
2. An email subject line (concise, specific, not spammy).
3. A slightly longer, professional outreach email body (3-4 short paragraphs) that expands on the value proposition, references their business category, and ends with a clear call to action.

Do not invent specific facts about the business you don't have (e.g. don't claim to know their revenue or exact problems) — keep it relevant to their industry but general otherwise.

Submit the result by calling the submit_outreach tool.`;
}

export interface OutreachOfferingOptions {
  /** English offering description spliced into the Claude prompt, overriding
   *  OUTREACH_OFFERING_DESCRIPTION / DEFAULT_OFFERING for this call only. */
  offering?: string;
  /** Spanish offering phrase used in the deterministic fallback copy if
   *  Claude generation fails, overriding the generic default for this call. */
  fallbackOfferingEs?: string;
}

/**
 * Generates outreach copy via Claude. Never throws — a failed API call,
 * rate limit, or malformed response falls back to buildFallbackOutreach so
 * callers (and the outreach modal) always get clean, renderable content.
 */
export async function generateOutreach(
  lead: Lead,
  options?: OutreachOfferingOptions
): Promise<OutreachContent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      `[outreach] ANTHROPIC_API_KEY is not set, using fallback for lead ${lead.id}`
    );
    return buildFallbackOutreach(lead, options?.fallbackOfferingEs);
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_OUTREACH_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 1024,
      // Keep thinking short so it can't eat the 1024-token budget before the tool call.
      output_config: { effort: "low" },
      tools: [submitOutreachTool],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages: [{ role: "user", content: buildOutreachPrompt(lead, options?.offering) }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === submitOutreachTool.name
    );
    if (!toolUse) {
      throw new Error(
        `Claude response has no submit_outreach call (stop_reason: ${response.stop_reason})`
      );
    }

    const input = toolUse.input as Partial<Record<keyof OutreachContent, unknown>>;
    const isFilled = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
    if (!isFilled(input.whatsapp_pitch) || !isFilled(input.email_subject) || !isFilled(input.email_body)) {
      throw new Error("Claude response missing required outreach fields");
    }

    return {
      whatsapp_pitch: input.whatsapp_pitch,
      email_subject: input.email_subject,
      email_body: input.email_body,
    };
  } catch (err) {
    console.error(
      `[outreach] Claude generation failed for lead ${lead.id}, using fallback:`,
      err
    );
    return buildFallbackOutreach(lead, options?.fallbackOfferingEs);
  }
}

/**
 * Generates a Spanish WhatsApp pitch + email outreach template for a
 * qualified lead and persists it into metadata.outreach for reference.
 */
export async function generateAndSaveOutreach(
  lead: Lead,
  options?: OutreachOfferingOptions
): Promise<{ lead: Lead; outreach: OutreachContent }> {
  const outreach = await generateOutreach(lead, options);

  const { data: updatedLead, error } = await supabase
    .from("leads")
    .update({
      metadata: {
        ...(lead.metadata ?? {}),
        outreach: { ...outreach, generatedAt: new Date().toISOString() },
      },
    })
    .eq("id", lead.id)
    .select()
    .single();

  if (error || !updatedLead) {
    throw new Error("Failed to save outreach content");
  }

  return { lead: updatedLead as Lead, outreach };
}
