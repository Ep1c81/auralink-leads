import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from "@/lib/supabase";
import type { BantQualification, Lead, OutreachContent, WebEnrichment } from "@/lib/types";

const GEMINI_MODEL = "gemini-3.6-flash";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const DEFAULT_OFFERING =
  "helping local Costa Rican businesses grow through WhatsApp-based customer engagement, better online visibility, and simple digital tools";

const outreachResponseSchema = {
  type: Type.OBJECT,
  properties: {
    whatsapp_pitch: {
      type: Type.STRING,
      description:
        "Short, friendly WhatsApp message in Spanish, mobile-first, with a clear call to action",
    },
    email_subject: { type: Type.STRING },
    email_body: {
      type: Type.STRING,
      description: "Professional but warm outreach email in Spanish",
    },
  },
  required: ["whatsapp_pitch", "email_subject", "email_body"],
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

/**
 * Deterministic Spanish outreach copy used whenever Gemini generation
 * fails (rate limit, malformed response, network error, etc.) so the
 * outreach modal always has clean, presentable content to show. Kept
 * fully in Spanish — OUTREACH_OFFERING_DESCRIPTION is written in English
 * for the Gemini prompt, so it is deliberately not spliced in here.
 */
function buildFallbackOutreach(lead: Lead): OutreachContent {
  const businessName = lead.name ?? lead.company ?? "su negocio";
  const offeringEs =
    "crecer con herramientas de contacto por WhatsApp y mayor visibilidad en línea";

  return {
    whatsapp_pitch: `¡Hola! Somos un equipo que ayuda a negocios como ${businessName} a ${offeringEs}. Nos encantaría conversar unos minutos para mostrarle cómo podemos ayudarle. ¿Tendría disponibilidad esta semana?`,
    email_subject: `Una idea para hacer crecer ${businessName}`,
    email_body: `Estimado equipo de ${businessName},\n\nEspero que se encuentren muy bien. Me pongo en contacto porque nos dedicamos a ayudar a negocios locales a ${offeringEs}, y creemos que podríamos aportar valor a su negocio.\n\nNos encantaría coordinar una breve llamada para conocer más sobre ${businessName} y compartir algunas ideas concretas que podrían ayudarles a atraer más clientes.\n\n¿Tendría disponibilidad para conversar esta semana? Quedamos atentos.\n\nSaludos cordiales.`,
  };
}

function buildOutreachPrompt(lead: Lead): string {
  const metadata = lead.metadata ?? {};
  const industry = typeof metadata.industry === "string" ? metadata.industry : "negocio local";
  const bant = metadata.bant as BantQualification | undefined;
  const enrichment = metadata.enrichment as WebEnrichment | undefined;
  const offering = process.env.OUTREACH_OFFERING_DESCRIPTION || DEFAULT_OFFERING;

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

Do not invent specific facts about the business you don't have (e.g. don't claim to know their revenue or exact problems) — keep it relevant to their industry but general otherwise.`;
}

/**
 * Generates outreach copy via Gemini. Never throws — a failed API call,
 * rate limit, or malformed response falls back to buildFallbackOutreach so
 * callers (and the outreach modal) always get clean, renderable content.
 */
export async function generateOutreach(lead: Lead): Promise<OutreachContent> {
  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildOutreachPrompt(lead),
      config: {
        responseMimeType: "application/json",
        responseSchema: outreachResponseSchema,
      },
    });

    const cleaned = stripMarkdownFence(response.text ?? "{}");
    const parsed = JSON.parse(cleaned) as Partial<OutreachContent>;

    if (!parsed.whatsapp_pitch || !parsed.email_subject || !parsed.email_body) {
      throw new Error("Gemini response missing required outreach fields");
    }

    return parsed as OutreachContent;
  } catch (err) {
    console.error(
      `[outreach] Gemini generation failed for lead ${lead.id}, using fallback:`,
      err
    );
    return buildFallbackOutreach(lead);
  }
}

/**
 * Generates a Spanish WhatsApp pitch + email outreach template for a
 * qualified lead and persists it into metadata.outreach for reference.
 */
export async function generateAndSaveOutreach(
  lead: Lead
): Promise<{ lead: Lead; outreach: OutreachContent }> {
  const outreach = await generateOutreach(lead);

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
