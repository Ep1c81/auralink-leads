import Link from "next/link";
import type { OutreachCampaignWithCounts } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { cardTitle, label, meta, panelInteractive } from "./theme";

// Presentational only — no data fetching. Used for the mobile stacking view
// of the campaign list; CampaignTable covers the desktop table view.
export function CampaignCard({ campaign }: { campaign: OutreachCampaignWithCounts }) {
  return (
    <Link
      href={`/outreach/${campaign.id}`}
      className={`flex flex-col gap-3 p-4 ${panelInteractive}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className={cardTitle}>{campaign.name}</h3>
        <StatusBadge kind="campaign" status={campaign.status} />
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1.5">
        <div>
          <dt className={`${label} inline`}>Messages </dt>
          <dd className="inline text-sm font-medium text-slate-200">
            {campaign.message_count}
          </dd>
        </div>
        <div>
          <dt className={`${label} inline`}>Sent </dt>
          <dd className="inline text-sm font-medium text-slate-200">{campaign.sent_count}</dd>
        </div>
        <div>
          <dt className={`${label} inline`}>Replies </dt>
          <dd className="inline text-sm font-medium text-slate-200">{campaign.reply_count}</dd>
        </div>
      </dl>
      <p className={meta}>Created {new Date(campaign.created_at).toLocaleDateString()}</p>
    </Link>
  );
}
