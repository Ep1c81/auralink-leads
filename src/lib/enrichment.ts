import { supabase } from "@/lib/supabase";
import type { Lead, WebEnrichment } from "@/lib/types";

// Kept strict: this runs inline in the qualify request path, which has its
// own ~4s end-to-end budget, so a slow/unresponsive site must bail out well
// before it could blow that deadline.
const FETCH_TIMEOUT_MS = 3000;
const MAX_HTML_CHARS = 500_000;
const USER_AGENT = "prospect-lead-engine/1.0 (lead enrichment)";

const SOCIAL_PATTERNS: Record<string, RegExp> = {
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/[^\s"'<>]+/i,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/i,
  twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s"'<>]+/i,
  linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/[^\s"'<>]+/i,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/[^\s"'<>]+/i,
  whatsapp: /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^\s"'<>]+/i,
};

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|svg|webp)$/i;

function extractEmails(html: string): string[] {
  const matches = html.match(EMAIL_REGEX) ?? [];
  const unique = new Set(
    matches.map((m) => m.toLowerCase()).filter((m) => !IMAGE_EXTENSION_REGEX.test(m))
  );
  return Array.from(unique).slice(0, 10);
}

function extractSocialLinks(html: string): Record<string, string> {
  const links: Record<string, string> = {};
  for (const [platform, pattern] of Object.entries(SOCIAL_PATTERNS)) {
    const match = html.match(pattern);
    if (match) {
      links[platform] = match[0].replace(/["'<>].*$/, "");
    }
  }
  return links;
}

function extractDescription(html: string): string | null {
  const match =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return match?.[1]?.trim() || null;
}

/**
 * Fetches a business's website and extracts contact/context signals: email
 * addresses, social profile links, and the meta description. Never throws —
 * network/parse failures come back as a WebEnrichment with `error` set, so a
 * bad site never blocks the qualification flow that triggers this.
 */
export async function enrichFromWebsite(url: string): Promise<WebEnrichment> {
  const fetchedAt = new Date().toISOString();

  try {
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(normalizedUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return {
        emails: [],
        socialLinks: {},
        description: null,
        fetchedAt,
        error: `Website returned ${response.status}`,
      };
    }

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);

    return {
      emails: extractEmails(html),
      socialLinks: extractSocialLinks(html),
      description: extractDescription(html),
      fetchedAt,
    };
  } catch (err) {
    console.error(`[enrichment] fetch failed for ${url}:`, err);
    return {
      emails: [],
      socialLinks: {},
      description: null,
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Enriches a lead from its metadata.website (if present) and persists the
 * result into metadata.enrichment. Returns null when the lead has no
 * website, or when the Supabase update fails — this is a best-effort side
 * effect of qualification and must never throw or block the caller.
 */
export async function enrichAndSaveLead(lead: Lead): Promise<Lead | null> {
  const website = lead.metadata?.website;
  if (typeof website !== "string" || !website.trim()) {
    return null;
  }

  const enrichment = await enrichFromWebsite(website);

  const { data: updatedLead, error } = await supabase
    .from("leads")
    .update({
      metadata: { ...(lead.metadata ?? {}), enrichment },
    })
    .eq("id", lead.id)
    .select()
    .single();

  if (error || !updatedLead) {
    console.error(`[enrichment] failed to save enrichment for lead ${lead.id}:`, error);
    return null;
  }

  return updatedLead as Lead;
}
