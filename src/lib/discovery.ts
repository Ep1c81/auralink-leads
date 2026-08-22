export interface DiscoveredBusiness {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  source: "osm" | "google_places";
}

interface PlacesSearchResponse {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
  }>;
}

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
].join(",");

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "prospect-lead-engine/1.0 (business discovery)";

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
 * (Overpass API) as the primary source, since it requires no API key setup.
 * Falls back to the Google Places API (Text Search, New) if Overpass fails.
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

  const response = await fetch(PLACES_SEARCH_URL, {
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
      rating: null,
      source: "google_places" as const,
    }));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function geocodeBoundingBox(
  location: string
): Promise<{ south: number; west: number; north: number; east: number }> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", location);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
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

/**
 * Searches OpenStreetMap via the Overpass API: geocodes the location to a
 * bounding box via Nominatim, then queries Overpass for nodes/ways/relations
 * whose shop/craft/amenity/office/name tags match the industry keyword.
 */
async function searchBusinessesOSM(
  industry: string,
  location: string,
  limit: number
): Promise<DiscoveredBusiness[]> {
  const { south, west, north, east } = await geocodeBoundingBox(location);
  const bbox = `${south},${west},${north},${east}`;
  const pattern = escapeRegex(industry.trim());
  const cap = Math.min(Math.max(limit, 1), 20);

  const query = `
    [out:json][timeout:25];
    (
      nwr["shop"~"${pattern}",i](${bbox});
      nwr["craft"~"${pattern}",i](${bbox});
      nwr["amenity"~"${pattern}",i](${bbox});
      nwr["office"~"${pattern}",i](${bbox});
      nwr["name"~"${pattern}",i](${bbox});
    );
    out center ${cap * 3};
  `;

  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[Overpass] search failed (${response.status} ${response.statusText}):`,
      errorBody
    );
    throw new Error(`Overpass search failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as OverpassResponse;

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
      rating: null,
      source: "osm",
    });

    if (businesses.length >= cap) break;
  }

  return businesses;
}
