import { NextResponse } from "next/server";
import { getHotListView } from "@/lib/hotList";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getHotListView());
  } catch (err) {
    console.error("[hot-list] view failed:", err);
    return NextResponse.json({ error: "No se pudo cargar la lista" }, { status: 500 });
  }
}
