import { NextResponse } from "next/server";
import { getSupabase, resolveSupabaseEnv } from "@/lib/supabase";
import { phone as crMobile } from "@/lib/acquisition.mjs";

const WHATSAPP_CONSENT_TEXT = "Autorizo a BizMapShield a contactarme por WhatsApp sobre mi prueba gratis de 14 días, con información y ofertas de sus servicios. Puedo darme de baja en cualquier momento respondiendo SALIR.";

export const runtime = "nodejs";

const MAX_BYTES = 4096;
const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  const expected = process.env.SHIELDY_INGEST_SECRET;
  const provided = request.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    input = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid payload");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot: browsers should leave this field blank.
  if (clean(input.website_url, 100)) return NextResponse.json({ ok: true });

  const name = clean(input.name, 80);
  const company = clean(input.business, 100);
  const zone = clean(input.zone, 80);
  const type = clean(input.business_type, 80);
  const plan = clean(input.plan, 40);
  const phone = clean(input.phone, 30);
  if (input.consent !== true || !name || !company || !zone || !type) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (phone && !/^\+?[\d\s()-]{7,30}$/.test(phone)) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }
  if (resolveSupabaseEnv().problems.length) {
    return NextResponse.json({ error: "CRM database unavailable" }, { status: 503 });
  }
  try {
    const db = getSupabase();
    const metadata = { source: "shieldy", product: "BizMapShield", zone, business_type: type, interested_plan: plan || "No estoy seguro", consent_to_contact: input.consent === true };
    // The existing unique (name, company) index makes retries safe.
    const { data, error } = await db.from("leads")
      .upsert({ name, company, phone: phone || null, status: "new", metadata }, { onConflict: "name,company", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[shieldy-lead] database insert failed:", error.code);
      return NextResponse.json({ error: "Could not save lead" }, { status: 500 });
    }
    // A duplicate submission may not return a row from the upsert. Resolve its
    // existing UUID so both pipelines share a stable identity across retries.
    let leadId: string | undefined = data?.id;
    if (!leadId) {
      const { data: existing, error: lookupError } = await db.from("leads")
        .select("id").eq("name", name).eq("company", company).maybeSingle();
      if (lookupError || !existing?.id) {
        console.error("[shieldy-lead] unable to resolve existing lead", lookupError?.code);
        return NextResponse.json({ error: "Could not sync lead" }, { status: 500 });
      }
      leadId = existing.id;
    }

    // The commercial CRM reads bizmap_leads, not leads. Mirror with the same
    // UUID; never overwrite a salesperson's existing status or notes.
    // Leave outreach_status null so a new Shieldy inquiry cannot enter
    // automated outbound campaigns before manual review.
    const { error: pipelineError } = await db.from("bizmap_leads").upsert({
      id: leadId,
      business_name: company,
      business_type: type,
      address: zone,
      phone_number: phone || null,
      source: "shieldy",
      status: "New",
      outreach_status: null,
      ai_notes: `SHIELDY - REVISIÓN MANUAL. Contacto: ${name}. Plan: ${plan || "Sin definir"}. Consentimiento registrado.`,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (pipelineError) {
      console.error("[shieldy-lead] pipeline sync failed:", pipelineError.code);
      return NextResponse.json({ error: "Could not sync lead" }, { status: 500 });
    }
    // Self-service trial funnel: an explicit WhatsApp consent records the merchant in the
    // acquisition pipeline (dedupe by phone, customers and blocked numbers excluded).
    let trial: string = "not_requested";
    const waPhone = crMobile(phone);
    if (input.consent_whatsapp === true && waPhone) {
      const evidence = `Shieldy ${new Date().toISOString()} · consent_whatsapp=true · "${WHATSAPP_CONSENT_TEXT}"`;
      const { data: status, error: regError } = await db.rpc("acq_register", {
        p_phone: waPhone, p_lead_id: leadId, p_business: company, p_name: name, p_evidence: evidence,
      });
      if (regError) {
        console.error("[shieldy-lead] trial registration failed:", regError.code);
        trial = "error";
      } else trial = String(status);
    } else if (input.consent_whatsapp === true) trial = "invalid_phone";
    return NextResponse.json({ ok: true, created: Boolean(data), crm_synced: true, trial }, { status: 200 });
  } catch (error) {
    console.error("[shieldy-lead] unexpected error", error);
    return NextResponse.json({ error: "Could not save lead" }, { status: 500 });
  }
}
