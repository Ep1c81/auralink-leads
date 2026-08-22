import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from "@/lib/supabase";
import { notifyLeadQualified } from "@/lib/notifications";
import type { BantQualification, Lead, LeadConversation } from "@/lib/types";

const GEMINI_MODEL = "gemini-3.6-flash";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const bantResponseSchema = {
  type: Type.OBJECT,
  properties: {
    budget: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER, description: "0-10 confidence score" },
        notes: { type: Type.STRING },
      },
      required: ["score", "notes"],
    },
    authority: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER, description: "0-10 confidence score" },
        notes: { type: Type.STRING },
      },
      required: ["score", "notes"],
    },
    need: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER, description: "0-10 confidence score" },
        notes: { type: Type.STRING },
      },
      required: ["score", "notes"],
    },
    timeline: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.INTEGER, description: "0-10 confidence score" },
        notes: { type: Type.STRING },
      },
      required: ["score", "notes"],
    },
    overall_score: {
      type: Type.INTEGER,
      description: "0-100 aggregate lead score",
    },
    status: {
      type: Type.STRING,
      enum: ["qualified", "unqualified", "needs_more_info"],
    },
    summary: { type: Type.STRING },
  },
  required: [
    "budget",
    "authority",
    "need",
    "timeline",
    "overall_score",
    "status",
    "summary",
  ],
};

function buildPrompt(lead: Pick<Lead, "name" | "company" | "email">, message: string) {
  return `You are a sales qualification assistant. Evaluate the following inbound lead against the BANT framework (Budget, Authority, Need, Timeline).

Lead details:
- Name: ${lead.name ?? "unknown"}
- Company: ${lead.company ?? "unknown"}
- Email: ${lead.email ?? "unknown"}

Inbound message:
"""
${message}
"""

For each BANT dimension, give a 0-10 confidence score and short supporting notes based only on evidence in the message. Then give an overall_score (0-100), a status ("qualified", "unqualified", or "needs_more_info"), and a one-paragraph summary explaining the qualification decision.`;
}

function buildProfilePrompt(lead: Lead): string {
  const metadata = lead.metadata ?? {};
  const industry = typeof metadata.industry === "string" ? metadata.industry : "unknown";
  const location = typeof metadata.location === "string" ? metadata.location : "unknown";
  const address = typeof metadata.address === "string" ? metadata.address : "unknown";
  const website = typeof metadata.website === "string" ? metadata.website : "none";
  const source = typeof metadata.source === "string" ? metadata.source : "unknown";

  return `You are a sales qualification assistant. Evaluate the following prospected local business against the BANT framework (Budget, Authority, Need, Timeline), based on its business profile — there is no direct inbound inquiry from this lead yet.

Business profile:
- Name: ${lead.name ?? "unknown"}
- Company: ${lead.company ?? "unknown"}
- Industry: ${industry}
- Address: ${address}
- Location: ${location}
- Phone: ${lead.phone ?? "unknown"}
- Website: ${website}
- Discovery source: ${source}

Since there is no direct inquiry, base your BANT confidence scores on reasonable, conservative inference for a small local business of this type and size: budget likelihood given the industry, authority (owners/operators of small local businesses typically hold direct purchasing authority), need (would a business like this plausibly benefit from more customers or a better digital presence), and timeline (assume unknown/moderate unless the profile suggests otherwise). Do not invent facts you don't have evidence for.

For each BANT dimension, give a 0-10 confidence score and short supporting notes. Then give an overall_score (0-100), a status ("qualified", "unqualified", or "needs_more_info"), and a one-paragraph summary explaining the qualification decision.`;
}

export async function runBantQualification(
  lead: Pick<Lead, "name" | "company" | "email">,
  message: string
): Promise<BantQualification> {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: buildPrompt(lead, message),
    config: {
      responseMimeType: "application/json",
      responseSchema: bantResponseSchema,
    },
  });

  return JSON.parse(response.text ?? "{}") as BantQualification;
}

export async function runBantQualificationFromProfile(
  lead: Lead
): Promise<BantQualification> {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: buildProfilePrompt(lead),
    config: {
      responseMimeType: "application/json",
      responseSchema: bantResponseSchema,
    },
  });

  return JSON.parse(response.text ?? "{}") as BantQualification;
}

/**
 * Persists a qualification result: updates the lead's status/score/BANT
 * metadata, records a conversation entry, and fires a WhatsApp alert when
 * the lead comes out qualified. Shared by both the message-driven and
 * profile-driven qualification flows.
 */
async function persistQualification(
  lead: Lead,
  qualification: BantQualification,
  conversationSender: string
): Promise<{ lead: Lead; conversation: LeadConversation }> {
  const { data: updatedLead, error: updateError } = await supabase
    .from("leads")
    .update({
      status: qualification.status,
      lead_score: qualification.overall_score,
      metadata: {
        ...(lead.metadata ?? {}),
        bant: qualification,
      },
    })
    .eq("id", lead.id)
    .select()
    .single();

  if (updateError || !updatedLead) {
    throw new Error("Failed to update lead");
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("lead_conversations")
    .insert({
      lead_id: lead.id,
      sender: conversationSender,
      message: qualification.summary,
      metadata: qualification,
    })
    .select()
    .single();

  if (conversationError || !conversation) {
    throw new Error("Failed to store conversation");
  }

  if (qualification.status === "qualified") {
    await notifyLeadQualified(updatedLead as Lead, qualification);
  }

  return {
    lead: updatedLead as Lead,
    conversation: conversation as LeadConversation,
  };
}

/**
 * Runs BANT qualification for a lead against an inbound message, persists
 * the result, and returns the updated lead + conversation + qualification.
 */
export async function qualifyAndRecord(
  lead: Lead,
  message: string,
  conversationSender = "gemini_qualifier"
): Promise<{
  lead: Lead;
  conversation: LeadConversation;
  qualification: BantQualification;
}> {
  const qualification = await runBantQualification(lead, message);
  const { lead: updatedLead, conversation } = await persistQualification(
    lead,
    qualification,
    conversationSender
  );

  return { lead: updatedLead, conversation, qualification };
}

/**
 * Runs BANT qualification for a lead using only its prospected business
 * profile (no inbound message required) and persists the result. Used by
 * the pipeline's per-lead "Qualify Lead" and "Qualify All Unscored" actions.
 */
export async function qualifyLeadProfile(lead: Lead): Promise<{
  lead: Lead;
  qualification: BantQualification;
}> {
  const qualification = await runBantQualificationFromProfile(lead);
  const { lead: updatedLead } = await persistQualification(
    lead,
    qualification,
    "gemini_qualifier_batch"
  );

  return { lead: updatedLead, qualification };
}
