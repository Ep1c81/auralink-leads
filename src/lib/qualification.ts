import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { notifyLeadQualified } from "@/lib/notifications";
import type { BantQualification, Lead, LeadConversation } from "@/lib/types";

// Batch qualification retries a 429 up to 3 times with exponential backoff
// before giving up and falling back to a heuristic score.
const RATE_LIMIT_RETRY_DELAYS_MS = [5000, 10000, 20000];

function isRateLimitError(err: unknown): boolean {
  return err instanceof Anthropic.RateLimitError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * Structured output via tool use, same as outreach.ts: forced tool_choice is
 * rejected with a 400 on claude-sonnet-5-5, so the model is steered to this
 * tool with tool_choice "auto" + a prompt instruction, and `strict` keeps the
 * input schema-valid.
 */
const submitQualificationTool: Anthropic.Tool = {
  name: "submit_bant_qualification",
  description: "Submit the BANT qualification result for this lead.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      budget: {
        type: "object",
        properties: {
          score: { type: "integer", description: "0-10 confidence score" },
          notes: { type: "string" },
        },
        required: ["score", "notes"],
        additionalProperties: false,
      },
      authority: {
        type: "object",
        properties: {
          score: { type: "integer", description: "0-10 confidence score" },
          notes: { type: "string" },
        },
        required: ["score", "notes"],
        additionalProperties: false,
      },
      need: {
        type: "object",
        properties: {
          score: { type: "integer", description: "0-10 confidence score" },
          notes: { type: "string" },
        },
        required: ["score", "notes"],
        additionalProperties: false,
      },
      timeline: {
        type: "object",
        properties: {
          score: { type: "integer", description: "0-10 confidence score" },
          notes: { type: "string" },
        },
        required: ["score", "notes"],
        additionalProperties: false,
      },
      overall_score: {
        type: "integer",
        description: "0-100 aggregate lead score",
      },
      status: {
        type: "string",
        enum: ["qualified", "unqualified", "needs_more_info"],
      },
      summary: { type: "string" },
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
    additionalProperties: false,
  },
};

/**
 * Sends a qualification prompt to Claude and returns the submitted BANT
 * result. Throws if ANTHROPIC_API_KEY is unset, the request fails, or no
 * tool call comes back; callers decide whether to fall back. SDK retries
 * are off so the 429 backoff below and the routes' deadlines stay in charge.
 */
async function requestQualification(
  prompt: string,
  model: string,
  signal?: AbortSignal
): Promise<BantQualification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const anthropic = new Anthropic({ apiKey, maxRetries: 0 });
  const response = await anthropic.messages.create(
    {
      model,
      max_tokens: 1024,
      output_config: { effort: "low" },
      tools: [submitQualificationTool],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages: [{ role: "user", content: prompt }],
    },
    { signal }
  );

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === submitQualificationTool.name
  );
  if (!toolUse) {
    throw new Error(
      `Claude response has no submit_bant_qualification call (stop_reason: ${response.stop_reason})`
    );
  }

  return toolUse.input as BantQualification;
}

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

For each BANT dimension, give a 0-10 confidence score and short supporting notes based only on evidence in the message. Then give an overall_score (0-100), a status ("qualified", "unqualified", or "needs_more_info"), and a one-paragraph summary explaining the qualification decision.

Submit the result by calling the submit_bant_qualification tool.`;
}

function buildProfilePrompt(lead: Lead, contextNote?: string): string {
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
${contextNote ? `\nAdditional targeting context: ${contextNote}` : ""}

Since there is no direct inquiry, base your BANT confidence scores on reasonable, conservative inference for a small local business of this type and size: budget likelihood given the industry, authority (owners/operators of small local businesses typically hold direct purchasing authority), need (would a business like this plausibly benefit from more customers or a better digital presence), and timeline (assume unknown/moderate unless the profile suggests otherwise). Do not invent facts you don't have evidence for.

For each BANT dimension, give a 0-10 confidence score and one short sentence of supporting notes. Then give an overall_score (0-100), a status ("qualified", "unqualified", or "needs_more_info"), and a summary of at most two sentences explaining the qualification decision.

Submit the result by calling the submit_bant_qualification tool.`;
}

export async function runBantQualification(
  lead: Pick<Lead, "name" | "company" | "email">,
  message: string
): Promise<BantQualification> {
  return requestQualification(
    buildPrompt(lead, message),
    process.env.ANTHROPIC_QUALIFICATION_MODEL ?? "claude-sonnet-5-5"
  );
}

export async function runBantQualificationFromProfile(
  lead: Lead,
  contextNote?: string,
  signal?: AbortSignal
): Promise<BantQualification> {
  // Haiku + the profile prompt's shorter notes keep this under the qualify
  // routes' 4s pipeline deadline; Sonnet measured 3.5-6.6s on the same prompt.
  return requestQualification(
    buildProfilePrompt(lead, contextNote),
    process.env.ANTHROPIC_QUALIFICATION_PROFILE_MODEL ?? "claude-haiku-5-5",
    signal
  );
}

/**
 * Deterministic BANT estimate used when Claude qualification is unavailable
 * (rate-limited past all retries, or otherwise erroring). Scores lean on
 * basic profile completeness — name, phone, website, address — rather than
 * any real assessment, and always comes back "needs_more_info" so it never
 * masquerades as a real AI qualification.
 */
function computeHeuristicQualification(lead: Lead): BantQualification {
  const metadata = lead.metadata ?? {};
  const hasName = Boolean(lead.name || lead.company);
  const hasPhone = Boolean(lead.phone);
  const hasWebsite =
    typeof metadata.website === "string" && metadata.website.trim().length > 0;
  const hasAddress =
    typeof metadata.address === "string" && metadata.address.trim().length > 0;
  const signalCount = [hasName, hasPhone, hasWebsite, hasAddress].filter(Boolean).length;

  return {
    budget: {
      score: 4,
      notes: "Claude qualification was unavailable — budget could not be estimated and defaults to a conservative baseline.",
    },
    authority: {
      score: hasName ? (hasPhone ? 6 : 5) : 3,
      notes: hasPhone
        ? "A listed business name and phone number suggest an identifiable, reachable owner/operator."
        : "Limited contact details on file; authority is a rough estimate, not confirmed.",
    },
    need: {
      score: hasWebsite ? 5 : 6,
      notes: hasWebsite
        ? "Business already has a web presence; need is estimated as moderate."
        : "No website on file; need for a digital presence is plausible but unconfirmed.",
    },
    timeline: {
      score: 2,
      notes: "No inbound signal available to estimate timeline.",
    },
    overall_score: Math.min(100, 20 + signalCount * 10),
    status: "needs_more_info",
    summary: `Automatic fallback qualification for ${lead.name ?? lead.company ?? "this lead"}: Claude qualification was unavailable (rate limit exhausted or request failed), so this score was estimated from basic profile signals (${signalCount}/4 of name, phone, website, and address present). Flagged as needs_more_info pending a real AI qualification pass.`,
  };
}

/**
 * Runs profile-based BANT qualification with retry: on a 429 rate-limit
 * error, retries up to 3 times with exponential backoff (5s, 10s, 20s)
 * before giving up. Any other error — including a network failure or a
 * timeout on `signal` — or exhausting all retries, falls back to a
 * heuristic score instead of throwing — batch qualification should never
 * blow up mid-loop.
 */
export async function runBantQualificationFromProfileWithFallback(
  lead: Lead,
  contextNote?: string,
  signal?: AbortSignal
): Promise<{ qualification: BantQualification; usedFallback: boolean }> {
  const maxAttempts = RATE_LIMIT_RETRY_DELAYS_MS.length + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      lastError = signal.reason ?? new Error("Qualification aborted");
      break;
    }

    try {
      const qualification = await runBantQualificationFromProfile(lead, contextNote, signal);
      return { qualification, usedFallback: false };
    } catch (err) {
      lastError = err;

      if (!isRateLimitError(err) || attempt === maxAttempts - 1) {
        break;
      }

      const delay = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
      console.warn(
        `[qualification] Rate limited qualifying lead ${lead.id} (attempt ${attempt + 1}/${maxAttempts}); retrying in ${delay}ms`
      );
      await sleep(delay, signal);
    }
  }

  console.error(
    `[qualification] Claude qualification failed or timed out for lead ${lead.id}, using heuristic fallback:`,
    lastError
  );
  return { qualification: computeHeuristicQualification(lead), usedFallback: true };
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
export async function qualifyLeadProfile(
  lead: Lead,
  contextNote?: string,
  signal?: AbortSignal
): Promise<{
  lead: Lead;
  qualification: BantQualification;
}> {
  const { qualification, usedFallback } = await runBantQualificationFromProfileWithFallback(
    lead,
    contextNote,
    signal
  );
  const { lead: updatedLead } = await persistQualification(
    lead,
    qualification,
    usedFallback ? "heuristic_fallback" : "gemini_qualifier_batch"
  );

  return { lead: updatedLead, qualification };
}

/**
 * Computes and persists a heuristic-only BANT estimate, bypassing Claude
 * entirely. Used by callers that enforce their own hard deadline (e.g. an
 * API route's timeout controller) when the Claude-backed qualification flow
 * in qualifyLeadProfile doesn't resolve in time.
 */
export async function qualifyLeadProfileHeuristic(lead: Lead): Promise<{
  lead: Lead;
  qualification: BantQualification;
}> {
  const qualification = computeHeuristicQualification(lead);
  const { lead: updatedLead } = await persistQualification(
    lead,
    qualification,
    "heuristic_fallback_timeout"
  );

  return { lead: updatedLead, qualification };
}
