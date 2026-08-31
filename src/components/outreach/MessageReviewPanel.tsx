"use client";

import { useState } from "react";
import type { OutreachMessageWithLead } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { ghostButton, input, label, meta, panelTitle, secondaryButton, successButton, textarea } from "./theme";

/**
 * The review / approve panel. Editable while status is "draft"; once queued,
 * fields lock and the review action disappears — the human-review gate the
 * backend enforces server-side too (updateDraftMessage / queueMessage both
 * reject non-draft messages).
 */
export function MessageReviewPanel({
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
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden border-white/10 bg-slate-950/98 backdrop-blur-2xl md:sticky md:top-6 md:inset-auto md:z-auto md:h-[calc(100vh-3rem)] md:w-[420px] md:shrink-0 md:rounded-2xl md:border md:shadow-[0_20px_60px_-25px_rgba(0,0,0,0.8)]">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-4">
        <div>
          <h2 className={panelTitle}>{leadLabel}</h2>
          <div className="mt-1.5">
            <StatusBadge kind="message" status={message.status} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close message review"
          className={ghostButton}
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {!isDraft && (
          <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
            This message is {message.status} and can no longer be edited.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="review-subject" className={label}>
            Subject
          </label>
          <input
            id="review-subject"
            type="text"
            value={subject}
            disabled={!isDraft}
            onChange={(e) => setSubject(e.target.value)}
            className={input}
          />
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="review-body" className={label}>
            Body
          </label>
          <textarea
            id="review-body"
            value={body}
            disabled={!isDraft}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className={textarea}
          />
        </div>

        {error && <p className="text-xs text-red-300">{error}</p>}
        {savedNotice && <p className="text-xs text-emerald-300">Changes saved.</p>}
      </div>

      {isDraft && (
        <div className="flex flex-col gap-2 border-t border-white/10 px-4 py-4">
          <p className={meta}>
            Approving queues this email for delivery via the configured outreach webhook. Review
            it carefully — this is the last step before it goes out.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || queuing || !dirty}
              className={secondaryButton}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={handleApproveAndQueue}
              disabled={saving || queuing}
              className={`flex-1 ${successButton}`}
            >
              {queuing ? "Queuing..." : "Approve & queue"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
