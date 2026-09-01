import { supabase } from "@/lib/supabase";
import type { Lead } from "@/lib/types";

export interface DiscoveredBusiness {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  userRatingCount: number | null;
  source: "osm" | "google_places";
}

interface PlacesSearchResponse {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
  }>;
}

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
].join(",");

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

// Public Overpass mirrors, tried in order. A 429, 504, or network/timeout
// error on one triggers failover to the next; any other error (e.g. a bad
// query) fails fast since it would fail identically on every mirror.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const USER_AGENT = "prospect-lead-engine/1.0 (business discovery)";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * fetch with an explicit timeout so a slow/unresponsive server never hangs
 * the request indefinitely — every network call in this module goes through
 * this wrapper.
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isNetworkOrTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "AbortError" ||
    err.name === "TypeError" ||
    /timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(err.message)
  );
}

interface NominatimResult {
  boundingbox: [string, string, string, string]; // [south, north, west, east]
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Searches for local businesses by industry + location using OpenStreetMap
 * as the primary source, since it requires no API key setup:
 *   1. Overpass API (category-tag search), with mirror failover.
 *   2. Nominatim free-text search, if every Overpass mirror fails.
 *   3. Google Places (Text Search, New), if OSM entirely fails.
 * This chain is designed to always return results rather than throw.
 */
export async function searchBusinesses(
  industry: string,
  location: string,
  limit = 20
): Promise<DiscoveredBusiness[]> {
  try {
    return await searchBusinessesOSM(industry, location, limit);
  } catch (err) {
    console.error(
      "[OpenStreetMap] request error, falling back to Google Places:",
      err
    );
    return searchBusinessesGooglePlaces(industry, location, limit);
  }
}

async function searchBusinessesGooglePlaces(
  industry: string,
  location: string,
  limit: number
): Promise<DiscoveredBusiness[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured");
  }

  const textQuery = `${industry} in ${location}`;

  const response = await fetchWithTimeout(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[Google Places] search failed (${response.status} ${response.statusText}):`,
      errorBody
    );
    throw new Error(`Places search failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as PlacesSearchResponse;

  return (data.places ?? [])
    .slice(0, Math.min(Math.max(limit, 1), 20))
    .map((place) => ({
      placeId: place.id,
      name: place.displayName?.text ?? "Unknown business",
      address: place.formattedAddress ?? null,
      phone: place.nationalPhoneNumber ?? null,
      website: place.websiteUri ?? null,
      rating: place.rating ?? null,
      userRatingCount: place.userRatingCount ?? null,
      source: "google_places" as const,
    }));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Naive English de-pluralizer ("dentists" -> "dentist", "bakeries" -> "bakery").
 *  OSM tag values are always singular, but users type industries as plurals
 *  ("dentists", "barbershops"), and Overpass's `~` operator is a literal
 *  substring/regex match — "dentists" never matches inside "dentist" since
 *  it's the longer string. Without this, almost every plural search term
 *  returns 0 results even when matching businesses exist. */
function singularize(word: string): string {
  if (word.endsWith("ies") && word.length > 3) return word.slice(0, -3) + "y";
  if (word.endsWith("s") && word.length > 1) return word.slice(0, -1);
  return word;
}

function normalizeIndustryKey(term: string): string {
  return term.trim().toLowerCase().replace(/[^a-z]/g, "");
}

interface OsmTagAlternative {
  key: "shop" | "craft" | "amenity" | "office" | "leisure" | "tourism";
  value: string;
}

/**
 * Maps common colloquial industry terms to the actual OSM tag vocabulary.
 * Plural normalization alone fixes terms that already match OSM's tag value
 * once singularized (e.g. "restaurants" -> amenity=restaurant), but many
 * everyday terms don't share any substring with the tag OSM actually uses
 * (a barbershop is shop=hairdresser, not shop=barber; a gym is
 * leisure=fitness_centre, not amenity=gym) — those need an explicit mapping
 * or they silently return 0 results no matter how the input is normalized.
 * Keys are the singularized, alpha-only form of the search term.
 */
const INDUSTRY_SYNONYMS: Record<string, OsmTagAlternative[]> = {
  barbershop: [{ key: "shop", value: "hairdresser" }],
  barber: [{ key: "shop", value: "hairdresser" }],
  hairsalon: [{ key: "shop", value: "hairdresser" }],
  hairdresser: [{ key: "shop", value: "hairdresser" }],
  salon: [{ key: "shop", value: "hairdresser|beauty" }],
  nailsalon: [{ key: "shop", value: "beauty" }],
  spa: [
    { key: "leisure", value: "spa" },
    { key: "shop", value: "beauty" },
  ],
  gym: [{ key: "leisure", value: "fitness_centre" }],
  fitnesscenter: [{ key: "leisure", value: "fitness_centre" }],
  fitnesscentre: [{ key: "leisure", value: "fitness_centre" }],
  autorepair: [{ key: "shop", value: "car_repair" }],
  mechanic: [{ key: "shop", value: "car_repair" }],
  cardealer: [{ key: "shop", value: "car" }],
  pharmacy: [{ key: "amenity", value: "pharmacy" }],
  drugstore: [{ key: "amenity", value: "pharmacy" }],
  doctor: [{ key: "amenity", value: "doctors" }],
  clinic: [{ key: "amenity", value: "clinic" }],
  lawyer: [{ key: "office", value: "lawyer" }],
  attorney: [{ key: "office", value: "lawyer" }],
  lawfirm: [{ key: "office", value: "lawyer" }],
  realestate: [{ key: "office", value: "estate_agent" }],
  realtor: [{ key: "office", value: "estate_agent" }],
  veterinarian: [{ key: "amenity", value: "veterinary" }],
  vet: [{ key: "amenity", value: "veterinary" }],
  coffeeshop: [{ key: "amenity", value: "cafe" }],
  bar: [{ key: "amenity", value: "bar" }],
  pub: [{ key: "amenity", value: "pub" }],
  hotel: [{ key: "tourism", value: "hotel" }],
  motel: [{ key: "tourism", value: "motel" }],
  tattooparlor: [{ key: "shop", value: "tattoo" }],
  massage: [{ key: "shop", value: "massage|beauty" }],
  laundromat: [{ key: "shop", value: "laundry" }],
  drycleaner: [{ key: "shop", value: "dry_cleaning" }],
};

const DEFAULT_OSM_KEYS = ["shop", "craft", "amenity", "office"] as const;

/**
 * Builds the Overpass tag-matching clauses for an industry search: a known
 * synonym maps to its real OSM tag(s); anything else falls back to a literal
 * (singularized) match across the general-purpose category keys. Either way,
 * a `name` match on the raw term is added so a business whose OSM name
 * literally contains the search word is still caught.
 */
function buildOverpassTagClauses(industry: string, bbox: string): string[] {
  const trimmed = industry.trim();
  const normalized = normalizeIndustryKey(trimmed);
  const alternatives =
    INDUSTRY_SYNONYMS[normalized] ?? INDUSTRY_SYNONYMS[singularize(normalized)];

  const clauses = alternatives
    ? alternatives.map(
        ({ key, value }) => `nwr["${key}"~"${value}",i](${bbox});`
      )
    : DEFAULT_OSM_KEYS.map((key) => {
        const pattern = escapeRegex(singularize(trimmed.toLowerCase()));
        return `nwr["${key}"~"${pattern}",i](${bbox});`;
      });

  clauses.push(`nwr["name"~"${escapeRegex(trimmed)}",i](${bbox});`);
  return clauses;
}

async function geocodeBoundingBox(
  location: string
): Promise<{ south: number; west: number; north: number; east: number }> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", location);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const response = await fetchWithTimeout(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Nominatim geocoding failed (${response.status})`);
  }

  const results = (await response.json()) as NominatimResult[];
  const bbox = results[0]?.boundingbox;
  if (!bbox) {
    throw new Error(`Could not geocode location: ${location}`);
  }

  const [south, north, west, east] = bbox.map(Number);
  return { south, west, north, east };
}

function formatOSMAddress(tags: Record<string, string>): string | null {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"],
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : null;
}

function parseOverpassResponse(
  data: OverpassResponse,
  cap: number
): DiscoveredBusiness[] {
  const seen = new Set<string>();
  const businesses: DiscoveredBusiness[] = [];

  for (const el of data.elements) {
    const tags = el.tags;
    if (!tags?.name) continue;

    const placeId = `osm_${el.type}_${el.id}`;
    if (seen.has(placeId)) continue;
    seen.add(placeId);

    businesses.push({
      placeId,
      name: tags.name,
      address: formatOSMAddress(tags),
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      website: tags.website ?? tags["contact:website"] ?? null,
      // OSM has no standard aggregate-rating tag comparable to Google's.
      rating: null,
      userRatingCount: null,
      source: "osm",
    });

    if (businesses.length >= cap) break;
  }

  return businesses;
}

type OverpassMirrorResult =
  | { ok: true; data: OverpassResponse }
  | { ok: false; retryable: boolean; error: Error };

async function tryOverpassMirror(
  endpoint: string,
  query: string
): Promise<OverpassMirrorResult> {
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (response.ok) {
      return { ok: true, data: (await response.json()) as OverpassResponse };
    }

    const errorBody = await response.text();
    console.error(
      `[Overpass] ${endpoint} failed (${response.status} ${response.statusText}):`,
      errorBody
    );
    return {
      ok: false,
      retryable: response.status === 429 || response.status === 504,
      error: new Error(`Overpass search failed (${response.status}): ${errorBody}`),
    };
  } catch (err) {
    console.error(`[Overpass] ${endpoint} request error:`, err);
    return {
      ok: false,
      retryable: isNetworkOrTimeoutError(err),
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Queries the Overpass mirrors in order. A 429, 504, or network/timeout
 * error fails over to the next mirror; any other error stops immediately,
 * since it would fail identically on every mirror.
 */
async function queryOverpassWithFailover(query: string): Promise<OverpassResponse> {
  let lastError: Error = new Error("No Overpass mirrors configured");

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const result = await tryOverpassMirror(endpoint, query);
    if (result.ok) {
      return result.data;
    }

    lastError = result.error;
    if (!result.retryable) {
      throw result.error;
    }

    console.error(`[Overpass] ${endpoint} unavailable, trying next mirror.`);
  }

  throw lastError;
}

/**
 * Searches OpenStreetMap: geocodes the location to a bounding box via
 * Nominatim, then queries Overpass (with mirror failover) for
 * nodes/ways/relations whose tags match the industry keyword — translated to
 * OSM's own tag vocabulary and singularized via buildOverpassTagClauses,
 * since a literal match against raw user input (e.g. plural "dentists" or a
 * colloquial term like "barbershops") mostly returns 0 results. If every
 * Overpass mirror fails, falls back to a Nominatim free-text search instead
 * of throwing.
 */
async function searchBusinessesOSM(
  industry: string,
  location: string,
  limit: number
): Promise<DiscoveredBusiness[]> {
  const cap = Math.min(Math.max(limit, 1), 20);

  try {
    const { south, west, north, east } = await geocodeBoundingBox(location);
    const bbox = `${south},${west},${north},${east}`;
    const tagClauses = buildOverpassTagClauses(industry, bbox);

    const query = `
      [out:json][timeout:9];
      (
        ${tagClauses.join("\n        ")}
      );
      out center ${cap * 3};
    `;

    const data = await queryOverpassWithFailover(query);
    return parseOverpassResponse(data, cap);
  } catch (err) {
    console.error(
      "[Overpass] all mirrors failed, falling back to Nominatim search:",
      err
    );
    return searchBusinessesNominatim(industry, location, cap);
  }
}

interface NominatimSearchResult {
  osm_type: string;
  osm_id: number;
  display_name: string;
  extratags?: Record<string, string>;
}

/**
 * Direct Nominatim free-text business search — the final OSM fallback when
 * every Overpass mirror is unavailable. Uses a comma-separated query
 * ("industry, location"); Nominatim's geocoder does not reliably handle
 * natural-language phrasing like "industry in location".
 */
async function searchBusinessesNominatim(
  industry: string,
  location: string,
  cap: number
): Promise<DiscoveredBusiness[]> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", `${industry}, ${location}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("limit", String(cap));

  const response = await fetchWithTimeout(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[Nominatim] search failed (${response.status} ${response.statusText}):`,
      errorBody
    );
    throw new Error(`Nominatim search failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as NominatimSearchResult[];

  return data.map((result) => ({
    placeId: `osm_${result.osm_type}_${result.osm_id}`,
    name: result.display_name.split(",")[0]?.trim() ?? result.display_name,
    address: result.display_name,
    phone: result.extratags?.phone ?? result.extratags?.["contact:phone"] ?? null,
    website: result.extratags?.website ?? result.extratags?.["contact:website"] ?? null,
    rating: null,
    userRatingCount: null,
    source: "osm" as const,
  }));
}

// Shared by /api/prospecting and /api/cron/auto-prospect so both manual and
// automated discovery apply the exact same "prime tap-standee target"
// definition.
export const LOW_RATING_THRESHOLD = 4.2;
export const LOW_REVIEW_COUNT_THRESHOLD = 15;

/** Rated under 4.2, or with fewer than 15 reviews (missing review data counts
 *  as "fewer than 15") — prime targets for review management / tap standee
 *  outreach. */
export function isLowRatingTarget(business: {
  rating: number | null;
  userRatingCount: number | null;
}): boolean {
  const hasLowRating = business.rating !== null && business.rating < LOW_RATING_THRESHOLD;
  const hasFewReviews =
    business.userRatingCount === null || business.userRatingCount < LOW_REVIEW_COUNT_THRESHOLD;
  return hasLowRating || hasFewReviews;
}

/**
 * Dedupes discovered businesses against leads already in the pipeline (by
 * Google Place ID / OSM ID) and inserts the new ones as "new" leads. Shared
 * by /api/prospecting and /api/cron/auto-prospect so a business found by
 * both a manual search and the automated sweep is only ever imported once.
 */
export async function importDiscoveredBusinesses(
  businesses: DiscoveredBusiness[],
  industry: string,
  location: string
): Promise<Lead[]> {
  if (businesses.length === 0) return [];

  const placeIds = businesses.map((b) => b.placeId);
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("metadata")
    .in("metadata->>place_id", placeIds);

  const existingPlaceIds = new Set(
    (existingLeads ?? [])
      .map((l) => (l.metadata as Record<string, unknown> | null)?.place_id)
      .filter((id): id is string => typeof id === "string")
  );

  const newBusinesses = businesses.filter((b) => !existingPlaceIds.has(b.placeId));
  if (newBusinesses.length === 0) return [];

  // `leads` has a unique (name, company) index — dedupe within this batch too,
  // since discovery sources can return the same business name twice (e.g. a
  // chain with multiple listings) and place_id alone won't catch that.
  const seenNameCompany = new Set<string>();
  const dedupedBusinesses = newBusinesses.filter((b) => {
    const key = `${b.name}::${b.name}`;
    if (seenNameCompany.has(key)) return false;
    seenNameCompany.add(key);
    return true;
  });

  const { data: imported, error } = await supabase
    .from("leads")
    .upsert(
      dedupedBusinesses.map((b) => ({
        name: b.name,
        company: b.name,
        phone: b.phone,
        status: "new",
        metadata: {
          source: b.source,
          place_id: b.placeId,
          address: b.address,
          website: b.website,
          rating: b.rating,
          user_rating_count: b.userRatingCount,
          industry,
          location,
        },
      })),
      { onConflict: "name,company", ignoreDuplicates: true }
    )
    .select();

  if (error) {
    throw new Error(`Failed to import leads: ${error.message}`);
  }

  return (imported ?? []) as Lead[];
}
