import { NextResponse } from "next/server";
import { getSupabase, resolveSupabaseEnv } from "@/lib/supabase";
import { describeFetchCause } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

export async function GET() {
  // Validate configuration before touching the network, so a missing or
  // malformed variable reports itself by name instead of surfacing as a
  // generic `TypeError: fetch failed`.
  const env = resolveSupabaseEnv();
  if (env.problems.length > 0) {
    console.error("[/api/leads] Supabase misconfigured:", env.problems);
    return NextResponse.json(
      {
        error: "Supabase is not configured",
        problems: env.problems,
      },
      { status: 500 }
    );
  }

  try {
    const { data, error } = await getSupabase()
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      // A PostgREST-level error: the connection worked, the query did not.
      console.error("[/api/leads] Supabase query error:", {
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

    return NextResponse.json({ leads: data ?? [] });
  } catch (error) {
    // A transport-level failure: DNS, TLS, or an unreachable host. This is the
    // branch that produces `TypeError: fetch failed`.
    const cause = describeFetchCause(error);
    console.error("[/api/leads] Network failure reaching Supabase:", {
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
