"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Lead } from "@/lib/types";
import { primaryButton, secondaryButton, subtleLink } from "@/components/outreach/theme";

type Action = "qualify" | "auto-qualify";

export function LeadActions({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: Action) {
    setPending(action);
    setError(null);

    try {
      const res = await fetch(`/api/leads/${lead.id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error ?? "Request failed");
        return;
      }

      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => runAction("qualify")}
          disabled={pending !== null}
          className={secondaryButton}
        >
          {pending === "qualify" ? "Qualifying..." : "Qualify"}
        </button>
        <button
          type="button"
          onClick={() => runAction("auto-qualify")}
          disabled={pending !== null}
          className={primaryButton}
        >
          {pending === "auto-qualify" ? "Auto-Qualifying..." : "Auto-Qualify & Enrich"}
        </button>
        {lead.status === "qualified" && (
          <Link
            href={`/outreach?draftLead=${lead.id}&draftLeadName=${encodeURIComponent(
              lead.name ?? lead.company ?? ""
            )}`}
            className={subtleLink}
          >
            View Outreach
          </Link>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
