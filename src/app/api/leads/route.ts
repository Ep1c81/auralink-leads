import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Initialize server-side Supabase client using environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://paggxsvqosfduuqlgydl.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_HdrCoyome63dHoq-_Q_khw_reIHm...";
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "0", 10);
    const pageSize = 750; // Server-side chunk size of 750 records

    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabase
      .from("bizmap_leads")
      .select("id, business_name, business_type, phone, email, address, rating", { count: "exact" })
      .range(from, to);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data || [],
      count: count || 0,
      page,
      pageSize,
    });
  } catch (err: any) {
    console.error("API error fetching leads:", err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
