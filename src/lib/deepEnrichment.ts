import { supabase } from "@/lib/supabase";
import type { Lead } from "@/lib/types";

/**
 * Deep contact-info scraper: crawls a lead's homepage plus a few common
 * contact-page paths and writes any newly-discovered contact data into
 * dedicated `leads` columns (instagram_url, facebook_url, whatsapp_number,
 * and email/phone when those are currently missing), tracked via
 * `enrichment_status`.
 *
 * This is deliberately separate from enrichFromWebsite/enrichAndSaveLead in
 * lib/enrichment.ts, which is a lighter, homepage-only pass that writes into
 * metadata.enrichment and feeds the outreach prompt builder — that path is
 * unchanged and keeps running inside the qualify pipeline's tight deadline.
 */

const CONTACT_PATHS = ["/contact", "/contacto", "/about-us", "/about"];
const FETCH_TIMEOUT_MS = 3000;
const MAX_HTML_CHARS = 500_000;
const USER_AGENT = "prospect-lead-engine/1.0 (lead enrichment)";
const PLACEHOLDER_EMAIL = "no-email@placeholder.local";

// Costa Rica is this pipeline's default target market (see CR_COUNTRY_CODE /
// buildWhatsAppLink in the main dashboard) — local numbers are 8 digits
// starting 2/4/5/6/7/8, so that's the "regional phone format" fallback when
// a page has no explicit tel: link.
const CR_COUNTRY_CODE = "506";
const CR_PHONE_REGEX = /(?:\+?506[\s.-]?)?[2-8]\d{3}[\s.-]?\d{4}\b/;
const TEL_HREF_REGEX = /href=["']tel:([+\d][\d\s\-().]{5,}\d)["']/i;
const WHATSAPP_LINK_REGEX =
  /https?:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{7,15})/i;
const INSTAGRAM_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/i;
const FACEBOOK_REGEX = /https?:\/\/(?:www\.)?facebook\.com\/[^\s"'<>]+/i;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|svg|webp)$/i;

interface PageContacts {
  email?: string;
  phone?: string;
  whatsappNumber?: string;
  instagramUrl?: string;
  facebookUrl?: string;
}

const CONTACT_KEYS: (keyof PageContacts)[] = [
  "email",
  "phone",
  "whatsappNumber",
  "instagramUrl",
  "facebookUrl",
];

function normalizePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length <= 8 ? `${CR_COUNTRY_CODE}${digits}` : digits;
}

function extractFromHtml(html: string): PageContacts {
  const result: PageContacts = {};

  const emailMatches = html.match(EMAIL_REGEX) ?? [];
  const email = emailMatches
    .map((m) => m.toLowerCase())
    .find((m) => !IMAGE_EXTENSION_REGEX.test(m));
  if (email) result.email = email;

  const facebookMatch = html.match(FACEBOOK_REGEX);
  if (facebookMatch) result.facebookUrl = facebookMatch[0].replace(/["'<>].*$/, "");

  const instagramMatch = html.match(INSTAGRAM_REGEX);
  if (instagramMatch) result.instagramUrl = instagramMatch[0].replace(/["'<>].*$/, "");

  const whatsappMatch = html.match(WHATSAPP_LINK_REGEX);
  if (whatsappMatch) result.whatsappNumber = normalizePhoneDigits(whatsappMatch[1]);

  const telMatch = html.match(TEL_HREF_REGEX);
  if (telMatch) {
    result.phone = telMatch[1].trim();
  } else {
    const regionalMatch = html.match(CR_PHONE_REGEX);
    if (regionalMatch) result.phone = regionalMatch[0].trim();
  }

  return result;
}

/** Fetches one URL and returns its HTML, or null on any failure — never throws. */
async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return null;
    return (await response.text()).slice(0, MAX_HTML_CHARS);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function markStatus(leadId: string, status: "failed"): Promise<Lead | null> {
  const { data, error } = await supabase
    .from("leads")
    .update({ enrichment_status: status })
    .eq("id", leadId)
    .select()
    .single();
  if (error || !data) return null;
  return data as Lead;
}

/**
 * Crawls the given website (homepage + common contact-page paths) for
 * contact info and persists newly-discovered fields onto the lead. Only
 * fills fields that are currently missing (or the placeholder email) —
 * never overwrites data the lead already has. Never throws.
 */
export async function deepEnrichLead(
  leadId: string,
  websiteUrl: string | null | undefined
): Promise<Lead | null> {
  try {
    if (!websiteUrl || !websiteUrl.trim()) {
      return await markStatus(leadId, "failed");
    }

    const normalized = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
    let base: URL;
    try {
      base = new URL(normalized);
    } catch {
      return await markStatus(leadId, "failed");
    }

    const candidateUrls = [
      base.toString(),
      ...CONTACT_PATHS.map((path) => new URL(path, base).toString()),
    ];

    const merged: PageContacts = {};
    let anyFetchSucceeded = false;

    for (const url of candidateUrls) {
      if (CONTACT_KEYS.every((key) => merged[key])) break;

      const html = await fetchHtml(url);
      if (html === null) continue;
      anyFetchSucceeded = true;

      const found = extractFromHtml(html);
      for (const key of CONTACT_KEYS) {
        if (!merged[key] && found[key]) merged[key] = found[key];
      }
    }

    if (!anyFetchSucceeded) {
      return await markStatus(leadId, "failed");
    }

    const { data: currentLead } = await supabase
      .from("leads")
      .select("email, phone")
      .eq("id", leadId)
      .single();

    const updates: Record<string, unknown> = { enrichment_status: "enriched" };
    if (merged.instagramUrl) updates.instagram_url = merged.instagramUrl;
    if (merged.facebookUrl) updates.facebook_url = merged.facebookUrl;
    if (merged.whatsappNumber) updates.whatsapp_number = merged.whatsappNumber;
    if (merged.email && (!currentLead?.email || currentLead.email === PLACEHOLDER_EMAIL)) {
      updates.email = merged.email;
    }
    if (merged.phone && !currentLead?.phone) {
      updates.phone = merged.phone;
    }

    const { data: updatedLead, error } = await supabase
      .from("leads")
      .update(updates)
      .eq("id", leadId)
      .select()
      .single();

    if (error || !updatedLead) {
      console.error(`[deepEnrichment] failed to save enrichment for lead ${leadId}:`, error);
      return null;
    }

    return updatedLead as Lead;
  } catch (err) {
    console.error(`[deepEnrichment] unexpected error enriching lead ${leadId}:`, err);
    return await markStatus(leadId, "failed");
  }
}
