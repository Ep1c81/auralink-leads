import { NextResponse } from "next/server";
import { getSupabase, resolveSupabaseEnv } from "@/lib/supabase";

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
    // The existing unique (name, company) index makes retries safe.
    const { data, error } = await db.from("leads")
      .upsert({ name, company, phone: phone || null, status: "new", metadata }, { onConflict: "name,company", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[shieldy-lead] database insert failed:", error.code);
      return NextResponse.json({ error: "Could not save lead" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, created: Boolean(data) }, { status: 200 });
  } catch (error) {
    console.error("[shieldy-lead] unexpected error", error);
    return NextResponse.json({ error: "Could not save lead" }, { status: 500 });
  }
}
