import { withMachine } from '@/lib/security/auth';
import { readBody } from '@/lib/security/policy';
import { NextResponse } from "next/server";
import { getSupabase, resolveSupabaseEnv } from "@/lib/supabase";

export const runtime = "nodejs";

const MAX_BYTES = 4096;
const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

async function guardedPOST(request: Request) {
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
    const raw = Buffer.from(await readBody(request, MAX_BYTES)).toString();
    if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    input = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid payload");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  for (const [key,max] of Object.entries({name:80,business:100,zone:80,business_type:80,plan:40,phone:30,website_url:100})) {
    if(input[key]!==undefined && (typeof input[key]!=='string' || (input[key] as string).length>max))return NextResponse.json({error:'Datos inválidos.'},{status:400});
  }
  if(input.consent!==undefined && typeof input.consent!=='boolean')return NextResponse.json({error:'Consentimiento inválido.'},{status:400});
  // Honeypot: browsers should leave this field blank.
  if (clean(input.website_url, 100)) return NextResponse.json({ ok: true });

  const name = clean(input.name, 80);
  const company = clean(input.business, 100);
  const zone = clean(input.zone, 80);
  const type = clean(input.business_type, 80);
  const plan = clean(input.plan, 40);
  const phone = clean(input.phone, 30);
  if (!name || !company || !zone || !type) {
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
    const eventId = request.headers.get('idempotency-key');
    if (!eventId || !/^[a-zA-Z0-9_-]{8,128}$/.test(eventId)) return NextResponse.json({error:'Falta el identificador del evento.'},{status:400});
    const { data, error } = await db.from("leads")
      .upsert({ source_key: `shieldy:${eventId}`, name, company, phone: phone || null, status: "new", metadata }, { onConflict: "source_key", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("route.ts: operación registrada");
      return NextResponse.json({ error: "Could not save lead" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, created: Boolean(data) }, { status: 200 });
  } catch {
    console.error("route.ts: operación registrada");
    return NextResponse.json({ error: "Could not save lead" }, { status: 500 });
  }
}

export const POST = withMachine(guardedPOST,"SHIELDY_INGEST_SECRET","authorization","Bearer ");
