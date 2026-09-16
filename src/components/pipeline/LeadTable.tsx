import type { Lead } from "@/lib/types";
import { label, panel } from "@/components/outreach/theme";
import { LeadStatusBadge } from "./LeadStatusBadge";
import { LeadActions } from "./LeadActions";

const BANT_SUMMARY_MAX_LENGTH = 120;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Desktop table view of the pipeline list; LeadCard covers the mobile
// stacking view. Semantic <table> with scoped headers, mirroring
// outreach/CampaignTable.tsx.
export function LeadTable({ leads }: { leads: Lead[] }) {
  return (
    <div className={`overflow-x-auto ${panel}`}>
      <table className="w-full text-left">
        <thead className="border-b border-white/10">
          <tr>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Name / Company
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Phone
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Status
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Score
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              BANT Summary
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Created
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {leads.map((lead) => {
            const bantSummary = lead.metadata.bant?.summary;
            return (
              <tr key={lead.id} className="transition-colors hover:bg-white/5">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <p className="text-sm font-medium text-white">
                    {lead.name ?? lead.company ?? "Unnamed"}
                  </p>
                  {lead.name && lead.company && (
                    <p className="text-xs text-slate-500">{lead.company}</p>
                  )}
                </th>
                <td className="px-4 py-3 text-sm text-slate-300">{lead.phone ?? "—"}</td>
                <td className="px-4 py-3">
                  <LeadStatusBadge status={lead.status} />
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">{lead.lead_score}</td>
                <td className="max-w-xs px-4 py-3 text-sm text-slate-300">
                  {bantSummary ? truncate(bantSummary, BANT_SUMMARY_MAX_LENGTH) : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {new Date(lead.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <LeadActions lead={lead} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
