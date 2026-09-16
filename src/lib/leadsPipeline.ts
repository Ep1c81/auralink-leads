import { supabase } from "@/lib/supabase";
import type { Lead } from "@/lib/types";

/**
 * Lists `leads` table rows (the qualification/outreach engine's pipeline),
 * range-paginated like /api/leads does for bizmap_leads. Throws on a
 * Supabase error so the page's error boundary handles it — this is a Server
 * Component data source, not an API route.
 */
export async function listPipelineLeads(
  page: number,
  pageSize = 50
): Promise<{ leads: Lead[]; count: number }> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("leads")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error(`Failed to list pipeline leads: ${error.message}`);
  }

  return { leads: (data ?? []) as Lead[], count: count ?? 0 };
}
