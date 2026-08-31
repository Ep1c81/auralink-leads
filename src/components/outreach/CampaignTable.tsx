import Link from "next/link";
import type { OutreachCampaignWithCounts } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { label, link, panel } from "./theme";

// Presentational only — desktop table view of the campaign list. Semantic
// <table> with scoped headers; the mobile view is CampaignCard.
export function CampaignTable({ campaigns }: { campaigns: OutreachCampaignWithCounts[] }) {
  return (
    <div className={`overflow-x-auto ${panel}`}>
      <table className="w-full text-left">
        <thead className="border-b border-white/10">
          <tr>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Campaign
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Status
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Messages
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Sent
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Replies
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {campaigns.map((c) => (
            <tr key={c.id} className="transition-colors hover:bg-white/5">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <Link href={`/outreach/${c.id}`} className={link}>
                  {c.name}
                </Link>
              </th>
              <td className="px-4 py-3">
                <StatusBadge kind="campaign" status={c.status} />
              </td>
              <td className="px-4 py-3 text-sm text-slate-300">{c.message_count}</td>
              <td className="px-4 py-3 text-sm text-slate-300">{c.sent_count}</td>
              <td className="px-4 py-3 text-sm text-slate-300">{c.reply_count}</td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {new Date(c.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
