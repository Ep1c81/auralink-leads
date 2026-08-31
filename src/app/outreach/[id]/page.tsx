"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import type { OutreachCampaign, OutreachMessageWithLead } from "@/lib/types";
import { MessageRow } from "@/components/outreach/MessageRow";
import { StatusBadge } from "@/components/outreach/StatusBadge";

function CampaignDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-6 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-8 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-64 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
    </div>
  );
}

function MessagesEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">No messages yet</p>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Generate a draft from a qualified lead on the main dashboard to add it to this campaign.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-6 py-12 text-center dark:border-red-900/40 dark:bg-red-900/10">
      <p className="text-sm font-medium text-red-700 dark:text-red-300">Couldn&apos;t load this campaign</p>
      <p className="text-xs text-red-600 dark:text-red-400">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:border-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 dark:border-red-800 dark:text-red-300 dark:hover:border-red-600"
      >
        Retry
      </button>
    </div>
  );
}

const fieldClasses =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:outline-zinc-100";

function MessageReviewPanel({
  message,
  onClose,
  onUpdated,
}: {
  message: OutreachMessageWithLead;
  onClose: () => void;
  onUpdated: (message: OutreachMessageWithLead) => void;
}) {
  // Rendered with key={message.id} by the caller, so a full remount (not an
  // effect) is what resets these fields when the selected message changes.
  const [subject, setSubject] = useState(message.subject ?? "");
  const [body, setBody] = useState(message.body ?? "");
  const [saving, setSaving] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const isDraft = message.status === "draft";
  const dirty = subject !== (message.subject ?? "") || body !== (message.body ?? "");

  async function saveEdits(): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/outreach/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save changes");
      onUpdated({ ...message, ...data.message });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const ok = await saveEdits();
    if (ok) {
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    }
  }

  async function handleApproveAndQueue() {
    setError(null);
    if (dirty) {
      const ok = await saveEdits();
      if (!ok) return;
    }
    setQueuing(true);
    try {
      const res = await fetch(`/api/outreach/messages/${message.id}/queue`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to queue message");
      onUpdated({ ...message, ...data.message });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue message");
    } finally {
      setQueuing(false);
    }
  }

  const leadLabel = message.lead?.name ?? message.lead?.company ?? "Unknown lead";

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white dark:bg-zinc-950 md:sticky md:top-6 md:inset-auto md:z-auto md:h-[calc(100vh-3rem)] md:w-[420px] md:shrink-0 md:rounded-lg md:border md:border-zinc-200 md:dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{leadLabel}</h2>
          <div className="mt-1.5">
            <StatusBadge kind="message" status={message.status} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close message review"
          className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus-visible:outline-zinc-100"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {!isDraft && (
          <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            This message is {message.status} and can no longer be edited.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="review-subject"
            className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Subject
          </label>
          <input
            id="review-subject"
            type="text"
            value={subject}
            disabled={!isDraft}
            onChange={(e) => setSubject(e.target.value)}
            className={fieldClasses}
          />
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label
            htmlFor="review-body"
            className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Body
          </label>
          <textarea
            id="review-body"
            value={body}
            disabled={!isDraft}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className={`${fieldClasses} resize-y font-mono text-[13px] leading-relaxed`}
          />
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {savedNotice && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">Changes saved.</p>
        )}
      </div>

      {isDraft && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Approving queues this email for delivery via the configured outreach webhook. Review
            it carefully — this is the last step before it goes out.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || queuing || !dirty}
              className="rounded-md border border-zinc-200 px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:focus-visible:outline-zinc-100"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={handleApproveAndQueue}
              disabled={saving || queuing}
              className="flex-1 rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              {queuing ? "Queuing..." : "Approve & queue"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignDetailInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const campaignId = params.id;

  const [campaign, setCampaign] = useState<OutreachCampaign | null>(null);
  const [messages, setMessages] = useState<OutreachMessageWithLead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("openMessage"));
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/outreach/campaigns/${campaignId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Failed to load campaign");
        setCampaign(data.campaign);
        setMessages(data.messages);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load campaign");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [campaignId, reloadToken]);

  function retry() {
    setLoading(true);
    setError(null);
    setReloadToken((t) => t + 1);
  }

  const selectedMessage = messages?.find((m) => m.id === selectedId) ?? null;

  function handleMessageUpdated(updated: OutreachMessageWithLead) {
    setMessages((prev) => prev?.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)) ?? prev);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
      <Link
        href="/outreach"
        className="w-fit rounded text-xs font-medium text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus-visible:outline-zinc-100"
      >
        ← All campaigns
      </Link>

      {loading && <CampaignDetailSkeleton />}
      {!loading && error && <ErrorState message={error} onRetry={retry} />}

      {!loading && !error && campaign && (
        <>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {campaign.name}
            </h1>
            <StatusBadge kind="campaign" status={campaign.status} />
          </div>

          {messages && messages.length === 0 && <MessagesEmptyState />}

          {messages && messages.length > 0 && (
            <div className="flex flex-1 items-start gap-0 md:gap-6">
              <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Lead
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Subject
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Sent
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {messages.map((m) => (
                      <MessageRow
                        key={m.id}
                        message={m}
                        selected={m.id === selectedId}
                        onSelect={() => setSelectedId(m.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedMessage && (
                <MessageReviewPanel
                  key={selectedMessage.id}
                  message={selectedMessage}
                  onClose={() => setSelectedId(null)}
                  onUpdated={handleMessageUpdated}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CampaignDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <CampaignDetailSkeleton />
        </div>
      }
    >
      <CampaignDetailInner />
    </Suspense>
  );
}
