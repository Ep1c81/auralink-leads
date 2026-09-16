import type { LeadStatus } from "@/lib/types";

// Same color language as outreach/StatusBadge.tsx, for the `leads` table's
// own status enum. Status is always conveyed by this text label, never by
// color alone.
const LEAD_STATUS_STYLES: Record<LeadStatus, string> = {
  new: "bg-slate-500/15 text-slate-300 ring-slate-400/30",
  qualified: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  unqualified: "bg-red-500/15 text-red-300 ring-red-400/30",
  needs_more_info: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
};

const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  qualified: "Qualified",
  unqualified: "Unqualified",
  needs_more_info: "Needs Info",
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${LEAD_STATUS_STYLES[status]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}
