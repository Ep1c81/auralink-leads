"use client";

import { useState } from "react";
import { input, label, panel, primaryButton, secondaryButton } from "./theme";

export function NewCampaignForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create campaign");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col gap-3 p-4 ${panel}`}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-campaign-name" className={label}>
          Campaign name
        </label>
        <input
          id="new-campaign-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. San José low-rating restaurants"
          autoFocus
          className={input}
        />
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !name.trim()} className={primaryButton}>
          {submitting ? "Creating..." : "Create campaign"}
        </button>
      </div>
    </form>
  );
}
