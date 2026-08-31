"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OutreachCampaignWithCounts } from "@/lib/types";
import { body, focusRing, input, panel, panelTitle, primaryButton, secondaryButton } from "./theme";

/**
 * Entry point reached via /outreach?draftLead=<id>&draftLeadName=<name>, the
 * link the main lead console's "Draft outreach email" action opens. Lets the
 * reviewer pick an existing campaign or name a new one, then calls the
 * existing /api/outreach/generate route and hands off to the review panel.
 */
export function DraftLeadPanel({
  leadId,
  leadName,
  campaigns,
}: {
  leadId: string;
  leadName: string;
  campaigns: OutreachCampaignWithCounts[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"existing" | "new">(campaigns.length > 0 ? "existing" : "new");
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      let targetCampaignId = campaignId;

      if (mode === "new") {
        if (!newName.trim()) throw new Error("Enter a campaign name");
        const res = await fetch("/api/outreach/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to create campaign");
        targetCampaignId = data.campaign.id;
      }

      if (!targetCampaignId) throw new Error("Select a campaign");

      const genRes = await fetch("/api/outreach/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, campaign_id: targetCampaignId }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error ?? "Failed to generate draft");

      router.push(`/outreach/${targetCampaignId}?openMessage=${genData.message.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={submitting}
      className={`flex flex-col gap-4 border-violet-400/20 p-4 ${panel}`}
    >
      <div>
        <h2 className={panelTitle}>Draft outreach email for {leadName}</h2>
        <p className={`mt-0.5 ${body}`}>
          Choose which campaign this draft belongs to, then generate it for review.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Campaign</legend>
        {campaigns.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="radio"
              name="campaign-mode"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              className={`${focusRing} accent-violet-500`}
            />
            Existing campaign
          </label>
        )}
        {mode === "existing" && campaigns.length > 0 && (
          <select
            aria-label="Existing campaign"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className={`ml-6 ${input}`}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id} className="bg-slate-900">
                {c.name}
              </option>
            ))}
          </select>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="radio"
            name="campaign-mode"
            checked={mode === "new"}
            onChange={() => setMode("new")}
            className={`${focusRing} accent-violet-500`}
          />
          New campaign
        </label>
        {mode === "new" && (
          <div className="ml-6 flex flex-col gap-1.5">
            <label htmlFor="draft-new-campaign-name" className="sr-only">
              New campaign name
            </label>
            <input
              id="draft-new-campaign-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Campaign name"
              className={input}
            />
          </div>
        )}
      </fieldset>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push("/outreach")}
          className={secondaryButton}
        >
          Cancel
        </button>
        <button type="submit" disabled={submitting} className={primaryButton}>
          {submitting ? "Generating draft..." : "Generate draft"}
        </button>
      </div>
    </form>
  );
}
