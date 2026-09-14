import { NextResponse } from "next/server";
import { getSupabase, resolveSupabaseEnv } from "@/lib/supabase";
import { describeFetchCause } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

// This table (~1,061 rows after the 2026-09-14 dedupe/purge) is the Auralink
// Digital CRM Pipeline — a separate dataset from `leads`/`/api/leads`, which
// backs the unrelated BANT-qualification/outreach pipeline on the root page.
// See supabase/migrations/20260914041357_dedupe_and_purge_bizmap_leads.sql.
//
// PostgREST enforces its own `db-max-rows` cap (1000 by default) on top of
// whatever `.limit()` asks for — a single request silently truncates past
// that, so this pages with `.range()` until a page comes back short.
const PAGE_SIZE = 1000;
const RESULT_CAP = 20000;

export async function GET() {
  const env = resolveSupabaseEnv();
  if (env.problems.length > 0) {
    console.error("[/api/bizmap-leads] Supabase misconfigured:", env.problems);
    return NextResponse.json(
      { error: "Supabase is not configured", problems: env.problems },
      { status: 500 }
    );
  }

  try {
    const client = getSupabase();
    const leads: Record<string, unknown>[] = [];

    while (leads.length < RESULT_CAP) {
      const from = leads.length;
      const { data, error } = await client
        .from("bizmap_leads")
        .select("*")
        .order("lead_score", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }) // tiebreaker: keeps .range() pagination stable across ties
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error("[/api/bizmap-leads] Supabase query error:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        return NextResponse.json(
          { error: "Failed to load leads", code: error.code, details: error.message },
          { status: 500 }
        );
      }

      leads.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    return NextResponse.json({ leads });
  } catch (error) {
    const cause = describeFetchCause(error);
    console.error("[/api/bizmap-leads] Network failure reaching Supabase:", {
      supabaseUrl: env.url,
      keySource: env.keyName,
      ...cause,
    });
    return NextResponse.json(
      { error: "Could not reach Supabase", details: cause },
      { status: 500 }
    );
  }
}
