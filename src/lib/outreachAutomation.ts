import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { buildOutreachMessage, cantonFromAddress, type OutreachStage } from "@/lib/whatsapp";

/**
 * Automated WhatsApp sequence over bizmap_leads, sent through a Make.com
 * scenario (which hands off to ManyChat / Zernio). Status lifecycle — see
 * supabase/migrations/20260925040000_bizmap_leads_outreach_automation.sql:
 *
 *   Queued -> Pitch Sent -> Followup Sent
 *        any -> Replied (via /api/webhooks/make-reply)
 *
 * "Sent" here means Make accepted the batch (2xx), not that WhatsApp
 * delivered it — Make's webhook acknowledges before the scenario runs.
 */

export type BizmapOutreachStatus = "Queued" | "Pitch Sent" | "Followup Sent" | "Replied" | "Closed";

export type SequenceStage = "pitch_1" | "followup_2";

const STAGE_TEMPLATE: Record<SequenceStage, OutreachStage> = {
  pitch_1: "pitch",
  followup_2: "follow_up",
};

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const FOLLOW_UP_AFTER_DAYS = 3;

// wa_phone is a generated column (format_wa_phone); only Costa Rican numbers
// are eligible for automated sends. Mobile numbers start with 5-8; 2/4 are
// landlines, which usually aren't on WhatsApp.
const CR_NUMBER = "^506[0-9]{8}$";
const CR_MOBILE_NUMBER = "^506[5-8][0-9]{7}$";

interface BizmapLeadRow {
  id: string;
  business_name: string | null;
  address: string | null;
  wa_phone: string | null;
}

export interface DispatchItem {
  lead_id: string;
  phone: string;
  business_name: string;
  canton: string;
  template_text: string;
  sequence_stage: SequenceStage;
}

export interface DispatchOptions {
  limit: number;
  dryRun: boolean;
  mobileOnly: boolean;
}

export interface DispatchResult {
  sequence_stage: SequenceStage;
  dry_run: boolean;
  dispatched: number;
  /** Rows dropped from the sequence because another row already covers their number. */
  skipped_duplicates: number;
  leads: DispatchItem[];
}

/**
 * Fail-closed shared-secret check for every Make.com-facing route: callers
 * send `Authorization: Bearer <OUTREACH_AUTOMATION_SECRET>`. Returns an error
 * response to send back, or null when the request is authorized.
 */
export function checkAutomationAuth(request: Request): NextResponse | null {
  const secret = process.env.OUTREACH_AUTOMATION_SECRET;
  if (!secret) {
    console.error("[outreachAutomation] OUTREACH_AUTOMATION_SECRET not configured; rejecting request");
    return NextResponse.json({ error: "Endpoint not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Reads `limit`, `dry_run` and `mobile_only` from the query string. */
export function parseDispatchOptions(request: Request): DispatchOptions {
  const params = new URL(request.url).searchParams;
  const rawLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_BATCH_SIZE)
    : DEFAULT_BATCH_SIZE;
  const flag = (name: string) => ["1", "true"].includes(params.get(name) ?? "");
  return { limit, dryRun: flag("dry_run"), mobileOnly: flag("mobile_only") };
}

function toDispatchItem(lead: BizmapLeadRow, stage: SequenceStage): DispatchItem {
  const businessName = lead.business_name?.trim() || "";
  const canton = cantonFromAddress(lead.address);
  return {
    lead_id: lead.id,
    phone: `+${lead.wa_phone}`,
    business_name: businessName,
    canton,
    template_text: buildOutreachMessage({ businessName, canton, stage: STAGE_TEMPLATE[stage] }),
    sequence_stage: stage,
  };
}

async function postToMake(stage: SequenceStage, leads: DispatchItem[]): Promise<void> {
  const webhookUrl = process.env.MAKE_DISPATCH_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    throw new DispatchConfigError("MAKE_DISPATCH_WEBHOOK_URL is not configured");
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sequence_stage: stage, count: leads.length, leads }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Make webhook responded ${response.status}: ${text.slice(0, 200)}`);
  }
}

export class DispatchConfigError extends Error {}

/**
 * Drops leads whose number is already covered: a duplicate within this batch,
 * or a number another row has already contacted. Duplicates are taken out of
 * the sequence (outreach_status = null) so they don't block future batches.
 */
async function dedupeByPhone(leads: BizmapLeadRow[], dryRun: boolean) {
  const phones = [...new Set(leads.map((l) => l.wa_phone!))];
  const { data: contacted, error } = await getSupabase()
    .from("bizmap_leads")
    .select("wa_phone")
    .in("wa_phone", phones)
    .in("outreach_status", ["Pitch Sent", "Followup Sent", "Replied", "Closed"]);
  if (error) throw new Error(`Failed to check contacted numbers: ${error.message}`);

  const seen = new Set((contacted ?? []).map((r) => r.wa_phone as string));
  const keep: BizmapLeadRow[] = [];
  const duplicateIds: string[] = [];
  for (const lead of leads) {
    if (seen.has(lead.wa_phone!)) {
      duplicateIds.push(lead.id);
    } else {
      seen.add(lead.wa_phone!);
      keep.push(lead);
    }
  }

  if (duplicateIds.length > 0 && !dryRun) {
    const { error: dropError } = await getSupabase()
      .from("bizmap_leads")
      .update({ outreach_status: null })
      .in("id", duplicateIds)
      .eq("outreach_status", "Queued");
    if (dropError) throw new Error(`Failed to drop duplicate leads: ${dropError.message}`);
  }
  return { keep, skipped: duplicateIds.length };
}

async function markContacted(
  ids: string[],
  from: BizmapOutreachStatus,
  to: BizmapOutreachStatus
): Promise<void> {
  const now = new Date().toISOString();
  // The status guard keeps a reply that landed mid-dispatch from being
  // overwritten; outreached_at keeps the dashboard's "Outreached" views in step.
  const { error } = await getSupabase()
    .from("bizmap_leads")
    .update({ outreach_status: to, last_contacted_at: now, outreached_at: now })
    .in("id", ids)
    .eq("outreach_status", from)
    .eq("has_replied", false);
  if (error) {
    // The batch already went out; surface loudly so it isn't re-sent blindly.
    throw new Error(`Batch sent to Make but status update failed: ${error.message}`);
  }
}

/**
 * Stage 1: sends the soft-CTA pitch to a batch of Queued leads and moves them
 * to "Pitch Sent". Not safe to run concurrently with itself — schedule a
 * single caller (one Make scenario).
 */
export async function dispatchPitches(options: DispatchOptions): Promise<DispatchResult> {
  const { data, error } = await getSupabase()
    .from("bizmap_leads")
    .select("id, business_name, address, wa_phone")
    .eq("outreach_status", "Queued")
    .eq("has_replied", false)
    .filter("wa_phone", "match", options.mobileOnly ? CR_MOBILE_NUMBER : CR_NUMBER)
    .order("lead_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(options.limit);
  if (error) throw new Error(`Failed to load queued leads: ${error.message}`);

  return sendBatch("pitch_1", (data ?? []) as BizmapLeadRow[], options, "Queued", "Pitch Sent");
}

/**
 * Stage 2: sends the bump message to leads pitched 3+ days ago with no reply
 * and moves them to "Followup Sent".
 */
export async function dispatchFollowUps(options: DispatchOptions): Promise<DispatchResult> {
  const cutoff = new Date(Date.now() - FOLLOW_UP_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from("bizmap_leads")
    .select("id, business_name, address, wa_phone")
    .eq("outreach_status", "Pitch Sent")
    .eq("has_replied", false)
    .lt("last_contacted_at", cutoff)
    .filter("wa_phone", "match", options.mobileOnly ? CR_MOBILE_NUMBER : CR_NUMBER)
    .order("last_contacted_at", { ascending: true })
    .limit(options.limit);
  if (error) throw new Error(`Failed to load follow-up leads: ${error.message}`);

  const leads = (data ?? []) as BizmapLeadRow[];
  // A number is only ever pitched from one row, so a repeat here is a
  // duplicate listing — keep the first rather than bump the same chat twice.
  const seen = new Set<string>();
  const unique = leads.filter((l) => !seen.has(l.wa_phone!) && seen.add(l.wa_phone!));
  return sendBatch("followup_2", unique, options, "Pitch Sent", "Followup Sent", leads.length - unique.length);
}

async function sendBatch(
  stage: SequenceStage,
  candidates: BizmapLeadRow[],
  options: DispatchOptions,
  from: BizmapOutreachStatus,
  to: BizmapOutreachStatus,
  alreadySkipped = 0
): Promise<DispatchResult> {
  let leads = candidates;
  let skipped = alreadySkipped;
  if (stage === "pitch_1" && leads.length > 0) {
    const deduped = await dedupeByPhone(leads, options.dryRun);
    leads = deduped.keep;
    skipped += deduped.skipped;
  }

  const items = leads.map((lead) => toDispatchItem(lead, stage));
  if (items.length > 0 && !options.dryRun) {
    await postToMake(stage, items);
    await markContacted(
      items.map((i) => i.lead_id),
      from,
      to
    );
  }

  return {
    sequence_stage: stage,
    dry_run: options.dryRun,
    dispatched: items.length,
    skipped_duplicates: skipped,
    leads: items,
  };
}

/** Shared route handler body for the two dispatch endpoints. */
export async function handleDispatchRequest(
  request: Request,
  run: (options: DispatchOptions) => Promise<DispatchResult>,
  logTag: string
): Promise<NextResponse> {
  const unauthorized = checkAutomationAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await run(parseDispatchOptions(request));
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[${logTag}] dispatch failed:`, err);
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof DispatchConfigError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
