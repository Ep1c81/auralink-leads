import { NextResponse } from "next/server";
import { isPipelineStage, updateLeadStage } from "@/lib/hotList";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let stage: unknown;
  try {
    stage = ((await request.json()) as { stage?: unknown }).stage;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isPipelineStage(stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  try {
    const pipeline = await updateLeadStage(id, stage);
    return NextResponse.json({ pipeline });
  } catch (err) {
    console.error(`[hot-list] stage update failed for ${id}:`, err);
    return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
  }
}
