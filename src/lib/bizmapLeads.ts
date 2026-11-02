import "server-only";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Acceso a datos del CRM de oportunidades (bizmap_leads). Solo se llama
 * desde handlers que ya autorizaron al operador.
 */

export const PIPELINE_STAGES = ["nuevo", "contactado", "respondio", "seguimiento", "ganado", "perdido"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const LIST_COLUMNS =
  "id, business_name, business_type, address, phone_number, wa_phone, website, lead_score, score_method, outreach_status, pipeline_stage, next_action, next_action_at, has_replied, outreached_at, last_contacted_at, automation_consent, created_at";

export const DETAIL_COLUMNS = `${LIST_COLUMNS}, source, source_provider, source_object_type, source_object_id, latitude, longitude, raw_address, discovered_at, score_reason, ai_notes, notes, lost_reason, won_at, lost_at, last_reply_at, consent_evidence, consent_recorded_at, consent_recorded_by, alt_contact, retry_method, retry_date, needs_website`;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
  q: z.string().trim().max(80).optional(),
  zone: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  stage: z.enum(PIPELINE_STAGES).optional(),
  action: z.enum(["contactable", "sin_web", "seguimiento", "elegible", "respondieron"]).optional(),
  sort: z.enum(["score", "recent", "next_action"]).default("score"),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** Escapa comodines y separadores de PostgREST en búsquedas ilike. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()*]/g, " ");
}

export async function listBizmapLeads(q: ListQuery) {
  const db = getSupabaseAdmin();
  let query = db.from("bizmap_leads").select(LIST_COLUMNS, { count: "exact" });

  if (q.q) query = query.ilike("business_name", `%${escapeIlike(q.q)}%`);
  if (q.zone) query = query.eq("address", q.zone);
  if (q.category) query = query.eq("business_type", q.category);
  if (q.stage === "nuevo") query = query.or("pipeline_stage.is.null,pipeline_stage.eq.nuevo");
  else if (q.stage) query = query.eq("pipeline_stage", q.stage);

  switch (q.action) {
    case "contactable":
      query = query.not("wa_phone", "is", null);
      break;
    case "sin_web":
      query = query.eq("website", "N/A");
      break;
    case "seguimiento":
      query = query
        .lte("next_action_at", new Date().toISOString())
        .or("pipeline_stage.is.null,pipeline_stage.not.in.(ganado,perdido)");
      break;
    case "elegible":
      query = query.not("automation_consent", "is", null);
      break;
    case "respondieron":
      query = query.eq("has_replied", true);
      break;
  }

  if (q.sort === "recent") query = query.order("created_at", { ascending: false });
  else if (q.sort === "next_action") query = query.order("next_action_at", { ascending: true, nullsFirst: false });
  else query = query.order("lead_score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  query = query.order("id", { ascending: true });

  const from = (q.page - 1) * q.pageSize;
  const { data, error, count } = await query.range(from, from + q.pageSize - 1);
  if (error) throw error;
  return { leads: data ?? [], total: count ?? 0, page: q.page, pageSize: q.pageSize };
}

/** Explica por qué un prospecto puede o no entrar a envíos automáticos. */
export function automationEligibility(lead: {
  wa_phone: string | null;
  automation_consent: string | null;
  has_replied: boolean;
  outreach_status: string | null;
  suppressed: boolean;
}): { eligible: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!lead.wa_phone || !/^506[5-8]\d{7}$/.test(lead.wa_phone)) missing.push("Número móvil de Costa Rica válido");
  if (!lead.automation_consent) missing.push("Permiso registrado para mensajes automáticos");
  if (lead.suppressed) missing.push("El contacto pidió no recibir mensajes");
  if (lead.has_replied) missing.push("Ya respondió: continúe la conversación manualmente");
  if (lead.outreach_status !== "Queued" && lead.outreach_status !== "Pitch Sent") {
    missing.push("No está en la secuencia de mensajes");
  }
  return { eligible: missing.length === 0, missing };
}

export const updateSchema = z
  .object({
    pipeline_stage: z.enum(PIPELINE_STAGES).optional(),
    next_action: z.string().trim().max(200).nullable().optional(),
    next_action_at: z.string().datetime({ offset: true }).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    lost_reason: z.string().trim().max(300).nullable().optional(),
    reply_text: z.string().trim().max(2000).optional(),
    consent: z
      .object({
        basis: z.enum(["opt_in", "inbound_request", "existing_customer"]),
        evidence: z.string().trim().min(5).max(500),
      })
      .optional(),
    revoke_consent: z.boolean().optional(),
    opt_out: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Sin cambios" });
export type LeadUpdate = z.infer<typeof updateSchema>;
