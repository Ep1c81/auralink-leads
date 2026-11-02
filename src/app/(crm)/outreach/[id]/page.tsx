import { pageNumber } from "@/lib/pagination";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign, listMessagesForCampaign } from "@/lib/outreachCampaigns";
import { CampaignMessages } from "@/components/outreach/CampaignMessages";
import { EmptyState } from "@/components/outreach/EmptyState";
import { StatusBadge } from "@/components/outreach/StatusBadge";
import { pageTitle, subtleLink } from "@/components/outreach/theme";

/**
 * Server Component: fetches the campaign + its messages directly from the
 * data layer. notFound() triggers not-found.tsx for a real 404 instead of a
 * manually-rendered error message. Selection + review-panel interactivity
 * lives in CampaignMessages (Client Component), seeded with this data.
 */
export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ openMessage?: string; page?: string }>;
}) {
  const { id } = await params;
  const { openMessage, page: rawPage } = await searchParams;

  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const page=pageNumber(rawPage);
  const messages = await listMessagesForCampaign(id,page);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 lg:py-14">
      <Link href="/outreach" className={`w-fit ${subtleLink}`}>
        ← All campaigns
      </Link>

      <div className="flex items-center gap-3">
        <h1 className={pageTitle}>{campaign.name}</h1>
        <StatusBadge kind="campaign" status={campaign.status} />
      </div>

      <nav className="flex gap-4" aria-label="Paginación de mensajes">{page>0&&<Link href={`/outreach/${id}?page=${page-1}`}>Anterior</Link>}<span>Página {page+1}</span>{messages.length===50&&<Link href={`/outreach/${id}?page=${page+1}`}>Siguiente</Link>}</nav>
      {messages.length === 0 ? (
        <EmptyState
          title="No messages yet"
          description="Generate a draft from a qualified lead on the main dashboard to add it to this campaign."
        />
      ) : (
        <CampaignMessages initialMessages={messages} initialOpenId={openMessage ?? null} />
      )}
    </div>
  );
}
