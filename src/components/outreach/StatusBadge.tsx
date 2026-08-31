import type { CampaignStatus, OutreachMessageStatus } from "@/lib/types";

// Single source of truth for every outreach status color + label. Status is
// always conveyed by this text label, never by color alone.
const MESSAGE_STATUS_STYLES: Record<OutreachMessageStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  queued: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  sent: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  bounced: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

const MESSAGE_STATUS_LABELS: Record<OutreachMessageStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
  bounced: "Bounced",
};

const CAMPAIGN_STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  completed: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
};

const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};

type StatusBadgeProps =
  | { kind: "message"; status: OutreachMessageStatus }
  | { kind: "campaign"; status: CampaignStatus };

export function StatusBadge(props: StatusBadgeProps) {
  const style =
    props.kind === "message"
      ? MESSAGE_STATUS_STYLES[props.status]
      : CAMPAIGN_STATUS_STYLES[props.status];
  const label =
    props.kind === "message"
      ? MESSAGE_STATUS_LABELS[props.status]
      : CAMPAIGN_STATUS_LABELS[props.status];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}
