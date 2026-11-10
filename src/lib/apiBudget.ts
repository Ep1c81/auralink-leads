import { supabase } from "@/lib/supabase";

/**
 * Google Places "Text Search Enterprise" (any request asking for rating,
 * userRatingCount, phone or website) includes 1,000 free calls per month.
 * We cap at 900 so a few calls of month-boundary or timezone skew can never
 * reach the paid tier. Override with GOOGLE_PLACES_MONTHLY_LIMIT, which is
 * clamped to this ceiling so a typo can't open up billing.
 */
const PLACES_FREE_CEILING = 900;

function placesMonthlyLimit(): number {
  const raw = Number(process.env.GOOGLE_PLACES_MONTHLY_LIMIT);
  return Number.isFinite(raw) && raw > 0
    ? Math.min(Math.floor(raw), PLACES_FREE_CEILING)
    : PLACES_FREE_CEILING;
}

/**
 * Reserves one Google Places Text Search call against this month's budget.
 * Returns false when the budget is spent OR the budget can't be checked —
 * it fails closed, so a database problem never turns into a Google bill.
 */
export async function reservePlacesCall(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("reserve_api_calls", {
      p_api: "google_places_text_search",
      p_calls: 1,
      p_monthly_limit: placesMonthlyLimit(),
    });
    if (error) {
      console.error("[api-budget] reserve failed, skipping Google call:", error.message);
      return false;
    }
    if (data !== true) {
      console.warn("[api-budget] Google Places monthly budget reached, skipping call");
      return false;
    }
    return true;
  } catch (err) {
    console.error("[api-budget] reserve threw, skipping Google call:", err);
    return false;
  }
}
