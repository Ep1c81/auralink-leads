import { NextResponse } from "next/server";
import {
  importDiscoveredBusinesses,
  isLowRatingTarget,
  searchBusinesses,
} from "@/lib/discovery";
import { qualifyLeadProfile } from "@/lib/qualification";
import { generateAndSaveOutreach } from "@/lib/outreach";
import type { Lead } from "@/lib/types";

// This is a long-running background sweep (multi-niche discovery + one
// Gemini qualification call + one Gemini outreach call per new lead, each
// with its own retry/backoff) rather than a snappy user-facing request, so
// give it plenty of headroom on platforms that support extending the
// default function timeout (e.g. Vercel).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Aura Link Digital's initial target niches for Santa Ana — small local
// businesses where a low Google rating or thin review count is a strong
// signal they'd benefit from a "Reputation Shield" NFC tap standee.
const AUTO_PROSPECT_NICHES = ["licorera", "clínica dental", "café"];
const AUTO_PROSPECT_LOCATION = "Santa Ana, Costa Rica";
const AUTO_PROSPECT_SEARCH_LIMIT = 10;

// Spacing between each imported lead's qualify+outreach calls. This is a
// baseline courtesy delay — the real rate-limit defense is the retry/backoff
// and heuristic fallback already built into runBantQualificationFromProfileWithFallback
// (see src/lib/qualification.ts) and generateOutreach (src/lib/outreach.ts),
// both of which never throw.
const AUTO_PROSPECT_STAGGER_MS = 1500;

const REPUTATION_SHIELD_OFFERING_EN =
  'a "Reputation Shield" package: physical NFC tap standees placed at the checkout counter that let a happy customer open a pre-filled 5-star Google review in one tap, paired with WhatsApp-based customer engagement — aimed at local businesses with a low Google rating or few reviews who need to build up their online reputation quickly';

// A verb-phrase, not a noun phrase: buildFallbackOutreach() in
// src/lib/outreach.ts splices this into "ayuda a negocios como X a ___", so
// it must read as a continuation of "to ___", not "to our ___".
const REPUTATION_SHIELD_OFFERING_ES =
  "blindar su reputación en Google con standees NFC que dejan una reseña de 5 estrellas en un solo toque, junto con atención al cliente por WhatsApp";

function buildReputationShieldContextNote(lead: Lead): string {
  const category =
    typeof lead.metadata?.industry === "string" && lead.metadata.industry.trim()
      ? lead.metadata.industry
      : "local business";
  const rating = lead.metadata?.rating;
  const reviewCount = lead.metadata?.user_rating_count;
  const ratingNote =
    typeof rating === "number"
      ? `Google rating ${rating.toFixed(1)} (${typeof reviewCount === "number" ? reviewCount : 0} reviews)`
      : "no Google rating on file (few or no reviews)";

  return `Business name: ${lead.name ?? lead.company ?? "unknown"}. Category: ${category}. City: ${AUTO_PROSPECT_LOCATION}. This business was sourced by an automated sweep specifically because of a low Google rating or thin review count (${ratingNote}) — evaluate it as a target for a "Reputation Shield" NFC review tap standee plus WhatsApp customer engagement.`;
}

interface NicheSweepResult {
  niche: string;
  found: number;
  imported: number;
  skipped: number;
  qualified: number;
  needsMoreInfo: number;
  unqualified: number;
  outreachGenerated: number;
  errors: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sweepNiche(niche: string): Promise<NicheSweepResult> {
  const result: NicheSweepResult = {
    niche,
    found: 0,
    imported: 0,
    skipped: 0,
    qualified: 0,
    needsMoreInfo: 0,
    unqualified: 0,
    outreachGenerated: 0,
    errors: [],
  };

  let discovered;
  try {
    discovered = await searchBusinesses(niche, AUTO_PROSPECT_LOCATION, AUTO_PROSPECT_SEARCH_LIMIT);
  } catch (err) {
    result.errors.push(`Discovery failed: ${err}`);
    return result;
  }

  const targets = discovered.filter(isLowRatingTarget);
  result.found = targets.length;

  let imported: Lead[];
  try {
    imported = await importDiscoveredBusinesses(targets, niche, AUTO_PROSPECT_LOCATION);
  } catch (err) {
    result.errors.push(`Import failed: ${err}`);
    return result;
  }

  result.imported = imported.length;
  result.skipped = targets.length - imported.length;

  for (let i = 0; i < imported.length; i++) {
    const lead = imported[i];

    try {
      // Runs the shared runBantQualificationFromProfileWithFallback() engine
      // (retry + heuristic fallback on rate limit/error) and persists the
      // result — same engine the dashboard's qualify actions use.
      const { lead: qualifiedLead, qualification } = await qualifyLeadProfile(
        lead,
        buildReputationShieldContextNote(lead)
      );

      if (qualification.status === "qualified") result.qualified++;
      else if (qualification.status === "needs_more_info") result.needsMoreInfo++;
      else result.unqualified++;

      // Pre-generate the Reputation Shield pitch for every swept lead (not
      // just "qualified" ones, unlike the dashboard's per-lead Outreach
      // button) so it's instantly ready the moment a human looks at any
      // business this sweep surfaced — the whole batch was already
      // pre-filtered to be strong tap-standee candidates by construction.
      await generateAndSaveOutreach(qualifiedLead, {
        offering: REPUTATION_SHIELD_OFFERING_EN,
        fallbackOfferingEs: REPUTATION_SHIELD_OFFERING_ES,
      });
      result.outreachGenerated++;
    } catch (err) {
      console.error(`[auto-prospect] failed processing lead ${lead.id}:`, err);
      result.errors.push(`Lead ${lead.id} (${lead.name ?? "unnamed"}): ${err}`);
    }

    if (i < imported.length - 1) {
      await sleep(AUTO_PROSPECT_STAGGER_MS);
    }
  }

  return result;
}

/**
 * Automated sweep: searches Santa Ana, CR for key niches (licorera, clínica
 * dental, café), imports low-rating/low-review businesses as leads, runs
 * each through BANT qualification, and pre-generates a Reputation Shield
 * WhatsApp pitch. Designed to be triggered either by the dashboard's
 * "Run Background Auto-Pilot" toggle or an external scheduler (e.g. Vercel
 * Cron) hitting this route on an interval — like the rest of this app's API
 * surface, it has no auth of its own.
 */
async function runSweep() {
  const results: NicheSweepResult[] = [];

  for (const niche of AUTO_PROSPECT_NICHES) {
    results.push(await sweepNiche(niche));
    // Courtesy pause between niches too, on top of the per-lead stagger
    // inside sweepNiche.
    await sleep(AUTO_PROSPECT_STAGGER_MS);
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    location: AUTO_PROSPECT_LOCATION,
    results,
  });
}

export async function POST() {
  return runSweep();
}

export async function GET() {
  return runSweep();
}
