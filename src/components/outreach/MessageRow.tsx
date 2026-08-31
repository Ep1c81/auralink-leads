import type { OutreachMessageWithLead } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

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
    <tr className={selected ? "bg-zinc-50 dark:bg-zinc-900" : undefined}>
      <th scope="row" className="px-3 py-2.5 text-left font-normal">
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className="rounded text-sm font-medium text-zinc-900 underline decoration-dotted underline-offset-2 hover:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-50 dark:hover:text-zinc-300 dark:focus-visible:outline-zinc-100"
        >
          {leadLabel}
        </button>
      </th>
      <td className="max-w-xs truncate px-3 py-2.5 text-sm text-zinc-600 dark:text-zinc-400">
        {message.subject ?? "—"}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge kind="message" status={message.status} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
        {message.sent_at ? new Date(message.sent_at).toLocaleString() : "—"}
      </td>
    </tr>
  );
}
