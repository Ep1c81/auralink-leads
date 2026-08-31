import Link from "next/link";
import type { OutreachCampaignWithCounts } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

export function CampaignCard({ campaign }: { campaign: OutreachCampaignWithCounts }) {
  return (
    <Link
      href={`/outreach/${campaign.id}`}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 transition-colors hover:border-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-600 dark:focus-visible:outline-zinc-100"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{campaign.name}</h3>
        <StatusBadge kind="campaign" status={campaign.status} />
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <div>
          <dt className="inline">Messages: </dt>
          <dd className="inline font-medium text-zinc-700 dark:text-zinc-300">
            {campaign.message_count}
          </dd>
        </div>
        <div>
          <dt className="inline">Sent: </dt>
          <dd className="inline font-medium text-zinc-700 dark:text-zinc-300">
            {campaign.sent_count}
          </dd>
        </div>
        <div>
          <dt className="inline">Replies: </dt>
          <dd className="inline font-medium text-zinc-700 dark:text-zinc-300">
            {campaign.reply_count}
          </dd>
        </div>
      </dl>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-600">
        Created {new Date(campaign.created_at).toLocaleDateString()}
      </p>
    </Link>
  );
}
