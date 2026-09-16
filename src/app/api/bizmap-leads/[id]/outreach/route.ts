import { NextResponse } from "next/server";
import { getSupabase, resolveSupabaseEnv } from "@/lib/supabase";
import { describeFetchCause } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

/**
 * Marks a bizmap_leads row as contacted. Called when a rep clicks the
 * dashboard's click-to-WhatsApp action, so "Outreached Leads" and the
 * "Follow-up Needed" filter reflect real activity instead of being
 * decorative.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const env = resolveSupabaseEnv();
  if (env.problems.length > 0) {
    console.error("[/api/bizmap-leads/outreach] Supabase misconfigured:", env.problems);
    return NextResponse.json(
      { error: "Supabase is not configured", problems: env.problems },
      { status: 500 }
    );
  }

  const { id } = await params;

  try {
    const { data, error } = await getSupabase()
      .from("bizmap_leads")
      .update({ outreached_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[/api/bizmap-leads/outreach] Supabase update error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      const status = error.code === "PGRST116" ? 404 : 500;
      return NextResponse.json(
        {
          error: status === 404 ? "Lead not found" : "Failed to mark lead as outreached",
          details: error.message,
        },
        { status }
      );
    }

    return NextResponse.json({ lead: data });
  } catch (error) {
    const cause = describeFetchCause(error);
    console.error("[/api/bizmap-leads/outreach] Network failure reaching Supabase:", {
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
