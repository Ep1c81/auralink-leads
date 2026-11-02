import { pageNumber } from "@/lib/pagination";
import { withOperator } from '@/lib/security/auth';
import { NextResponse } from "next/server";
import { getCampaign, listMessagesForCampaign } from "@/lib/outreachCampaigns";

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  try {
    const messages = await listMessagesForCampaign(id,pageNumber(new URL(request.url).searchParams.get("page")));
    return NextResponse.json({ campaign, messages });
  } catch {
    console.error("route.ts: operación registrada");
    return NextResponse.json({ error: "Failed to load campaign" }, { status: 502 });
  }
}

export const GET = withOperator(handleGET);
