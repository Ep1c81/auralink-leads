import type { OutreachMessageWithLead } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { focusRing } from "./theme";

// Presentational only — no data fetching. onSelect is a plain callback prop;
// this file has no "use client" of its own because it's always rendered from
// within an already-client component (CampaignMessages), which sweeps it into
// the client bundle automatically.
export function MessageRow({
  message,
  selected,
  onSelect,
}: {
  message: OutreachMessageWithLead;
  selected: boolean;
  onSelect: () => void;
}) {
  const leadLabel = message.lead?.name ?? message.lead?.company ?? "Unknown lead";

  return (
    <tr className={`transition-colors ${selected ? "bg-violet-500/10" : "hover:bg-white/5"}`}>
      <th scope="row" className="px-4 py-3 text-left font-normal">
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className={`${focusRing} rounded text-sm font-medium text-slate-100 underline decoration-slate-600 decoration-dotted underline-offset-4 transition-colors hover:text-violet-300 hover:decoration-violet-400`}
        >
          {leadLabel}
        </button>
      </th>
      <td className="max-w-xs truncate px-4 py-3 text-sm text-slate-400">
        {message.subject ?? "—"}
      </td>
      <td className="px-4 py-3">
        <StatusBadge kind="message" status={message.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
        {message.sent_at ? new Date(message.sent_at).toLocaleString() : "—"}
      </td>
    </tr>
  );
}
