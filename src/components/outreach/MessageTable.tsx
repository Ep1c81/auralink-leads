import type { OutreachMessageWithLead } from "@/lib/types";
import { MessageRow } from "./MessageRow";
import { label, panel } from "./theme";

// Presentational only. Semantic <table> with scoped headers wrapping
// MessageRow; selection state and callbacks are owned by CampaignMessages.
export function MessageTable({
  messages,
  selectedId,
  onSelect,
}: {
  messages: OutreachMessageWithLead[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={`min-w-0 flex-1 overflow-x-auto ${panel}`}>
      <table className="w-full text-left">
        <thead className="border-b border-white/10">
          <tr>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Lead
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Subject
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Status
            </th>
            <th scope="col" className={`px-4 py-3 ${label}`}>
              Sent
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              selected={m.id === selectedId}
              onSelect={() => onSelect(m.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
