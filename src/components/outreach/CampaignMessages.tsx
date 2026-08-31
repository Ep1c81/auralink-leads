"use client";

import { useState } from "react";
import type { OutreachMessageWithLead } from "@/lib/types";
import { MessageTable } from "./MessageTable";
import { MessageReviewPanel } from "./MessageReviewPanel";

/**
 * Owns selection + the locally-editable copy of a campaign's messages.
 * Seeded from the Server Component's initial fetch; PATCH/queue mutations
 * go through the existing API routes and update this local state directly
 * for snappy feedback (the campaign detail page's own data is re-fetched
 * fresh on the next full navigation regardless).
 */
export function CampaignMessages({
  initialMessages,
  initialOpenId,
}: {
  initialMessages: OutreachMessageWithLead[];
  initialOpenId: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [selectedId, setSelectedId] = useState<string | null>(initialOpenId);

  const selectedMessage = messages.find((m) => m.id === selectedId) ?? null;

  function handleUpdated(updated: OutreachMessageWithLead) {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
  }

  return (
    <div className="flex flex-1 items-start gap-0 md:gap-6">
      <MessageTable messages={messages} selectedId={selectedId} onSelect={setSelectedId} />
      {selectedMessage && (
        <MessageReviewPanel
          key={selectedMessage.id}
          message={selectedMessage}
          onClose={() => setSelectedId(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}
