import { reservePlacesCall } from "@/lib/apiBudget";
import { supabase } from "@/lib/supabase";
import type { Lead } from "@/lib/types";

/**
 * Daily hot list: finds local businesses with thin or weak Google reviews,
 * scores how "hot" each one is as a Reputation Shield prospect, and stores
 * them as leads with a lightweight visit/trial pipeline in leads.metadata
 * (no schema migration needed).
 *
 * Unlike discovery.ts's OSM-first search, this always queries Google Places
 * so every lead carries a real rating and review count.
 */

export const HOT_LIST_NICHES = ["licorera", "barbería", "clínica dental"] as const;
/**
 * Each zone has a display name and the place text Google gets, so small
 * barrios are disambiguated by their canton.
 */
export const HOT_LIST_ZONES = [
  { name: "Santa Ana", query: "Santa Ana, San José" },
  { name: "Escazú", query: "Escazú, San José" },
  { name: "Ciudad Colón", query: "Ciudad Colón, Mora, San José" },
  { name: "Pavas", query: "Pavas, San José" },
  { name: "La Sabana", query: "La Sabana, Mata Redonda, San José" },
  { name: "Rohrmoser", query: "Rohrmoser, Pavas, San José" },
  { name: "La Uruca", query: "La Uruca, San José" },
  { name: "Puriscal", query: "Santiago de Puriscal, San José" },
  { name: "San José Centro", query: "San José centro, San José" },
  { name: "Curridabat", query: "Curridabat, San José" },
  { name: "Heredia", query: "Heredia centro, Heredia" },
  { name: "Alajuela", query: "Alajuela centro, Alajuela" },
] as const;

export type HotListZone = (typeof HOT_LIST_ZONES)[number];

/**
 * Zones searched per daily run. They rotate, so every zone is covered every
 * HOT_LIST_ZONES.length / ZONES_PER_RUN days while Google Places usage stays
 * at niches × ZONES_PER_RUN calls a day.
 */
export const ZONES_PER_RUN = 4;

/** Days it takes the rotation to cover every zone once. */
export const ROTATION_DAYS = Math.ceil(HOT_LIST_ZONES.length / ZONES_PER_RUN);

export function zonesForRun(date: Date): HotListZone[] {
  const groups = Math.ceil(HOT_LIST_ZONES.length / ZONES_PER_RUN);
  const dayIndex = Math.floor(date.getTime() / 86_400_000);
  const start = (dayIndex % groups) * ZONES_PER_RUN;
  return HOT_LIST_ZONES.slice(start, start + ZONES_PER_RUN);
}
export const HOT_LIST_DAILY_SIZE = 10;

export const PIPELINE_STAGES = [
  "por_visitar",
  "visitado",
  "interesado",
  "prueba_instalada",
  "cliente",
  "no_interesado",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && (PIPELINE_STAGES as readonly string[]).includes(value);
}

export interface PipelineState {
  stage: PipelineStage;
  updated_at: string;
  trial_started_at: string | null;
  history: { stage: PipelineStage; at: string }[];
}

export interface HotPlace {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  internationalPhone: string | null;
  website: string | null;
  rating: number | null;
  userRatingCount: number | null;
  mapsUrl: string | null;
}

export interface HeatScore {
  score: number;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Scoring (pure — no I/O)
// ---------------------------------------------------------------------------

const NICHE_WEIGHT: Record<string, number> = {
  licorera: 10,
  "barbería": 10,
  "clínica dental": 15,
};

export function scoreHotPlace(place: HotPlace, niche: string): HeatScore {
  let score = 0;
  const reasons: string[] = [];
  const count = place.userRatingCount ?? 0;

  if (count < 10) {
    score += 40;
    reasons.push(count === 0 ? "Sin reseñas" : `Solo ${count} reseñas`);
  } else if (count < 25) {
    score += 30;
    reasons.push(`Pocas reseñas (${count})`);
  } else if (count < 50) {
    score += 15;
    reasons.push(`${count} reseñas`);
  }

  if (place.rating === null) {
    score += 15;
    reasons.push("Sin calificación");
  } else if (place.rating < 4.0) {
    score += 35;
    reasons.push(`Calificación baja (${place.rating.toFixed(1)})`);
  } else if (place.rating < 4.3) {
    score += 25;
    reasons.push(`Calificación mejorable (${place.rating.toFixed(1)})`);
  } else if (place.rating < 4.6) {
    score += 10;
  }

  if (place.phone || place.internationalPhone) {
    score += 10;
  } else {
    reasons.push("Sin teléfono: visitar");
  }

  score += NICHE_WEIGHT[niche] ?? 5;

  return { score: Math.min(100, score), reasons };
}

/** Worth a visit at all: weak rating or thin review base. */
export function isHotCandidate(place: HotPlace): boolean {
  const count = place.userRatingCount ?? 0;
  return count < 50 || (place.rating !== null && place.rating < 4.3);
}

// ---------------------------------------------------------------------------
// Google Places
// ---------------------------------------------------------------------------

const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.businessStatus",
].join(",");

interface PlacesApiPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
}

async function searchPlaces(niche: string, zoneQuery: string, apiKey: string): Promise<HotPlace[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: `${niche} en ${zoneQuery}, Costa Rica`,
        languageCode: "es",
        regionCode: "CR",
        maxResultCount: 20,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Google Places ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { places?: PlacesApiPlace[] };
    return (data.places ?? [])
      .filter((p) => p.id && p.displayName?.text)
      .filter((p) => !p.businessStatus || p.businessStatus === "OPERATIONAL")
      .map((p) => ({
        placeId: p.id!,
        name: p.displayName!.text!,
        address: p.formattedAddress ?? null,
        phone: p.nationalPhoneNumber ?? null,
        internationalPhone: p.internationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        rating: typeof p.rating === "number" ? p.rating : null,
        userRatingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        mapsUrl: p.googleMapsUri ?? null,
      }));
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function newPipeline(now: string): PipelineState {
  return {
    stage: "por_visitar",
    updated_at: now,
    trial_started_at: null,
    history: [{ stage: "por_visitar", at: now }],
  };
}

export function getPipeline(lead: Lead): PipelineState | null {
  const p = lead.metadata?.pipeline as PipelineState | undefined;
  return p && isPipelineStage(p.stage) ? p : null;
}

export interface HotListSweepResult {
  ranAt: string;
  zones: string[];
  searched: number;
  candidates: number;
  inserted: number;
  refreshed: number;
  errors: string[];
}

/**
 * Searches every niche × today's zones, scores candidates and stores them. New places
 * become "por_visitar" leads; places already in the CRM only get their
 * rating/review numbers refreshed (their pipeline stage is never reset).
 */
export async function runHotListSweep(): Promise<HotListSweepResult> {
  const ranAt = new Date().toISOString();
  const result: HotListSweepResult = {
    ranAt,
    zones: [],
    searched: 0,
    candidates: 0,
    inserted: 0,
    refreshed: 0,
    errors: [],
  };

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    result.errors.push("GOOGLE_PLACES_API_KEY is not set");
    return result;
  }

  const zones = zonesForRun(new Date(ranAt));
  result.zones = zones.map((z) => z.name);

  const found = new Map<string, { place: HotPlace; niche: string; zone: string }>();
  for (const niche of HOT_LIST_NICHES) {
    for (const { name: zone, query } of zones) {
      if (!(await reservePlacesCall())) {
        result.errors.push(`Google Places monthly free budget reached; skipped ${niche} / ${zone}`);
        continue;
      }
      try {
        const places = await searchPlaces(niche, query, apiKey);
        result.searched += places.length;
        for (const place of places) {
          if (isHotCandidate(place) && !found.has(place.placeId)) {
            found.set(place.placeId, { place, niche, zone });
          }
        }
      } catch (err) {
        result.errors.push(`${niche} / ${zone}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  result.candidates = found.size;
  if (found.size === 0) return result;

  const placeIds = [...found.keys()];
  const { data: existing, error: existingError } = await supabase
    .from("leads")
    .select("*")
    .in("metadata->>place_id", placeIds);
  if (existingError) {
    result.errors.push(`Lookup failed: ${existingError.message}`);
    return result;
  }
  const existingByPlace = new Map<string, Lead>();
  for (const lead of (existing ?? []) as Lead[]) {
    const pid = lead.metadata?.place_id;
    if (typeof pid === "string") existingByPlace.set(pid, lead);
  }

  for (const [placeId, { place, niche, zone }] of found) {
    const heat = scoreHotPlace(place, niche);
    const freshFields = {
      place_id: placeId,
      maps_url: place.mapsUrl,
      address: place.address,
      website: place.website,
      rating: place.rating,
      user_rating_count: place.userRatingCount,
      heat_score: heat.score,
      heat_reasons: heat.reasons,
      niche,
      zone,
      industry: niche,
      location: `${zone}, Costa Rica`,
      last_seen_at: ranAt,
    };

    const prior = existingByPlace.get(placeId);
    if (prior) {
      const metadata = {
        ...prior.metadata,
        ...freshFields,
        source: prior.metadata?.source ?? "hot_list",
        pipeline: getPipeline(prior) ?? newPipeline(ranAt),
      };
      const { error } = await supabase.from("leads").update({ metadata }).eq("id", prior.id);
      if (error) result.errors.push(`Update ${place.name}: ${error.message}`);
      else result.refreshed++;
      continue;
    }

    const { error } = await supabase.from("leads").upsert(
      {
        name: place.name,
        company: place.name,
        phone: place.internationalPhone ?? place.phone,
        status: "new",
        lead_score: heat.score,
        metadata: { ...freshFields, source: "hot_list", pipeline: newPipeline(ranAt) },
      },
      { onConflict: "name,company", ignoreDuplicates: true }
    );
    if (error) result.errors.push(`Insert ${place.name}: ${error.message}`);
    else result.inserted++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reading the list
// ---------------------------------------------------------------------------

export interface HotLead {
  id: string;
  name: string;
  phone: string | null;
  niche: string;
  zone: string;
  address: string | null;
  mapsUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  heatScore: number;
  reasons: string[];
  stage: PipelineStage;
  trialStartedAt: string | null;
  trialDay: number | null;
}

export interface TrialReminder {
  lead: HotLead;
  action: "enviar_reporte" | "cerrar_venta";
}

export interface HotListView {
  zone: string | null;
  zoneCounts: Record<string, number>;
  today: HotLead[];
  reminders: TrialReminder[];
  counts: Record<PipelineStage, number>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toHotLead(lead: Lead, now: number): HotLead | null {
  const pipeline = getPipeline(lead);
  if (!pipeline) return null;
  const m = lead.metadata ?? {};
  const trialStartedAt = pipeline.trial_started_at;
  const trialDay = trialStartedAt
    ? Math.floor((now - new Date(trialStartedAt).getTime()) / DAY_MS) + 1
    : null;
  return {
    id: lead.id,
    name: lead.name ?? lead.company ?? "Sin nombre",
    phone: lead.phone,
    niche: typeof m.niche === "string" ? m.niche : "negocio",
    zone: typeof m.zone === "string" ? m.zone : "",
    address: typeof m.address === "string" ? m.address : null,
    mapsUrl: typeof m.maps_url === "string" ? m.maps_url : null,
    rating: typeof m.rating === "number" ? m.rating : null,
    reviewCount: typeof m.user_rating_count === "number" ? m.user_rating_count : null,
    heatScore: typeof m.heat_score === "number" ? m.heat_score : lead.lead_score,
    reasons: Array.isArray(m.heat_reasons) ? (m.heat_reasons as string[]) : [],
    stage: pipeline.stage,
    trialStartedAt,
    trialDay,
  };
}

export async function getHotListView(zone: string | null = null): Promise<HotListView> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .not("metadata->pipeline", "is", null)
    .limit(1000);
  if (error) throw new Error(error.message);

  const now = Date.now();
  const leads = ((data ?? []) as Lead[])
    .map((l) => toHotLead(l, now))
    .filter((l): l is HotLead => l !== null);

  const counts = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<
    PipelineStage,
    number
  >;
  for (const l of leads) counts[l.stage]++;

  const pending = leads.filter((l) => l.stage === "por_visitar");
  const zoneCounts: Record<string, number> = {};
  for (const l of pending) if (l.zone) zoneCounts[l.zone] = (zoneCounts[l.zone] ?? 0) + 1;

  const today = pending
    .filter((l) => !zone || l.zone === zone)
    .sort((a, b) => b.heatScore - a.heatScore)
    .slice(0, HOT_LIST_DAILY_SIZE);

  const reminders: TrialReminder[] = [];
  for (const l of leads) {
    if (l.stage !== "prueba_instalada" || l.trialDay === null) continue;
    if (l.trialDay >= 12) reminders.push({ lead: l, action: "cerrar_venta" });
    else if (l.trialDay >= 4) reminders.push({ lead: l, action: "enviar_reporte" });
  }

  return { zone, zoneCounts, today, reminders, counts };
}

export async function updateLeadStage(id: string, stage: PipelineStage): Promise<PipelineState> {
  const { data, error } = await supabase.from("leads").select("*").eq("id", id).single();
  if (error || !data) throw new Error(error?.message ?? "Lead not found");
  const lead = data as Lead;
  const now = new Date().toISOString();
  const prior = getPipeline(lead) ?? newPipeline(now);

  const next: PipelineState = {
    stage,
    updated_at: now,
    trial_started_at:
      stage === "prueba_instalada" && prior.stage !== "prueba_instalada"
        ? now
        : prior.trial_started_at,
    history: [...prior.history, { stage, at: now }].slice(-30),
  };

  const { error: updateError } = await supabase
    .from("leads")
    .update({ metadata: { ...lead.metadata, pipeline: next } })
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);
  return next;
}

/** One-line WhatsApp summary for Alex. Best effort; never throws. */
export async function sendHotListAlert(view: HotListView, appUrl: string | null): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const to = process.env.WHATSAPP_ALERT_TO;
  const top = view.today.slice(0, 3).map((l, i) => `${i + 1}. ${l.name} (${l.heatScore})`);
  const body = [
    `🔥 Lista de hoy: ${view.today.length} prospectos`,
    ...top,
    view.reminders.length ? `⏰ ${view.reminders.length} pruebas requieren acción` : null,
    appUrl ? `${appUrl}/hoy` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (!phoneNumberId || !accessToken || !to) {
    console.log(`[hot-list] WhatsApp not configured:\n${body}`);
    return;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
    });
    if (!res.ok) console.error(`[hot-list] WhatsApp ${res.status}: ${await res.text()}`);
  } catch (err) {
    console.error("[hot-list] WhatsApp threw:", err);
  }
}
