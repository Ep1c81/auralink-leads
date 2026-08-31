"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { OutreachCampaignWithCounts } from "@/lib/types";
import { CampaignCard } from "@/components/outreach/CampaignCard";
import { StatusBadge } from "@/components/outreach/StatusBadge";

function CampaignListSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-8 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="flex flex-col gap-3 md:hidden">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
          />
        ))}
      </div>
      <div className="hidden h-48 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 md:block" />
    </div>
  );
}

function EmptyState({ onStartCreate }: { onStartCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">No campaigns yet</p>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Create a campaign to start drafting and reviewing outreach emails for your qualified
        leads.
      </p>
      <button
        type="button"
        onClick={onStartCreate}
        className="mt-2 rounded-md bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100"
      >
        Create campaign
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-6 py-12 text-center dark:border-red-900/40 dark:bg-red-900/10">
      <p className="text-sm font-medium text-red-700 dark:text-red-300">
        Couldn&apos;t load campaigns
      </p>
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

function NewCampaignForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (campaign: OutreachCampaignWithCounts) => void;
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
      onCreated({ ...data.campaign, message_count: 0, sent_count: 0, reply_count: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="new-campaign-name"
          className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
        >
          Campaign name
        </label>
        <input
          id="new-campaign-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. San José low-rating restaurants"
          autoFocus
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:outline-zinc-100"
        />
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:focus-visible:outline-zinc-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-md bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100"
        >
          {submitting ? "Creating..." : "Create campaign"}
        </button>
      </div>
    </form>
  );
}

function DraftLeadPanel({
  leadId,
  leadName,
  campaigns,
  onDone,
  onCancel,
}: {
  leadId: string;
  leadName: string;
  campaigns: OutreachCampaignWithCounts[];
  onDone: (campaignId: string, messageId: string) => void;
  onCancel: () => void;
}) {
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

      onDone(targetCampaignId, genData.message.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={submitting}
      className="flex flex-col gap-4 rounded-lg border border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Draft outreach email for {leadName}
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Choose which campaign this draft belongs to, then generate it for review.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Campaign</legend>
        {campaigns.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="radio"
              name="campaign-mode"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
            />
            Existing campaign
          </label>
        )}
        {mode === "existing" && campaigns.length > 0 && (
          <select
            aria-label="Existing campaign"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="ml-6 rounded-md border border-zinc-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:outline-zinc-100"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="radio"
            name="campaign-mode"
            checked={mode === "new"}
            onChange={() => setMode("new")}
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
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
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:outline-zinc-100"
            />
          </div>
        )}
      </fieldset>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:focus-visible:outline-zinc-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100"
        >
          {submitting ? "Generating draft..." : "Generate draft"}
        </button>
      </div>
    </form>
  );
}

function OutreachPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftLeadId = searchParams.get("draftLead");
  const draftLeadName = searchParams.get("draftLeadName") ?? "this lead";

  const [campaigns, setCampaigns] = useState<OutreachCampaignWithCounts[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/outreach/campaigns");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Failed to load campaigns");
        setCampaigns(data.campaigns);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load campaigns");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function retry() {
    setLoading(true);
    setError(null);
    setReloadToken((t) => t + 1);
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Outreach campaigns
        </h1>
        {campaigns && campaigns.length > 0 && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:focus-visible:outline-zinc-100"
          >
            + New campaign
          </button>
        )}
      </div>

      {draftLeadId && campaigns && (
        <DraftLeadPanel
          leadId={draftLeadId}
          leadName={draftLeadName}
          campaigns={campaigns}
          onCancel={() => router.push("/outreach")}
          onDone={(campaignId, messageId) =>
            router.push(`/outreach/${campaignId}?openMessage=${messageId}`)
          }
        />
      )}

      {creating && (
        <NewCampaignForm
          onCancel={() => setCreating(false)}
          onCreated={(campaign) => {
            setCampaigns((prev) => [campaign, ...(prev ?? [])]);
            setCreating(false);
          }}
        />
      )}

      {loading && <CampaignListSkeleton />}
      {!loading && error && <ErrorState message={error} onRetry={retry} />}
      {!loading && !error && campaigns && campaigns.length === 0 && !creating && (
        <EmptyState onStartCreate={() => setCreating(true)} />
      )}

      {!loading && !error && campaigns && campaigns.length > 0 && (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 md:block">
            <table className="w-full text-left">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Campaign
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Messages
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Sent
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Replies
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <th scope="row" className="px-3 py-2.5 text-left font-normal">
                      <a
                        href={`/outreach/${c.id}`}
                        className="rounded text-sm font-medium text-zinc-900 underline decoration-dotted underline-offset-2 hover:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-50 dark:hover:text-zinc-300 dark:focus-visible:outline-zinc-100"
                      >
                        {c.name}
                      </a>
                    </th>
                    <td className="px-3 py-2.5">
                      <StatusBadge kind="campaign" status={c.status} />
                    </td>
                    <td className="px-3 py-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                      {c.message_count}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                      {c.sent_count}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                      {c.reply_count}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function OutreachPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <CampaignListSkeleton />
        </div>
      }
    >
      <OutreachPageInner />
    </Suspense>
  );
}
