import { listCampaigns } from "@/lib/outreachCampaigns";
import { CampaignCard } from "@/components/outreach/CampaignCard";
import { CampaignTable } from "@/components/outreach/CampaignTable";
import { CreateCampaignFlow } from "@/components/outreach/CreateCampaignFlow";
import { DraftLeadPanel } from "@/components/outreach/DraftLeadPanel";
import { EmptyState } from "@/components/outreach/EmptyState";
import { body, eyebrow, pageTitle } from "@/components/outreach/theme";

/**
 * Server Component: fetches campaigns directly from the data layer (same
 * lib/outreachCampaigns.ts the API routes use) rather than round-tripping
 * through fetch() to its own route. Interactivity (the new-campaign form,
 * the draft-a-lead panel) is layered in via small Client Components below.
 */
export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{ draftLead?: string; draftLeadName?: string }>;
}) {
  const { draftLead, draftLeadName } = await searchParams;
  const campaigns = await listCampaigns();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 lg:py-14">
      <header>
        <p className={eyebrow}>AuraLink Digital · Outreach</p>
        <h1 className={pageTitle}>Campaigns</h1>
        <p className={`mt-1.5 ${body}`}>
          Review Gemini-drafted emails for your qualified leads before they go out.
        </p>
      </header>

      {draftLead && (
        <DraftLeadPanel
          leadId={draftLead}
          leadName={draftLeadName ?? "this lead"}
          campaigns={campaigns}
        />
      )}

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Create a campaign to start drafting and reviewing outreach emails for your qualified leads."
        >
          <CreateCampaignFlow variant="empty" />
        </EmptyState>
      ) : (
        <>
          <CreateCampaignFlow variant="header" />
          <div className="flex flex-col gap-3 md:hidden">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>
          <div className="hidden md:block">
            <CampaignTable campaigns={campaigns} />
          </div>
        </>
      )}
    </div>
  );
}
