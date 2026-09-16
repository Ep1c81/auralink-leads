import type { Lead } from "@/lib/types";
import { cardTitle, label, meta, panel } from "@/components/outreach/theme";
import { LeadStatusBadge } from "./LeadStatusBadge";
import { LeadActions } from "./LeadActions";

const BANT_SUMMARY_MAX_LENGTH = 120;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Mobile stacking view of the pipeline list; the desktop table view is
// rendered directly in pipeline/page.tsx.
export function LeadCard({ lead }: { lead: Lead }) {
  const bantSummary = lead.metadata.bant?.summary;

  return (
    <div className={`flex flex-col gap-3 p-4 ${panel}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className={cardTitle}>{lead.name ?? lead.company ?? "Unnamed"}</h3>
          {lead.name && lead.company && (
            <p className={meta}>{lead.company}</p>
          )}
        </div>
        <LeadStatusBadge status={lead.status} />
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1.5">
        <div>
          <dt className={`${label} inline`}>Phone </dt>
          <dd className="inline text-sm font-medium text-slate-200">{lead.phone ?? "—"}</dd>
        </div>
        <div>
          <dt className={`${label} inline`}>Score </dt>
          <dd className="inline text-sm font-medium text-slate-200">{lead.lead_score}</dd>
        </div>
      </dl>
      <p className="text-sm text-slate-300">
        {bantSummary ? truncate(bantSummary, BANT_SUMMARY_MAX_LENGTH) : "—"}
      </p>
      <p className={meta}>Created {new Date(lead.created_at).toLocaleDateString()}</p>
      <LeadActions lead={lead} />
    </div>
  );
}
