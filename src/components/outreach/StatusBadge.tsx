import type { CampaignStatus, OutreachMessageStatus } from "@/lib/types";

// Single source of truth for every outreach status color + label. Status is
// always conveyed by this text label, never by color alone. Text shades are
// deliberately light (300) against low-opacity fills so contrast stays high
// against the module's dark canvas regardless of which panel a badge sits on.
const MESSAGE_STATUS_STYLES: Record<OutreachMessageStatus, string> = {
  draft: "bg-slate-500/15 text-slate-300 ring-slate-400/30",
  queued: "bg-sky-500/15 text-sky-300 ring-sky-400/30",
  sent: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  failed: "bg-red-500/15 text-red-300 ring-red-400/30",
  bounced: "bg-orange-500/15 text-orange-300 ring-orange-400/30",
};

const MESSAGE_STATUS_LABELS: Record<OutreachMessageStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
  bounced: "Bounced",
};

const CAMPAIGN_STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-slate-500/15 text-slate-300 ring-slate-400/30",
  active: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  paused: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  completed: "bg-violet-500/15 text-violet-300 ring-violet-400/30",
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
  const text =
    props.kind === "message"
      ? MESSAGE_STATUS_LABELS[props.status]
      : CAMPAIGN_STATUS_LABELS[props.status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}
